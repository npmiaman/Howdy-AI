import { NextResponse } from "next/server";

import {
  isAgentMailConfigured,
  replyToMessage,
  sendFreshEmail,
} from "@/lib/agentmail/client";
import { runScheduledMatch } from "@/lib/howdy/agent";
import {
  listDuePendingMatches,
  markPendingProcessed,
} from "@/lib/howdy/scheduler";
import { appendMessage } from "@/lib/howdy/threads";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;
  const provided =
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

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Gemini key missing" },
      { status: 503 },
    );
  }

  const due = await listDuePendingMatches();
  const results: Array<{
    id: string;
    action: "matched" | "no_match" | "error";
    detail?: string;
  }> = [];

  for (const pending of due) {
    try {
      const { match, reply } = await runScheduledMatch(pending.brief);

      let replyMessageId: string | null = null;

      // Send via AgentMail (when configured + Supabase has the thread row).
      if (isAgentMailConfigured() && isSupabaseConfigured()) {
        const sb = getSupabaseAdmin();

        // Find the most recent inbound message id on this thread to reply to.
        const { data: lastInbound } = await sb
          .from("messages")
          .select("gmail_message_id")
          .eq("thread_id", pending.threadId)
          .eq("role", "human")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const inboundMessageId = lastInbound?.gmail_message_id;
        try {
          const sent = inboundMessageId
            ? await replyToMessage({
                messageId: inboundMessageId,
                text: reply,
              })
            : await sendFreshEmail({
                to: pending.userEmail,
                subject: pending.subject ?? "Your match",
                text: reply,
              });
          replyMessageId = sent.messageId;
        } catch (sendErr) {
          console.error("[process-pending] agentmail send failed:", sendErr);
        }
      }

      // Persist the AI reply on the thread.
      if (isSupabaseConfigured()) {
        await appendMessage({
          threadId: pending.threadId,
          role: "ai",
          content: reply,
          gmailMessageId: replyMessageId ?? undefined,
        });
      }

      await markPendingProcessed({
        id: pending.id,
        matchedFreelancerId: match?.freelancer.id ?? null,
        replyMessageId: null,
      });

      results.push({
        id: pending.id,
        action: match ? "matched" : "no_match",
        detail: match?.freelancer.name,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] failed for ${pending.id}:`, detail);
      results.push({ id: pending.id, action: "error", detail });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
