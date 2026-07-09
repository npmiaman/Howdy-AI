import { HumanMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

import {
  isAgentMailConfigured,
  parseInboundPayload,
  replyToMessage,
} from "@/lib/agentmail/client";
import { runHowdyTurn } from "@/lib/howdy/agent";
import {
  findCandidateByOutreachThread,
  listCandidates,
} from "@/lib/howdy/candidates";
import { getFreelancersByIds } from "@/lib/howdy/data";
import { loadMemories } from "@/lib/howdy/memories";
import {
  classifyFreelancerReply,
  handleClientSelection,
  handleFreelancerDecision,
  parseClientSelection,
} from "@/lib/howdy/outreach";
import { maybeNotifyInbound } from "@/lib/howdy/notify";
import {
  findCheckinByThread,
  handleCheckinReply,
} from "@/lib/howdy/post-match";
import {
  getPendingById,
  lastSentMatchForThread,
  listRequestsInPhase,
} from "@/lib/howdy/scheduler";
import {
  appendMessage,
  findOrCreateEmailThread,
  loadMessages,
  markThreadProcessed,
  saveBrief,
} from "@/lib/howdy/threads";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request): NextResponse | null {
  const expected = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!expected) return null; // permissive when no secret set; recommended in prod
  const provided =
    request.headers.get("x-agentmail-signature") ??
    request.headers.get("x-webhook-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");
  if (provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  return null;
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

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
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  let email;
  try {
    email = parseInboundPayload(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[agentmail-webhook] parse failed:", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 400 });
  }

  if (!email.fromEmail || !email.threadId) {
    return NextResponse.json({ ok: true, action: "skipped_no_from_or_thread" });
  }

  try {
    // Classify the sender up front (an outreach-thread match => freelancer),
    // and fire a "1 new client / 1 new freelancer" alert to the ops inbox.
    // Awaited (so it completes on serverless) but never throws.
    const candidate = await findCandidateByOutreachThread(email.threadId);
    await maybeNotifyInbound({
      messageId: email.messageId,
      fromEmail: email.fromEmail,
      subject: email.subject,
      body: email.body,
      isFreelancerThread: candidate !== null,
    });

    // ----------------------------------------------------------------------
    // ROUTE 1 — is this a FREELANCER replying to an outreach check-in?
    // Matched by the outreach thread we emailed them on. Their replies never
    // touch the client conversation.
    // ----------------------------------------------------------------------
    if (candidate) {
      // Record the freelancer's inbound reply on the conversation so it shows
      // up in Momo (and mirrors to the backup DB) — not just our outreach.
      const inThread = await findOrCreateEmailThread({
        gmailThreadId: email.threadId,
        userEmail: email.fromEmail,
        subject: email.subject,
      });
      await appendMessage({
        threadId: inThread.id,
        role: "human",
        content: email.body,
        gmailMessageId: email.messageId,
      });
      const request = await getPendingById(candidate.requestId);
      if (request) {
        const decision = await classifyFreelancerReply(email.body);
        if (decision === "unclear") {
          const ask =
            "Just to confirm — are you open to this one? A quick yes or no works.";
          await replyToMessage({ messageId: email.messageId, text: ask });
          await appendMessage({ threadId: inThread.id, role: "ai", content: ask });
          return NextResponse.json({ ok: true, action: "freelancer_unclear" });
        }
        const result = await handleFreelancerDecision({
          candidate,
          accepted: decision === "yes",
          request,
        });
        return NextResponse.json({
          ok: true,
          action: `freelancer_${result.outcome}`,
          shortlistReady: result.shortlistReady,
        });
      }
    }

    // ----------------------------------------------------------------------
    // ROUTE 1b — is this a reply to a post-match CHECK-IN ("how was the call?")
    // from either the company or the freelancer?
    // ----------------------------------------------------------------------
    const checkin = await findCheckinByThread(email.threadId);
    if (checkin) {
      const inThread = await findOrCreateEmailThread({
        gmailThreadId: email.threadId,
        userEmail: email.fromEmail,
        subject: email.subject,
      });
      await appendMessage({
        threadId: inThread.id,
        role: "human",
        content: email.body,
        gmailMessageId: email.messageId,
      });
      const result = await handleCheckinReply({
        checkin,
        text: email.body,
      });
      return NextResponse.json({
        ok: true,
        action: "checkin_reply",
        stage: result.stage,
      });
    }

    // ----------------------------------------------------------------------
    // ROUTE 2 — is this a CLIENT picking from a shortlist we sent them?
    // ----------------------------------------------------------------------
    if (isSupabaseConfigured()) {
      const sb = getSupabaseAdmin();
      const { data: threadRow } = await sb
        .from("threads")
        .select("id")
        .eq("gmail_thread_id", email.threadId)
        .maybeSingle();
      if (threadRow?.id) {
        const shortlisted = await listRequestsInPhase(["shortlist_sent"]);
        const req = shortlisted.find((r) => r.threadId === threadRow.id);
        if (req) {
          const cands = await listCandidates(req.id);
          const fmap = new Map(
            (
              await getFreelancersByIds(cands.map((c) => c.freelancerId))
            ).map((f) => [f.id, f]),
          );
          const chosen = await parseClientSelection({
            text: email.body,
            candidates: cands,
            freelancers: fmap,
          });
          if (chosen.length > 0) {
            await appendMessage({
              threadId: threadRow.id,
              role: "human",
              content: email.body,
              gmailMessageId: email.messageId,
            });
            const result = await handleClientSelection({
              request: req,
              chosenFreelancerIds: chosen,
            });
            const ack =
              result.chosen === 1
                ? "Perfect — connecting you now. Intro landing in your inbox in a couple minutes."
                : `Great picks — connecting you with all ${result.chosen}. Intros landing in your inbox shortly.`;
            await replyToMessage({ messageId: email.messageId, text: ack });
            await appendMessage({
              threadId: threadRow.id,
              role: "ai",
              content: ack,
            });
            return NextResponse.json({
              ok: true,
              action: "client_selected",
              chosen: result.chosen,
            });
          }
        }
      }
    }

    // ----------------------------------------------------------------------
    // ROUTE 3 — default: client brief conversation.
    // ----------------------------------------------------------------------
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
    const messagesForAgent =
      history.length > 0 ? history : [new HumanMessage(email.body)];

    const memories = await loadMemories(email.fromEmail);
    const previousMatch = await lastSentMatchForThread(thread.id);

    const turn = await runHowdyTurn({
      messages: messagesForAgent,
      brief: thread.brief,
      threadId: thread.id,
      userEmail: email.fromEmail,
      subject: email.subject,
      memories,
      hasPreviousMatch: previousMatch !== null,
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

    return NextResponse.json({
      ok: true,
      action: turn.scheduled ? "scheduled_match" : "clarified",
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
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
