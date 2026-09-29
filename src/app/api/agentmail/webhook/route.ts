import { HumanMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

import {
  type AgentMailIncomingMessage,
  isAgentMailConfigured,
  parseInboundPayload,
  replyToMessage,
} from "@/lib/agentmail/client";
import { runHowdyTurn } from "@/lib/howdy/agent";
import {
  findAwaitingCandidateBySender,
  findCandidateByOutreachThread,
} from "@/lib/howdy/candidates";
import { handleClientReply } from "@/lib/howdy/client-replies";
import {
  classifyInbound,
  isJoinRequest,
} from "@/lib/howdy/inbound-guard";
import { dispatch } from "@/lib/howdy/mailer";
import { loadMemories } from "@/lib/howdy/memories";
import { maybeNotifyInbound, notifyOps } from "@/lib/howdy/notify";
import {
  classifyFreelancerReply,
  handleFreelancerDecision,
} from "@/lib/howdy/outreach";
import {
  findCheckinByThread,
  findOpenCheckinBySender,
  handleCheckinReply,
} from "@/lib/howdy/post-match";
import { getPendingById, latestRequestForThread } from "@/lib/howdy/scheduler";
import {
  appendMessage,
  findOrCreateEmailThread,
  loadMessages,
  markThreadProcessed,
  saveBrief,
} from "@/lib/howdy/threads";
import { verifyWebhook } from "@/lib/howdy/webhook-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.bridgecreatives.co";

function ok(action: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, action, ...extra });
}

/** Webhooks are retried; a message we've already stored was already handled. */
async function alreadyHandled(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const { data } = await getSupabaseAdmin()
    .from("messages")
    .select("id")
    .eq("gmail_message_id", messageId)
    .limit(1);
  return (data ?? []).length > 0;
}

async function isRosterFreelancer(email: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from("freelancers")
    .select("id")
    .ilike("email", email)
    .limit(1);
  return (data ?? []).length > 0;
}

/** Store a non-client inbound message on its own conversation (for visibility). */
async function recordInbound(email: AgentMailIncomingMessage) {
  const thread = await findOrCreateEmailThread({
    gmailThreadId: email.threadId,
    userEmail: email.fromEmail,
    subject: email.subject,
  });
  await appendMessage({
    threadId: thread.id,
    role: "human",
    content: email.body,
    gmailMessageId: email.messageId,
  });
  return thread;
}

