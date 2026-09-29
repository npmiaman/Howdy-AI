/**
 * Daily ops digest: one email to the team each morning with yesterday's
 * funnel, anything stuck or waiting on a human, and what's owed. Sent by the
 * first cron run after DIGEST_HOUR_UTC (default 01:00 UTC ≈ 9am Singapore);
 * the daily counter makes it once-per-day even with overlapping runs.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { listUninvoiced } from "./billing";
import { notifyOps } from "./notify";
import { hitRateLimit, LIMITS } from "./rate-limit";
import { takeoverLink } from "./takeover";
import { FALLBACK_DELIVERY_HOURS, FALLBACK_MAX_AGE_HOURS } from "./types";

const DIGEST_HOUR_UTC = Number(process.env.HOWDY_DIGEST_HOUR_UTC ?? 1);
const DAY_MS = 86_400_000;

async function count(table: string, column: string, since: string): Promise<number> {
  const { count: n } = await getSupabaseAdmin()
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(column, since);
  return n ?? 0;
}

export async function sendDailyDigest(): Promise<{ sent: boolean }> {
  if (!isSupabaseConfigured()) return { sent: false };
  const now = new Date();
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return { sent: false };
  const day = now.toISOString().slice(0, 10);
  if (!(await hitRateLimit(`digest:${day}`, { max: 1, window: 86_400 }))) return { sent: false };

  const sb = getSupabaseAdmin();
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const stuckBefore = new Date(now.getTime() - FALLBACK_DELIVERY_HOURS * 3_600_000).toISOString();
  const stuckAfter = new Date(now.getTime() - FALLBACK_MAX_AGE_HOURS * 3_600_000).toISOString();

  const [signups, briefs, shortlists, intros, stuck, paused, owed, aiTurns] = await Promise.all([
    count("leads", "created_at", since),
    count("pending_matches", "created_at", since),
    count("pending_matches", "shortlist_sent_at", since),
    count("billable_intros", "created_at", since),
    sb
      .from("pending_matches")
      .select("id,user_email,phase,created_at")
      .in("phase", ["matching", "outreach"])
      .lte("created_at", stuckBefore)
      .gte("created_at", stuckAfter),
    sb.from("threads").select("id,user_email,subject").eq("ai_paused", true).limit(200),
    listUninvoiced(),
    sb.from("rate_limits").select("count").eq("key", `ai-turns:${day}`).maybeSingle(),
  ]);

  // Paused conversations whose latest message is from the other person —
  // i.e. someone is waiting on the team.
  const pausedThreads = (paused.data ?? []) as Array<{ id: string; user_email: string; subject: string | null }>;
  const { data: latest } = pausedThreads.length
    ? await sb
        .from("messages")
        .select("thread_id,role,created_at")
        .in(
          "thread_id",
          pausedThreads.map((t) => t.id),
        )
        .order("created_at", { ascending: false })
    : { data: [] };
  const lastRole = new Map<string, string>();
  for (const m of (latest ?? []) as Array<{ thread_id: string; role: string }>)
    if (!lastRole.has(m.thread_id)) lastRole.set(m.thread_id, m.role);
  const waiting = pausedThreads.filter((t) => lastRole.get(t.id) === "human");

  const owedTotal = owed.reduce((sum, r) => sum + Number(r.fee_usd), 0);
  const stuckRows = (stuck.data ?? []) as Array<{ user_email: string; phase: string; created_at: string }>;

  const lines = [
    `Good morning — here's Howdy for the last 24 hours.`,
    ``,
    `Sign-ups: ${signups}   Briefs: ${briefs}   Shortlists sent: ${shortlists}   Intros: ${intros}`,
    ``,
    waiting.length
      ? [
          `Waiting on you (${waiting.length}):`,
          ...waiting.map(
            (t) => `- ${t.user_email} — ${t.subject ?? "(no subject)"}  · hand back to Howdy: ${takeoverLink(t.id, "auto")}`,
          ),
        ].join("\n")
      : `Nobody is waiting on a human reply.`,
    ``,
    stuckRows.length
      ? [
          `Past ${FALLBACK_DELIVERY_HOURS}h without a shortlist (${stuckRows.length}):`,
          ...stuckRows.map((r) => `- ${r.user_email} — ${r.phase} since ${r.created_at.slice(0, 16).replace("T", " ")} UTC`),
        ].join("\n")
      : `No requests stuck past ${FALLBACK_DELIVERY_HOURS}h.`,
    ``,
    owed.length
      ? `To invoice: ${owed.length} intro(s), $${owedTotal} (npm run billing list).`
      : `Nothing to invoice.`,
    ``,
    `AI turns used today: ${aiTurns.data?.count ?? 0} of ${LIMITS.aiTurnsPerDay().max}.`,
    ``,
    `— Howdy`,
  ];
  await notifyOps({ subject: `☀️ Howdy daily digest — ${day}`, text: lines.join("\n") });
  return { sent: true };
}
