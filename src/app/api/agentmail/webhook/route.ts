import { HumanMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

import {
  isAgentMailConfigured,
  parseInboundPayload,
  replyToMessage,
} from "@/lib/agentmail/client";
import { runHowdyTurn } from "@/lib/howdy/agent";
import { loadMemories } from "@/lib/howdy/memories";
import { lastSentMatchForThread } from "@/lib/howdy/scheduler";
import {
  appendMessage,
  findOrCreateThread,
  loadMessages,
  markThreadProcessed,
  saveBrief,
} from "@/lib/howdy/threads";
import { isSupabaseConfigured } from "@/lib/supabase/client";

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
    const thread = await findOrCreateThread({
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
