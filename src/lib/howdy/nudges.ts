/**
 * Nudge sign-ups who got the welcome email but never replied — once, two days
 * in. Most sign-ups (15 of the first 25) never wrote back and nothing followed
 * up. Only recent sign-ups are eligible, so turning this on never blasts old
 * leads. Driven by the cron; honours dry-run via the saga dispatcher.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { dispatch, wouldSend } from "./mailer";
import { appendMessage } from "./threads";

export const NUDGE_AFTER_HOURS = 48;
export const NUDGE_MAX_AGE_DAYS = 14;

function nudgeText(firstName: string): string {
  return [
    `Hey ${firstName},`,
    "",
    "Just bumping this in case it got buried. Who are you looking to hire? One line about the project is plenty to get me started.",
    "",
    "Howdy",
  ].join("\n");
}

type ThreadLite = { id: string; user_email: string; subject: string | null };
type MessageLite = { role: "human" | "ai"; gmail_message_id: string | null };

export async function sendLeadNudges(): Promise<{ sent: number; skippedDryRun: number }> {
  if (!isSupabaseConfigured()) return { sent: 0, skippedDryRun: 0 };
  const sb = getSupabaseAdmin();
  const now = Date.now();
  const newest = new Date(now - NUDGE_AFTER_HOURS * 3_600_000).toISOString();
  const oldest = new Date(now - NUDGE_MAX_AGE_DAYS * 86_400_000).toISOString();

  // Welcome-only threads are never "processed" (that happens on a reply).
  const { data: threads, error } = await sb
    .from("threads")
    .select("id,user_email,subject")
    .lte("created_at", newest)
    .gte("created_at", oldest)
    .is("last_processed_at", null)
    .not("user_email", "ilike", "%@howdy.chat");
  if (error) throw error;

  let sent = 0;
  let skippedDryRun = 0;
  for (const t of (threads ?? []) as ThreadLite[]) {
    const { data: msgs } = await sb
      .from("messages")
      .select("role,gmail_message_id")
      .eq("thread_id", t.id);
    const list = (msgs ?? []) as MessageLite[];
    // Exactly one message, ours: the welcome. Anything else means they
    // replied, or they've already been nudged.
    if (list.length !== 1 || list[0].role !== "ai") continue;
    if (!wouldSend([t.user_email])) {
      skippedDryRun += 1;
      continue;
    }

    // Claim the thread so overlapping cron runs nudge it once.
    const { data: claimed } = await sb
      .from("threads")
      .update({ last_processed_at: new Date().toISOString() })
      .eq("id", t.id)
      .is("last_processed_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const { data: lead } = await sb
      .from("leads")
      .select("full_name")
      .ilike("email", t.user_email)
      .limit(1)
      .maybeSingle();
    const first = String(lead?.full_name ?? "").split(" ")[0] || "there";
    const text = nudgeText(first);
    const res = await dispatch({
      kind: "lead_nudge",
      to: t.user_email,
      subject: t.subject ?? "Who are you hiring?",
      text,
      replyToMessageId: list[0].gmail_message_id,
    });
    await appendMessage({
      threadId: t.id,
      role: "ai",
      content: text,
      gmailMessageId: res.messageId,
    });
    sent += 1;
  }
  return { sent, skippedDryRun };
}