export async function POST(request: Request) {
  const raw = await request.text();
  const auth = verifyWebhook(raw, request.headers);
  if (!auth.ok)
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  if (!isAgentMailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AgentMail not configured" },
      { status: 503 },
    );
  }
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Gemini key missing" },
      { status: 503 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  let email: AgentMailIncomingMessage;
  try {
    email = parseInboundPayload(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[agentmail-webhook] parse failed:", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 400 });
  }

  if (email.eventType && email.eventType !== "message.received")
    return ok("ignored_event");
  if (!email.fromEmail || !email.threadId) return ok("skipped_no_from_or_thread");

  try {
    if (await alreadyHandled(email.messageId)) return ok("duplicate");

    // ------------------------------------------------------------------
    // Guardrails before anything else: never engage with bounces, our own
    // mail, the team's mail, threads Howdy is only CC'd on, or empty bodies.
    // ------------------------------------------------------------------
    const verdict = classifyInbound(email);
    if (verdict === "ignored_automated" || verdict === "ignored_self" || verdict === "team_sender")
      return ok(verdict);
    if (verdict === "cc_only" || verdict === "empty_body") {
      await notifyOps({
        subject:
          verdict === "cc_only"
            ? "👀 Howdy was CC'd on a thread (no auto-reply sent)"
            : "📎 Howdy got an email it couldn't read (no auto-reply sent)",
        text: [
          `From: ${email.fromEmail}`,
          `To: ${email.to.join(", ") || "(none)"}`,
          email.cc.length ? `Cc: ${email.cc.join(", ")}` : null,
          `Re: ${email.subject || "(no subject)"}`,
          "",
          email.body ? `"${email.body.slice(0, 400)}"` : "(no readable text — likely attachments only)",
          "",
          "A human should take a look.",
          "— Howdy",
        ]
          .filter((l) => l !== null)
          .join("\n"),
      });
      return ok(verdict);
    }

    // Who is this? A freelancer replying to an invite, anyone replying to a
    // post-match check-in, a would-be freelancer, or a client.
    const candidate =
      (await findCandidateByOutreachThread(email.threadId)) ??
      (/are you open to|the client picked you|connecting you/i.test(email.subject)
        ? await findAwaitingCandidateBySender(email.fromEmail)
        : null);
    const checkin = candidate
      ? null
      : ((await findCheckinByThread(email.threadId)) ??
        (await findOpenCheckinBySender({ email: email.fromEmail, subject: email.subject })));
    const joinRequest = !candidate && !checkin && isJoinRequest(email.subject);

    await maybeNotifyInbound({
      messageId: email.messageId,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.body,
      isFreelancerThread:
        candidate !== null || joinRequest || checkin?.party === "freelancer",
    });

    // ------------------------------------------------------------------
    // ROUTE 1 — a FREELANCER replying to an invite (or after being picked).
    // ------------------------------------------------------------------
    if (candidate) {
      await recordInbound(email);
      const request = await getPendingById(candidate.requestId);
      if (!request) return ok("freelancer_orphaned");
      const decision = await classifyFreelancerReply(email.body);
      if (decision === "unclear") {
        await dispatch({
          kind: "freelancer_unclear",
          to: email.fromEmail,
          subject: email.subject,
          text: "Just to confirm — are you open to this one? A quick yes or no works.",
          replyToMessageId: email.messageId,
        });
        return ok("freelancer_unclear");
      }
      const result = await handleFreelancerDecision({
        candidate,
        accepted: decision === "yes",
        request,
      });
      return ok(`freelancer_${result.outcome}`, { shortlistReady: result.shortlistReady });
    }

    // ------------------------------------------------------------------
    // ROUTE 2 — a reply to a post-match CHECK-IN ("how was the call?").
    // ------------------------------------------------------------------
    if (checkin) {
      await recordInbound(email);
      const result = await handleCheckinReply({ checkin, text: email.body });
      return ok("checkin_reply", { stage: result.stage });
    }

    // ------------------------------------------------------------------
    // ROUTE 3 — freelancers writing in: never treated as a hiring brief.
    // ------------------------------------------------------------------
    const firstName = email.fromName?.split(" ")[0];
    if (joinRequest) {
      await recordInbound(email);
      const text = [
        `Hey${firstName ? ` ${firstName}` : ""}! Thanks for reaching out about joining Howdy's roster.`,
        "",
        `We review every freelancer by hand. The fastest way in is the short application here: ${SITE_URL}/freelancers — it takes two minutes and goes straight to the team.`,
        "",
        "Howdy",
      ].join("\n");
      await replyToMessage({ messageId: email.messageId, text });
      return ok("freelancer_application");
    }
    if (await isRosterFreelancer(email.fromEmail)) {
      const thread = await recordInbound(email);
      const text = `Thanks${firstName ? ` ${firstName}` : ""} — noted. I've passed this along to the team.`;
      const sent = await replyToMessage({ messageId: email.messageId, text });
      await appendMessage({
        threadId: thread.id,
        role: "ai",
        content: text,
        gmailMessageId: sent.messageId,
      });
      return ok("freelancer_inbound");
    }

    // ------------------------------------------------------------------
    // ROUTE 4 — a CLIENT. If their conversation already has a request, route
    // by where that request actually is; otherwise it's the brief conversation.
    // ------------------------------------------------------------------
    const thread = await findOrCreateEmailThread({
      gmailThreadId: email.threadId, // reusing same column for any provider's thread id
      userEmail: email.fromEmail,
      subject: email.subject,
    });

    await appendMessage({
      threadId: thread.id,
      role: "human",
      content: email.body,
      gmailMessageId: email.messageId,
    });

    const history = await loadMessages(thread.id);
    const memories = await loadMemories(email.fromEmail);
    const request = await latestRequestForThread(thread.id);

    if (request && request.phase !== "failed") {
      const { action } = await handleClientReply({
        request,
        thread,
        history,
        memories,
        text: email.body,
        inboundMessageId: email.messageId,
      });
      await markThreadProcessed(thread.id);
      return ok(action);
    }

    const turn = await runHowdyTurn({
      messages: history.length > 0 ? history : [new HumanMessage(email.body)],
      brief: thread.brief,
      threadId: thread.id,
      userEmail: email.fromEmail,
      subject: email.subject,
      memories,
    });

    await saveBrief(thread.id, turn.brief);

    // The agent's reply is either an immediate clarification or an "ack"
    // when the brief gets scheduled. Send it now.
    const sent = await replyToMessage({
      messageId: email.messageId,
      text: turn.reply,
    });

    await appendMessage({
      threadId: thread.id,
      role: "ai",
      content: turn.reply,
      gmailMessageId: sent.messageId,
    });

    await markThreadProcessed(thread.id);

    return ok(turn.scheduled ? "scheduled_match" : "clarified", {
      scheduled: turn.scheduled
        ? {
            id: turn.scheduled.id,
            scheduledAt: turn.scheduled.scheduledAt.toISOString(),
          }
        : null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[agentmail-webhook] failed for ${email.messageId}:`, detail);
    // A retry of this delivery will be skipped as a duplicate once the message
    // is stored, so make sure a human hears about the failure.
    await notifyOps({
      subject: "🚨 Howdy failed to handle an inbound email",
      text: `From: ${email.fromEmail}\nRe: ${email.subject}\nError: ${detail}\n\n"${email.body.slice(0, 400)}"\n\n— Howdy`,
    });
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
