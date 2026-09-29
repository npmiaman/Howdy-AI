/**
 * "Lazy match" scheduler. Real-life matching takes time; even a fast agent should
 * feel less robotic. When a brief is actionable, we don't search immediately — we
 * pick a random time inside the configured business window and defer the match.
 */
import { randomInt } from "node:crypto";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type { Brief, RequestPhase } from "./types";
import {
  FALLBACK_DELIVERY_HOURS,
  FALLBACK_MAX_AGE_HOURS,
  MAX_DEFER_HOURS,
} from "./types";

const BUSINESS_HOURS_START = Number(process.env.HOWDY_BUSINESS_HOURS_START ?? 9); // 9 AM
const BUSINESS_HOURS_END = Number(process.env.HOWDY_BUSINESS_HOURS_END ?? 16); // 4 PM

/**
 * How long a cron step's claim holds. A run killed mid-step (Vercel's 60s
 * limit, a crash) leaves its claim behind; once it's older than this, the next
 * run can take it over instead of the request being stranded forever.
 */
export const CLAIM_LEASE_MS = 10 * 60 * 1000;

export function leaseCutoff(): string {
  return new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
}

export type PendingMatch = {
  id: string;
  threadId: string;
  userEmail: string;
  subject: string | null;
  brief: Brief;
  scheduledAt: Date;
  processedAt: Date | null;
  matchedFreelancerId: string | null;
  phase: RequestPhase;
  createdAt: Date;
};

/**
 * Pick a uniformly-random Date inside the [BUSINESS_HOURS_START, BUSINESS_HOURS_END)
 * window. Source of randomness is `crypto.randomInt` (not `Math.random`).
 *
 * Algorithm:
 *   1. Roll a random ms offset inside today's full window.
 *   2. If the result is in the past, roll again inside tomorrow's full window.
 *
 * This gives a uniform distribution across the full window each day, regardless
 * of when the brief arrived. (E.g. if a brief comes in at 11am, ~5/7 of picks
 * land later today, ~2/7 land tomorrow — each candidate within its day window
 * is equally likely.)
 */
export function pickRandomMatchTime(now: Date = new Date()): Date {
  let candidate = pickInWindow(now);
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    candidate = pickInWindow(tomorrow);
  }
  // Never defer past MAX_DEFER_HOURS. Same-day business-hours picks are usually
  // only a couple hours out anyway; this clamps late-in-the-day rolls that would
  // otherwise jump to tomorrow (9am–4pm) and eat most of the 24h promise before
  // outreach even begins.
  const cap = now.getTime() + MAX_DEFER_HOURS * 60 * 60 * 1000;
  if (candidate.getTime() > cap) {
    const min = now.getTime() + 15 * 60 * 1000; // at least 15 min out
    candidate = new Date(min + randomInt(0, Math.max(1, cap - min)));
  }
  return candidate;
}

function pickInWindow(reference: Date): Date {
  const start = new Date(reference);
  start.setHours(BUSINESS_HOURS_START, 0, 0, 0);
  const end = new Date(reference);
  end.setHours(BUSINESS_HOURS_END, 0, 0, 0);
  const span = end.getTime() - start.getTime();
  // randomInt(min, max) returns a uniformly-random integer in [min, max).
  const offset = randomInt(0, span);
  return new Date(start.getTime() + offset);
}

// ------------------------------------------------------------------ in-memory store
const memoryStore: PendingMatch[] = [];

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ------------------------------------------------------------------ public API

