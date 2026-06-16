/**
 * Persistence + state transitions for the freelancer outreach pool.
 * One match request (a pending_matches row) has many match_candidates, each
 * progressing queued → invited → accepted/declined/timed_out → chosen →
 * connecting → connected. See DECISIONS.md (2026-06-16).
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type {
  CandidateStatus,
  MatchCandidate,
  RankedMatch,
  RequestPhase,
} from "./types";

type CandidateRow = {
  id: string;
  request_id: string;
  thread_id: string | null;
  freelancer_id: string;
  rank: number;
  status: CandidateStatus;
  rationale: string | null;
  confidence: "high" | "medium" | "low" | null;
  outreach_thread_id: string | null;
  outreach_message_id: string | null;
  invited_at: string | null;
  responded_at: string | null;
};

function rowToCandidate(r: CandidateRow): MatchCandidate {
  return {
    id: r.id,
    requestId: r.request_id,
    threadId: r.thread_id,
    freelancerId: r.freelancer_id,
    rank: r.rank,
    status: r.status,
    rationale: r.rationale,
    confidence: r.confidence,
    outreachThreadId: r.outreach_thread_id,
    outreachMessageId: r.outreach_message_id,
    invitedAt: r.invited_at ? new Date(r.invited_at) : null,
    respondedAt: r.responded_at ? new Date(r.responded_at) : null,
  };
}

/** Persist the ranked roster for a request as `queued` candidates (rank order). */
export async function seedCandidates(args: {
  requestId: string;
  threadId: string | null;
  ranked: RankedMatch[];
}): Promise<MatchCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const rows = args.ranked.map((r) => ({
    request_id: args.requestId,
    thread_id: args.threadId,
    freelancer_id: r.freelancer.id,
    rank: r.rank,
    status: "queued" as CandidateStatus,
    rationale: r.rationale,
    confidence: r.confidence,
  }));
  const { data, error } = await sb
    .from("match_candidates")
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []).map(rowToCandidate);
}

export async function listCandidates(
  requestId: string,
): Promise<MatchCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("match_candidates")
    .select("*")
    .eq("request_id", requestId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToCandidate);
}

export function countByStatus(
  candidates: MatchCandidate[],
): Record<CandidateStatus, number> {
  const base = {
    queued: 0,
    invited: 0,
    accepted: 0,
    declined: 0,
    timed_out: 0,
    chosen: 0,
    connecting: 0,
    connected: 0,
  } as Record<CandidateStatus, number>;
  for (const c of candidates) base[c.status] += 1;
  return base;
}

/** The next-ranked freelancer still waiting to be invited, or null if dry. */
export function nextQueued(candidates: MatchCandidate[]): MatchCandidate | null {
  return (
    candidates
      .filter((c) => c.status === "queued")
      .sort((a, b) => a.rank - b.rank)[0] ?? null
  );
}

export async function markInvited(args: {
  candidateId: string;
  outreachThreadId?: string | null;
  outreachMessageId?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("match_candidates")
    .update({
      status: "invited",
      invited_at: new Date().toISOString(),
      outreach_thread_id: args.outreachThreadId ?? null,
      outreach_message_id: args.outreachMessageId ?? null,
    })
    .eq("id", args.candidateId);
  if (error) throw error;
}

export async function setCandidateStatus(
  candidateId: string,
  status: CandidateStatus,
  opts: { responded?: boolean } = {},
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { status };
  if (opts.responded) patch.responded_at = new Date().toISOString();
  const { error } = await sb
    .from("match_candidates")
    .update(patch)
    .eq("id", candidateId);
  if (error) throw error;
}

/** Find which candidate a freelancer's inbound email belongs to, by thread. */
export async function findCandidateByOutreachThread(
  outreachThreadId: string,
): Promise<MatchCandidate | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("match_candidates")
    .select("*")
    .eq("outreach_thread_id", outreachThreadId)
    .in("status", ["invited"])
    .maybeSingle();
  if (error) {
    console.warn("[candidates] findByOutreachThread failed:", error.message);
    return null;
  }
  return data ? rowToCandidate(data as CandidateRow) : null;
}

/** Invited candidates whose reply window has elapsed (for the timeout sweep). */
export async function listTimedOutInvites(
  cutoff: Date,
): Promise<MatchCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("match_candidates")
    .select("*")
    .eq("status", "invited")
    .lt("invited_at", cutoff.toISOString());
  if (error) throw error;
  return (data ?? []).map(rowToCandidate);
}

// --------------------------------------------------------------- request phase
export async function setRequestPhase(
  requestId: string,
  phase: RequestPhase,
  extra: { shortlistSentAt?: Date; connectAfter?: Date } = {},
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { phase };
  if (extra.shortlistSentAt)
    patch.shortlist_sent_at = extra.shortlistSentAt.toISOString();
  if (extra.connectAfter)
    patch.connect_after = extra.connectAfter.toISOString();
  const { error } = await sb
    .from("pending_matches")
    .update(patch)
    .eq("id", requestId);
  if (error) throw error;
}
