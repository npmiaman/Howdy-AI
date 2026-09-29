/**
 * Persistence + state transitions for the freelancer outreach pool.
 * One match request (a pending_matches row) has many match_candidates, each
 * progressing queued → invited → accepted/declined/timed_out → chosen →
 * connecting → connected. See DECISIONS.md (2026-06-16).
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { claimRow, type Filters } from "./claims";

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
  shown_to_client_at: string | null;
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
    shownToClientAt: r.shown_to_client_at ? new Date(r.shown_to_client_at) : null,
  };
}

/**
 * Persist the ranked roster for a request as `queued` candidates (rank order).
 * Idempotent: re-seeding the same request skips freelancers already in its pool,
 * so a retried outreach start can never fail on (or duplicate) existing rows.
 */
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
    .upsert(rows, { onConflict: "request_id,freelancer_id", ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return (data ?? []).map(rowToCandidate);
}

/** Every candidate across every request on a conversation (for rematches). */
export async function listCandidatesForThread(
  threadId: string,
): Promise<MatchCandidate[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("match_candidates")
    .select("*")
    .eq("thread_id", threadId);
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

/**
 * Claim a queued candidate for inviting (queued → invited) before any email is
 * sent. Only one caller can win the claim, so overlapping cron runs or webhook
 * retries can never invite the same freelancer twice. Returns false if someone
 * else already moved it.
 */
export async function claimForInvite(candidateId: string): Promise<boolean> {
  return transitionCandidate(candidateId, ["queued"], "invited", {
    invited_at: new Date().toISOString(),
  });
}

/** Undo a claim whose email failed to send, so the next run can retry it. */
export async function releaseInvite(candidateId: string): Promise<void> {
  await transitionCandidate(candidateId, ["invited"], "queued", {
    invited_at: null,
  });
}

/** Record which email thread an invite went out on (for reply routing). */
export async function recordOutreach(args: {
  candidateId: string;
  outreachThreadId?: string | null;
  outreachMessageId?: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("match_candidates")
    .update({
      outreach_thread_id: args.outreachThreadId ?? null,
      outreach_message_id: args.outreachMessageId ?? null,
    })
    .eq("id", args.candidateId);
  if (error) throw error;
}

/**
 * Move a candidate to `to` only if it's currently in one of `from`. Returns
 * whether this call made the change — the basis for every idempotent step.
 */
export async function transitionCandidate(
  candidateId: string,
  from: CandidateStatus[],
  to: CandidateStatus,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  return claimRow("match_candidates", candidateId, { status: to, ...extra }, (q) =>
    q.in("status", from),
  );
}

/** Stamp the candidates that were put in front of the client. */
export async function markShown(candidateIds: string[], at: Date): Promise<void> {
  if (!isSupabaseConfigured() || candidateIds.length === 0) return;
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("match_candidates")
    .update({ shown_to_client_at: at.toISOString() })
    .in("id", candidateIds);
  if (error) throw error;
}

// A freelancer's reply matters while we're waiting on their yes/no: either to
// the original invite, or after the client picked them before they confirmed.
const AWAITING_REPLY: CandidateStatus[] = ["invited", "chosen"];

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
    .in("status", AWAITING_REPLY)
    .order("invited_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[candidates] findByOutreachThread failed:", error.message);
    return null;
  }
  return data?.[0] ? rowToCandidate(data[0] as CandidateRow) : null;
}

/**
 * Fallback when a reply lands under a different provider thread id: match the
 * email's In-Reply-To / References against the invites we sent. Replies carry
 * those headers whatever the thread id or subject says.
 */
export async function findAwaitingCandidateByMessageIds(
  messageIds: string[],
): Promise<MatchCandidate | null> {
  if (!isSupabaseConfigured() || messageIds.length === 0) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("match_candidates")
    .select("*")
    .in("outreach_message_id", messageIds)
    .in("status", AWAITING_REPLY)
    .order("invited_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] ? rowToCandidate(data[0] as CandidateRow) : null;
}

/**
 * Time out every invite in `candidateIds` that's still unanswered, in one
 * conditional update. Returns the ones this call moved.
 */
export async function timeOutInvites(
  candidateIds: string[],
): Promise<Array<{ id: string; request_id: string }>> {
  if (!isSupabaseConfigured() || candidateIds.length === 0) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("match_candidates")
    .update({ status: "timed_out" })
    .in("id", candidateIds)
    .eq("status", "invited")
    .select("id,request_id");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; request_id: string }>;
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
  extra: { connectAfter?: Date } = {},
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { phase };
  if (extra.connectAfter)
    patch.connect_after = extra.connectAfter.toISOString();
  const { error } = await sb
    .from("pending_matches")
    .update(patch)
    .eq("id", requestId);
  if (error) throw error;
}

/**
 * Move a request between phases only if it's currently in one of `from`.
 * Returns whether this call won — so e.g. two freelancers accepting at the
 * same moment can't both trigger the client shortlist.
 */
export async function claimRequestPhase(
  requestId: string,
  from: RequestPhase[],
  to: RequestPhase,
  extra: Record<string, unknown> = {},
  where: (q: Filters) => Filters = (q) => q,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  return claimRow("pending_matches", requestId, { phase: to, ...extra }, (q) =>
    where(q.in("phase", from)),
  );
}
