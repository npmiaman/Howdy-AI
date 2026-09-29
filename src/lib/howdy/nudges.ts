/**
 * Nudge sign-ups who got the welcome email but never replied — once, two days
 * in. Most sign-ups (15 of the first 25) never wrote back and nothing followed
 * up. Only recent sign-ups are eligible, so turning this on never blasts old
 * leads. Driven by the cron; honours dry-run via the saga dispatcher.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { firstName } from "@/lib/utils";

import { claimRow } from "./claims";
import { dispatch, wouldSend } from "./mailer";
import { OPT_OUT_LINE } from "./suppression";

export const NUDGE_AFTER_HOURS = 48;
export const NUDGE_MAX_AGE_DAYS = 14;

function nudgeText(firstName: string): string {
  return [
    `Hey ${firstName},`,
    "",
    "Just bumping this in case it got buried. Who are you looking to hire? One line about the project is plenty to get me started.",
    "",
    "Howdy",
    "",
    OPT_OUT_LINE,
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
    .eq("ai_paused", false)
    .not("user_email", "ilike", "%@howdy.chat");
  if (error) throw error;
  const all = (threads ?? []) as ThreadLite[];
  const sendable = all.filter((t) => wouldSend([t.user_email]));
  if (sendable.length === 0) return { sent: 0, skippedDryRun: all.length };

  // One query for every candidate thread's messages, grouped here.
  const { data: msgs, error: msgErr } = await sb
    .from("messages")
    .select("thread_id,role,gmail_message_id")
    .in(
      "thread_id",
      sendable.map((t) => t.id),
    );
  if (msgErr) throw msgErr;
  const byThread = new Map<string, MessageLite[]>();
  for (const m of (msgs ?? []) as Array<MessageLite & { thread_id: string }>)
    byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);

  // Exactly one message, ours: the welcome. Anything else means they
  // replied, or they've already been nudged.
  const due = sendable.filter((t) => {
    const list = byThread.get(t.id) ?? [];
    return list.length === 1 && list[0].role === "ai";
  });
  if (due.length === 0) return { sent: 0, skippedDryRun: all.length - sendable.length };

  const { data: leads } = await sb
    .from("leads")
    .select("email,full_name")
    .in(
      "email",
      due.map((t) => t.user_email),
    );
  const names = new Map(
    ((leads ?? []) as Array<{ email: string; full_name: string | null }>).map((l) => [
      l.email.toLowerCase(),
      l.full_name,
    ]),
  );

  let sent = 0;
  for (const t of due) {
    // Claim the thread so overlapping cron runs nudge it once.
    const claimed = await claimRow("threads", t.id, { last_processed_at: new Date().toISOString() }, (q) =>
      q.is("last_processed_at", null),
    ).catch(() => false);
    if (!claimed) continue;

    await dispatch({
      kind: "lead_nudge",
      to: t.user_email,
      subject: t.subject ?? "Who are you hiring?",
      text: nudgeText(firstName(names.get(t.user_email.toLowerCase()), "there")),
      replyToMessageId: byThread.get(t.id)![0].gmail_message_id,
      threadId: t.id,
    });
    sent += 1;
  }
  return { sent, skippedDryRun: all.length - sendable.length };
}
