import { HumanMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

import {
  type AgentMailIncomingMessage,
  isAgentMailConfigured,
  parseInboundPayload,
  replyToMessage,
} from "@/lib/agentmail/client";
import { runHowdyTurn } from "@/lib/howdy/agent";
import { hasApplication } from "@/lib/howdy/applications";
import {
  findAwaitingCandidateByMessageIds,
  findCandidateByOutreachThread,
} from "@/lib/howdy/candidates";
import { handleClientReply } from "@/lib/howdy/client-replies";
import { findFreelancerIdsByEmail } from "@/lib/howdy/data";
import { classifyInbound, isJoinRequest } from "@/lib/howdy/inbound-guard";
import { dispatch } from "@/lib/howdy/mailer";
import { loadMemories } from "@/lib/howdy/memories";
import { maybeNotifyInbound, notifyOps } from "@/lib/howdy/notify";
import {
  classifyFreelancerReply,
  handleFreelancerDecision,
} from "@/lib/howdy/outreach";
import {
  findCheckinByMessageIds,
  findCheckinByThread,
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
import { humanIsHandling, takeoverLink } from "@/lib/howdy/takeover";
import { verifyWebhook } from "@/lib/howdy/webhook-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import { errorMessage, firstName, SITE_URL } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

function ok(action: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, action, ...extra });
}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Alert the team about an inbound email a human should look at. */
function alertOps(email: AgentMailIncomingMessage, subject: string, note: string) {
  return notifyOps({
    subject,
    text: [
      `From: ${email.fromEmail}`,
      `To: ${email.to.join(", ") || "(none)"}`,
      email.cc.length ? `Cc: ${email.cc.join(", ")}` : null,
      `Re: ${email.subject || "(no subject)"}`,
      "",
      email.body ? `"${email.body.slice(0, 400)}"` : "(no readable text — likely attachments only)",
      "",
      note,
      "— Howdy",
    ]
      .filter((l) => l !== null)
      .join("\n"),
  });
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

/** Store an inbound message on its sender's conversation. */
async function recordInbound(email: AgentMailIncomingMessage) {
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
  return thread;
}

/**
 * If a person on the team is handling this conversation, Howdy stays out:
 * the team gets a "reply needed" alert (with a hand-back link) instead.
 */
async function handledByHuman(
  email: AgentMailIncomingMessage,
  threadId: string,
): Promise<NextResponse | null> {
  if (!(await humanIsHandling({ threadId, providerThreadId: email.threadId }))) return null;
  await alertOps(
    email,
    "🙋 Reply needed — you're handling this conversation",
    `Howdy didn't reply because someone on the team is handling this conversation. To hand it back: ${takeoverLink(threadId, "auto")}`,
  );
  return ok("human_handled");
}

/** Reply in the conversation and record the reply on it. */
async function replyAndRecord(email: AgentMailIncomingMessage, threadId: string, text: string) {
  const sent = await replyToMessage({ messageId: email.messageId, text });
  await appendMessage({ threadId, role: "ai", content: text, gmailMessageId: sent.messageId });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const auth = verifyWebhook(raw, request.headers);
  if (!auth.ok) return fail(auth.status, auth.error);

  if (!isAgentMailConfigured()) return fail(503, "AgentMail not configured");
  if (!process.env.GOOGLE_API_KEY) return fail(503, "Gemini key missing");
  if (!isSupabaseConfigured()) return fail(503, "Supabase not configured");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_json");
  }

  let email: AgentMailIncomingMessage;
  try {
    email = parseInboundPayload(payload);
  } catch (err) {
    const detail = errorMessage(err);
    console.error("[agentmail-webhook] parse failed:", detail);
    return fail(400, detail);
  }

  if (email.eventType && email.eventType !== "message.received")
    return ok("ignored_event");
  if (!email.fromEmail || !email.threadId) return ok("skipped_no_from_or_thread");

  // Vercel kills the function at maxDuration with no error path; stop just
  // short of it so a slow model or a hang still ends in an ops alert.
  const deadlineMs = Number(process.env.HOWDY_WEBHOOK_DEADLINE_MS ?? 50_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  const result = await Promise.race([handleInbound(email), timedOut]);
  clearTimeout(timer);
  if (result === "timeout") {
    console.error(`[agentmail-webhook] deadline exceeded for ${email.messageId}`);
    await alertOps(
      email,
      "🐢 Howdy ran out of time on an inbound email",
      `Handling took longer than ${Math.round(deadlineMs / 1000)}s (usually a slow or overloaded model). They may not have had a reply — a human should check.`,
    );
    return fail(504, "deadline_exceeded");
  }
  return result;
}

async function handleInbound(email: AgentMailIncomingMessage): Promise<NextResponse> {
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
      await alertOps(
        email,
        verdict === "cc_only"
          ? "👀 Howdy was CC'd on a thread (no auto-reply sent)"
          : "📎 Howdy got an email it couldn't read (no auto-reply sent)",
        "A human should take a look.",
      );
      return ok(verdict);
    }

    // ------------------------------------------------------------------
    // Who is this? Matched by provider thread first, then by the reply
    // headers (In-Reply-To / References) — never by subject line.
    // ------------------------------------------------------------------
    const [byThread, checkinByThread, rosterIds, applied] = await Promise.all([
      findCandidateByOutreachThread(email.threadId),
      findCheckinByThread(email.threadId),
      findFreelancerIdsByEmail(email.fromEmail),
      hasApplication(email.fromEmail),
    ]);
    const candidate = byThread ?? (await findAwaitingCandidateByMessageIds(email.replyToIds));
    const checkin = candidate
      ? null
      : (checkinByThread ?? (await findCheckinByMessageIds(email.replyToIds)));
    const joinRequest = !candidate && !checkin && isJoinRequest(email.subject);
    const freelancerish =
      candidate !== null ||
      joinRequest ||
      applied ||
      rosterIds.length > 0 ||
      checkin?.party === "freelancer";
    // The "1 new message" alert, sent once Howdy knows it's handling the email.
    const notify = (note?: string) =>
      maybeNotifyInbound({
        fromEmail: email.fromEmail,
        subject: email.subject,
        body: email.body,
        senderType: freelancerish ? "freelancer" : "client",
        note,
      });

    // ------------------------------------------------------------------
    // ROUTE 1 — a FREELANCER replying to an invite (or after being picked).
    // ------------------------------------------------------------------
    if (candidate) {
      const thread = await recordInbound(email);
      const held = await handledByHuman(email, thread.id);
      if (held) return held;
      await notify();
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
          threadId: thread.id,
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
      const thread = await recordInbound(email);
      const held = await handledByHuman(email, thread.id);
      if (held) return held;
      await notify();
      const result = await handleCheckinReply({ checkin, text: email.body });
      return ok("checkin_reply", { stage: result.stage });
    }

    // ------------------------------------------------------------------
    // ROUTE 3 — freelancers writing in: never treated as a hiring brief.
    // ------------------------------------------------------------------
    const hi = firstName(email.fromName) ? ` ${firstName(email.fromName)}` : "";
    if (joinRequest) {
      await recordInbound(email);
      await notify();
      await replyToMessage({
        messageId: email.messageId,
        text: [
          `Hey${hi}! Thanks for reaching out about joining Howdy's roster.`,
          "",
          `We review every freelancer by hand. The fastest way in is the short application here: ${SITE_URL}/freelancers — it takes two minutes and goes straight to the team.`,
          "",
          "Howdy",
        ].join("\n"),
      });
      return ok("freelancer_application");
    }
    if (applied || rosterIds.length > 0) {
      const thread = await recordInbound(email);
      const held = await handledByHuman(email, thread.id);
      if (held) return held;
      await notify();
      await replyAndRecord(
        email,
        thread.id,
        applied
          ? `Thanks${hi} — your application is with the team, and I've passed this note along too. If it's a fit, we'll email you.`
          : `Thanks${hi} — noted. I've passed this along to the team.`,
      );
      return ok(applied ? "freelancer_applicant" : "freelancer_inbound");
    }

    // ------------------------------------------------------------------
    // ROUTE 4 — a CLIENT. If their conversation already has a request, route
    // by where that request actually is; otherwise it's the brief conversation.
    // ------------------------------------------------------------------
    const thread = await recordInbound(email);
    const held = await handledByHuman(email, thread.id);
    if (held) return held;
    await notify(`Take this conversation over from Howdy: ${takeoverLink(thread.id, "human")}`);
    const [history, memories, request] = await Promise.all([
      loadMessages(thread.id),
      loadMemories(email.fromEmail),
      latestRequestForThread(thread.id),
    ]);

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
    await replyAndRecord(email, thread.id, turn.reply);
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
    const detail = errorMessage(err);
    console.error(`[agentmail-webhook] failed for ${email.messageId}:`, detail);
    // A retry of this delivery will be skipped as a duplicate once the message
    // is stored, so make sure a human hears about the failure.
    await alertOps(email, "🚨 Howdy failed to handle an inbound email", `Error: ${detail}`);
    return fail(500, detail);
  }
}
