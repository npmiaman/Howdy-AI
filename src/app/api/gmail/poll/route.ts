import { HumanMessage } from "@langchain/core/messages";
import { NextResponse } from "next/server";

import { runHowdyTurn } from "@/lib/howdy/agent";
import {
  appendMessage,
  findOrCreateThread,
  loadMessages,
  markThreadProcessed,
  saveBrief,
} from "@/lib/howdy/threads";
import {
  getMessageIdHeader,
  isGmailConfigured,
  listInboxSince,
  sendReply,
} from "@/lib/gmail/client";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const POLL_WINDOW_SECONDS = 5 * 60; // last 5 min of inbox per run

function authorize(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  if (!isGmailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Gmail not configured" },
      { status: 503 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 503 },
    );
  }
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Gemini key missing" },
      { status: 503 },
    );
  }

  const since = Math.floor(Date.now() / 1000) - POLL_WINDOW_SECONDS;
  const incoming = await listInboxSince(since);

  const supabase = getSupabaseAdmin();
  const results: Array<{
    gmailMessageId: string;
    action: "skipped" | "replied" | "error";
    detail?: string;
  }> = [];

  for (const email of incoming) {
    try {
      // Skip messages we've already ingested.
      const { data: existing } = await supabase
        .from("messages")
        .select("id")
        .eq("gmail_message_id", email.messageId)
        .maybeSingle();
      if (existing) {
        results.push({ gmailMessageId: email.messageId, action: "skipped" });
        continue;
      }

      const thread = await findOrCreateThread({
        gmailThreadId: email.threadId,
        userEmail: email.fromEmail,
        subject: email.subject,
      });

      // Append inbound message.
      await appendMessage({
        threadId: thread.id,
        role: "human",
        content: email.body,
        gmailMessageId: email.messageId,
      });

      // Reload full thread history for the agent.
      const history = await loadMessages(thread.id);
      // Ensure the new inbound is the last human message in the array we pass.
      const messagesForAgent =
        history.length > 0 ? history : [new HumanMessage(email.body)];

      const turn = await runHowdyTurn({
        messages: messagesForAgent,
        brief: thread.brief,
      });

      await saveBrief(thread.id, turn.brief);

      // Send reply via Gmail.
      const inReplyTo = await getMessageIdHeader(email.messageId);
      const sent = await sendReply({
        to: email.fromEmail,
        subject: email.subject,
        body: turn.reply,
        threadId: email.threadId,
        inReplyTo,
        references: inReplyTo,
      });

      // Persist the AI reply.
      await appendMessage({
        threadId: thread.id,
        role: "ai",
        content: turn.reply,
        gmailMessageId: sent.messageId,
      });

      await markThreadProcessed(thread.id);

      results.push({ gmailMessageId: email.messageId, action: "replied" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[gmail-poll] failed for message ${email.messageId}:`,
        detail,
      );
      results.push({ gmailMessageId: email.messageId, action: "error", detail });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
