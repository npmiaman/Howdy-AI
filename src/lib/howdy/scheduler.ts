/**
 * "Lazy match" scheduler. Real-life matching takes time; even a fast agent should
 * feel less robotic. When a brief is actionable, we don't search immediately — we
 * pick a random time inside the configured business window and defer the match.
 */
import { randomInt } from "node:crypto";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type { Brief } from "./types";

const BUSINESS_HOURS_START = Number(process.env.HOWDY_BUSINESS_HOURS_START ?? 9); // 9 AM
const BUSINESS_HOURS_END = Number(process.env.HOWDY_BUSINESS_HOURS_END ?? 16); // 4 PM

export type PendingMatch = {
  id: string;
  threadId: string;
  userEmail: string;
  subject: string | null;
  brief: Brief;
  scheduledAt: Date;
  processedAt: Date | null;
  matchedFreelancerId: string | null;
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
  };
  memoryStore.push(pm);
  return pm;
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
    .is("processed_at", null)
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return [...(data ?? []).map(rowToPendingMatch), ...inMemory];
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
  };
}