export type ScheduleArgs = {
  threadId: string;
  userEmail: string;
  subject?: string | null;
  brief: Brief;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function schedulePendingMatch(
  args: ScheduleArgs,
): Promise<PendingMatch> {
  const scheduledAt = pickRandomMatchTime();

  // Only persist to Supabase when we have a real thread row to FK against.
  // CLI tests / websocket listener may pass a synthetic threadId.
  const usePersistence =
    isSupabaseConfigured() && UUID_RE.test(args.threadId);

  if (usePersistence) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("pending_matches")
      .insert({
        thread_id: args.threadId,
        user_email: args.userEmail,
        subject: args.subject ?? null,
        brief: args.brief,
        scheduled_at: scheduledAt.toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return rowToPendingMatch(data);
  }

  const pm: PendingMatch = {
    id: generateId(),
    threadId: args.threadId,
    userEmail: args.userEmail,
    subject: args.subject ?? null,
    brief: args.brief,
    scheduledAt,
    processedAt: null,
    matchedFreelancerId: null,
    phase: "matching",
    createdAt: new Date(),
  };
  memoryStore.push(pm);
  return pm;
}

/**
 * Create a request that starts immediately (no lazy-match defer) and is
 * already claimed — used for rematches, which recruit right away. Its own
 * created_at restarts the 24h shortlist guarantee for the new search.
 */
export async function createImmediateRequest(
  args: ScheduleArgs,
): Promise<PendingMatch> {
  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .insert({
      thread_id: args.threadId,
      user_email: args.userEmail,
      subject: args.subject ?? null,
      brief: args.brief,
      scheduled_at: now,
      processed_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToPendingMatch(data);
}

/** The most recent request on a conversation — what a client reply is about. */
export async function latestRequestForThread(
  threadId: string,
): Promise<PendingMatch | null> {
  if (!isSupabaseConfigured()) {
    return (
      memoryStore
        .filter((pm) => pm.threadId === threadId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ? rowToPendingMatch(data[0]) : null;
}

/** Keep a request's brief current when the client adds details mid-search. */
export async function updateRequestBrief(id: string, brief: Brief): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("pending_matches")
    .update({ brief })
    .eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------ claims
// Each cron step claims its row with a conditional update before doing any
// work, so overlapping runs (GitHub + Vercel cron, a slow run overlapping the
// next tick) can never process the same step twice. A failed step releases
// its claim so the next run retries it.

/** Claim a due request for starting outreach (processed_at → now). */
export async function claimPending(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("pending_matches")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("phase", "matching")
    .or(`processed_at.is.null,processed_at.lt.${leaseCutoff()}`)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function releasePending(id: string): Promise<void> {
  await getSupabaseAdmin()
    .from("pending_matches")
    .update({ processed_at: null })
    .eq("id", id);
}

/** Claim a request for the 24h fallback delivery (shortlist_sent_at → now). */
export async function claimFallback(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("pending_matches")
    .update({ shortlist_sent_at: new Date().toISOString() })
    .eq("id", id)
    .in("phase", ["matching", "outreach"])
    .or(`shortlist_sent_at.is.null,shortlist_sent_at.lt.${leaseCutoff()}`)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function releaseFallback(id: string): Promise<void> {
  await getSupabaseAdmin()
    .from("pending_matches")
    .update({ shortlist_sent_at: null })
    .eq("id", id);
}

/**
 * Claim a due intro send by pushing connect_after one lease into the future:
 * no other run picks it up meanwhile, and if this run dies it's due again.
 */
export async function claimConnect(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("pending_matches")
    .update({ connect_after: new Date(Date.now() + CLAIM_LEASE_MS).toISOString() })
    .eq("id", id)
    .eq("phase", "connecting")
    .lte("connect_after", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function releaseConnect(id: string): Promise<void> {
  await getSupabaseAdmin()
    .from("pending_matches")
    .update({ connect_after: new Date().toISOString() })
    .eq("id", id);
}

export async function listDuePendingMatches(
  now: Date = new Date(),
): Promise<PendingMatch[]> {
  const inMemory = memoryStore.filter(
    (pm) => pm.processedAt === null && pm.scheduledAt <= now,
  );
  if (!isSupabaseConfigured()) return inMemory;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .eq("phase", "matching")
    .or(`processed_at.is.null,processed_at.lt.${leaseCutoff()}`)
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return [...(data ?? []).map(rowToPendingMatch), ...inMemory];
}

/**
 * Requests that have blown (or are about to blow) the 24h promise without a
 * shortlist reaching the client — the hybrid fallback delivers DB-ranked
 * matches for these: phase 'matching' (outreach never started, or a start that
 * died mid-way) or 'outreach' (recruiting), with no delivery in progress, that
 * came in between FALLBACK_MAX_AGE_HOURS and FALLBACK_DELIVERY_HOURS ago. The
 * age floor keeps us from resurrecting ancient stalled rows.
 */
export async function listFallbackDue(
  now: Date = new Date(),
): Promise<PendingMatch[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(
    now.getTime() - FALLBACK_DELIVERY_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const floor = new Date(
    now.getTime() - FALLBACK_MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .lte("created_at", cutoff)
    .gte("created_at", floor)
    .in("phase", ["matching", "outreach"])
    .or(`shortlist_sent_at.is.null,shortlist_sent_at.lt.${leaseCutoff()}`)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPendingMatch);
}

/**
 * Has any match for this thread already been delivered? Used to flip the
 * agent into "follow-up" mode so replies-after-match don't re-trigger
 * another match-scheduling loop.
 */
export async function lastSentMatchForThread(
  threadId: string,
): Promise<{
  matchedFreelancerId: string | null;
  processedAt: Date;
} | null> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("pending_matches")
      .select("matched_freelancer_id, processed_at")
      .eq("thread_id", threadId)
      .not("processed_at", "is", null)
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[scheduler] lastSentMatchForThread failed:", error.message);
      return null;
    }
    if (!data || !data.processed_at) return null;
    return {
      matchedFreelancerId: data.matched_freelancer_id ?? null,
      processedAt: new Date(data.processed_at),
    };
  }
  const found = memoryStore
    .filter((pm) => pm.threadId === threadId && pm.processedAt !== null)
    .sort(
      (a, b) =>
        (b.processedAt?.getTime() ?? 0) - (a.processedAt?.getTime() ?? 0),
    )[0];
  if (!found) return null;
  return {
    matchedFreelancerId: found.matchedFreelancerId,
    processedAt: found.processedAt!,
  };
}

export async function listAllPending(): Promise<PendingMatch[]> {
  const inMemory = memoryStore.filter((pm) => pm.processedAt === null);
  if (!isSupabaseConfigured()) return inMemory;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .is("processed_at", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return [...(data ?? []).map(rowToPendingMatch), ...inMemory];
}

/** Load processed requests sitting in any of the given saga phases. */
export async function listRequestsInPhase(
  phases: string[],
): Promise<PendingMatch[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .in("phase", phases)
    .not("processed_at", "is", null);
  if (error) throw error;
  return (data ?? []).map(rowToPendingMatch);
}

/** Requests in `connecting` phase whose connect_after delay has elapsed. */
export async function listDueConnects(
  now: Date = new Date(),
): Promise<PendingMatch[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .eq("phase", "connecting")
    .lte("connect_after", now.toISOString());
  if (error) throw error;
  return (data ?? []).map(rowToPendingMatch);
}

export async function getPendingById(
  id: string,
): Promise<PendingMatch | null> {
  if (!isSupabaseConfigured()) {
    return memoryStore.find((p) => p.id === id) ?? null;
  }
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_matches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPendingMatch(data) : null;
}

export async function markPendingProcessed(args: {
  id: string;
  matchedFreelancerId: string | null;
  replyMessageId?: string | null;
}): Promise<void> {
  const now = new Date();
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("pending_matches")
      .update({
        processed_at: now.toISOString(),
        matched_freelancer_id: args.matchedFreelancerId,
        reply_message_id: args.replyMessageId ?? null,
      })
      .eq("id", args.id);
    if (error) throw error;
    return;
  }
  const pm = memoryStore.find((p) => p.id === args.id);
  if (pm) {
    pm.processedAt = now;
    pm.matchedFreelancerId = args.matchedFreelancerId;
  }
}

type SupabasePendingRow = {
  id: string;
  thread_id: string;
  user_email: string;
  subject: string | null;
  brief: Brief;
  scheduled_at: string;
  processed_at: string | null;
  matched_freelancer_id: string | null;
  phase: RequestPhase;
  created_at: string;
};

function rowToPendingMatch(row: SupabasePendingRow): PendingMatch {
  return {
    id: row.id,
    threadId: row.thread_id,
    userEmail: row.user_email,
    subject: row.subject,
    brief: row.brief,
    scheduledAt: new Date(row.scheduled_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
    matchedFreelancerId: row.matched_freelancer_id,
    phase: row.phase ?? "matching",
    createdAt: new Date(row.created_at),
  };
}
