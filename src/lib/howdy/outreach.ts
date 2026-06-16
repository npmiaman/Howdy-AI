/**
 * Freelancer outreach saga orchestrator. Quietly recruits a shortlist of 3
 * willing freelancers over email, invisible to the client, then hands off to
 * the client-shortlist step. See DECISIONS.md (2026-06-16).
 *
 * Everything routes through `dispatch()`, which honours HOWDY_OUTREACH_DRYRUN
 * (default ON): in dry-run, intended emails are logged + given synthetic ids,
 * never actually sent. Flip the env to go live.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { dispatch } from "./mailer";

import {
  countByStatus,
  listCandidates,
  markInvited,
  nextQueued,
  seedCandidates,
  setCandidateStatus,
  setRequestPhase,
  listTimedOutInvites,
} from "./candidates";
import { getFreelancersByIds } from "./data";
import { getChatModel } from "./llm";
import { rankMatches } from "./matcher";
import {
  clientShortlistEmail,
  connectIntro,
  connectNotice,
  freelancerAcceptAck,
  freelancerPitch,
} from "./outreach-content";
import type { PendingMatch } from "./scheduler";
import {
  type Brief,
  type Freelancer,
  type MatchCandidate,
  INITIAL_INVITES,
  REPLY_TIMEOUT_HOURS,
  SHORTLIST_TARGET,
} from "./types";

const CONNECT_DELAY_MIN = Number(process.env.HOWDY_CONNECT_DELAY_MIN ?? 5);

/** How many candidates are still in play toward the shortlist of 3. */
function liveCount(candidates: MatchCandidate[]): {
  accepted: number;
  outstanding: number;
} {
  const c = countByStatus(candidates);
  return { accepted: c.accepted, outstanding: c.invited };
}

// ---------------------------------------------------------------------------
// 1. Start outreach: rank, seed the pool, invite the top INITIAL_INVITES.
// ---------------------------------------------------------------------------
export async function startOutreach(request: PendingMatch): Promise<{
  invited: number;
  poolSize: number;
}> {
  const ranked = await rankMatches(request.brief);
  await seedCandidates({
    requestId: request.id,
    threadId: request.threadId,
    ranked,
  });
  await setRequestPhase(request.id, "outreach");

  const candidates = await listCandidates(request.id);
  const freelancers = await freelancerMap(candidates);
  let invited = 0;
  for (const cand of candidates.slice(0, INITIAL_INVITES)) {
    const f = freelancers.get(cand.freelancerId);
    if (!f) continue;
    await inviteCandidate(cand, f, request.brief);
    invited += 1;
  }
  return { invited, poolSize: ranked.length };
}

/**
 * Rematch: re-run outreach for a request, excluding everyone already tried
 * (plus an explicitly disliked freelancer) and feeding the negative feedback
 * into ranking. Used by the post-match flow when a party asks for someone else.
 */
export async function restartOutreach(
  request: PendingMatch,
  opts: { excludeFreelancerIds: string[]; reason: string },
): Promise<{ invited: number }> {
  const existing = await listCandidates(request.id);
  const exclude = new Set<string>([
    ...opts.excludeFreelancerIds,
    ...existing.map((c) => c.freelancerId), // never re-invite anyone already tried
  ]);
  const rankOffset =
    existing.reduce((m, c) => Math.max(m, c.rank), -1) + 1;

  // Feed the "why it didn't work" into the brief so ranking + pitch steer clear.
  const augmentedBrief: Brief = {
    ...request.brief,
    red_flags: Array.from(
      new Set([...(request.brief.red_flags ?? []), opts.reason]),
    ),
  };

  const ranked = (await rankMatches(augmentedBrief)).filter(
    (r) => !exclude.has(r.freelancer.id),
  );
  if (ranked.length === 0) return { invited: 0 };

  await seedCandidates({
    requestId: request.id,
    threadId: request.threadId,
    ranked: ranked.map((r, i) => ({ ...r, rank: rankOffset + i })),
  });
  await setRequestPhase(request.id, "outreach");

  const fresh = (await listCandidates(request.id))
    .filter((c) => c.status === "queued" && c.rank >= rankOffset)
    .sort((a, b) => a.rank - b.rank);
  const freelancers = await freelancerMap(fresh);
  let invited = 0;
  for (const cand of fresh.slice(0, INITIAL_INVITES)) {
    const f = freelancers.get(cand.freelancerId);
    if (!f) continue;
    await inviteCandidate(cand, f, augmentedBrief);
    invited += 1;
  }
  return { invited };
}

async function inviteCandidate(
  candidate: MatchCandidate,
  freelancer: Freelancer,
  brief: Brief,
): Promise<void> {
  const text = await freelancerPitch({ freelancer, brief });
  const sent = await dispatch({
    kind: "freelancer_invite",
    to: freelancer.email,
    subject: `Quick one — are you open to a ${brief.role ?? "creative"} gig?`,
    text,
  });
  await markInvited({
    candidateId: candidate.id,
    outreachThreadId: sent.threadId,
    outreachMessageId: sent.messageId,
  });
}

/** Keep the outreach pool topped up to INITIAL_INVITES outstanding+accepted. */
async function refillInvites(requestId: string, brief: Brief): Promise<void> {
  let candidates = await listCandidates(requestId);
  const freelancers = await freelancerMap(candidates);
  // Stop once we have enough accepts.
  while (true) {
    const { accepted, outstanding } = liveCount(candidates);
    if (accepted >= SHORTLIST_TARGET) return;
    if (accepted + outstanding >= INITIAL_INVITES) return;
    const next = nextQueued(candidates);
    if (!next) return; // roster exhausted
    const f = freelancers.get(next.freelancerId);
    if (!f) {
      await setCandidateStatus(next.id, "declined"); // can't reach → skip
      candidates = await listCandidates(requestId);
      continue;
    }
    await inviteCandidate(next, f, brief);
    candidates = await listCandidates(requestId);
  }
}

// ---------------------------------------------------------------------------
// 2. A freelancer replied yes/no.
// ---------------------------------------------------------------------------
export async function handleFreelancerDecision(args: {
  candidate: MatchCandidate;
  accepted: boolean;
  request: PendingMatch;
}): Promise<{ outcome: "accepted" | "declined"; shortlistReady: boolean }> {
  const { candidate, accepted, request } = args;

  if (!accepted) {
    await setCandidateStatus(candidate.id, "declined", { responded: true });
    await refillInvites(request.id, request.brief);
    return { outcome: "declined", shortlistReady: false };
  }

  await setCandidateStatus(candidate.id, "accepted", { responded: true });
  // Warm acknowledgment to the freelancer (still anonymized).
  const freelancers = await freelancerMap([candidate]);
  const f = freelancers.get(candidate.freelancerId);
  if (f) {
    const ack = await freelancerAcceptAck(f);
    await dispatch({
      kind: "freelancer_accept_ack",
      to: f.email,
      subject: "Thanks — noted",
      text: ack,
      replyToMessageId: candidate.outreachMessageId,
    });
  }

  const candidates = await listCandidates(request.id);
  const accepts = candidates.filter((c) => c.status === "accepted");
  if (accepts.length >= SHORTLIST_TARGET) {
    await sendShortlistToClient(request, false);
    return { outcome: "accepted", shortlistReady: true };
  }
  // Not enough yet — make sure we keep enough invites outstanding.
  await refillInvites(request.id, request.brief);
  return { outcome: "accepted", shortlistReady: false };
}

// ---------------------------------------------------------------------------
// 3. Send the client the shortlist of acceptors.
// ---------------------------------------------------------------------------
export async function sendShortlistToClient(
  request: PendingMatch,
  fewerThanTarget: boolean,
): Promise<void> {
  const candidates = await listCandidates(request.id);
  const accepts = candidates
    .filter((c) => c.status === "accepted")
    .sort((a, b) => a.rank - b.rank);
  if (accepts.length === 0) return;

  const freelancers = await freelancerMap(accepts);
  const picks = accepts
    .map((c) => {
      const f = freelancers.get(c.freelancerId);
      return f ? { freelancer: f, rationale: c.rationale } : null;
    })
    .filter((p): p is { freelancer: Freelancer; rationale: string | null } => p !== null);

  const body = await clientShortlistEmail({
    brief: request.brief,
    picks,
    fewerThanTarget,
  });

  const inboundId = await lastInboundMessageId(request.threadId);
  await dispatch({
    kind: "client_shortlist",
    to: request.userEmail,
    subject: request.subject ?? "Your shortlist is ready",
    text: body,
    replyToMessageId: inboundId,
  });
  await setRequestPhase(request.id, "shortlist_sent", {
    shortlistSentAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// 4. Timeout sweep: invited + no reply past the window → pass to next-ranked.
//    Called by the cron worker.
// ---------------------------------------------------------------------------
export async function sweepTimeouts(
  requestsById: Map<string, PendingMatch>,
): Promise<{ timedOut: number }> {
  const cutoff = new Date(Date.now() - REPLY_TIMEOUT_HOURS * 60 * 60 * 1000);
  const stale = await listTimedOutInvites(cutoff);
  const touchedRequests = new Set<string>();
  for (const c of stale) {
    await setCandidateStatus(c.id, "timed_out");
    touchedRequests.add(c.requestId);
  }
  // Refill / finalize each affected request.
  for (const reqId of touchedRequests) {
    const req = requestsById.get(reqId);
    if (!req) continue;
    await refillInvites(reqId, req.brief);
    await maybeFinalizeShortlist(req);
  }
  return { timedOut: stale.length };
}

/** If the roster is exhausted and we have 1-2 accepts, send what we have. */
async function maybeFinalizeShortlist(request: PendingMatch): Promise<void> {
  const candidates = await listCandidates(request.id);
  const c = countByStatus(candidates);
  const stillInPlay = c.queued + c.invited;
  if (c.accepted >= SHORTLIST_TARGET) return; // handled on the accept path
  if (stillInPlay === 0 && c.accepted > 0) {
    // Roster dry, fewer than target accepted → send what we have + flag.
    await sendShortlistToClient(request, true);
  }
}

// ------------------------------------------------------------------ helpers
async function freelancerMap(
  candidates: MatchCandidate[],
): Promise<Map<string, Freelancer>> {
  const ids = [...new Set(candidates.map((c) => c.freelancerId))];
  const list = await getFreelancersByIds(ids);
  return new Map(list.map((f) => [f.id, f]));
}

async function lastInboundMessageId(
  threadId: string | null,
): Promise<string | null> {
  if (!threadId || !isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("messages")
    .select("gmail_message_id")
    .eq("thread_id", threadId)
    .eq("role", "human")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.gmail_message_id ?? null;
}

// ---------------------------------------------------------------------------
// Reply classification: did a freelancer say yes or no?
// ---------------------------------------------------------------------------
const DecisionSchema = z.object({
  decision: z
    .enum(["yes", "no", "unclear"])
    .describe("yes = open/available, no = decline, unclear = neither."),
});

const CLASSIFY_SYSTEM = `You classify a freelancer's reply to an availability check-in. Output one of: "yes" (they're open/interested/available), "no" (they decline or aren't available), or "unclear" (ambiguous — neither a clear yes nor no). Judge intent, not politeness.`;

export async function classifyFreelancerReply(
  text: string,
): Promise<"yes" | "no" | "unclear"> {
  const llm = getChatModel().withStructuredOutput(DecisionSchema, {
    name: "decision",
  });
  const res = await llm.invoke([
    new SystemMessage(CLASSIFY_SYSTEM),
    new HumanMessage(`Freelancer reply:\n${text}\n\nClassify it.`),
  ]);
  return res.decision;
}

// ---------------------------------------------------------------------------
// Client selection: which shortlisted freelancers did the client choose?
// ---------------------------------------------------------------------------
const SelectionSchema = z.object({
  chosen_freelancer_ids: z
    .array(z.string())
    .describe("IDs of the freelancers the client wants to connect with — one or more."),
});

const SELECT_SYSTEM = `You read a client's reply to a shortlist of freelancers and determine which one(s) they want to be connected with. The client may name people, say "the first one", "both", "all three", etc. Return the freelancer IDs that match. If genuinely none are chosen, return an empty list.`;

export async function parseClientSelection(args: {
  text: string;
  candidates: MatchCandidate[];
  freelancers: Map<string, Freelancer>;
}): Promise<string[]> {
  const roster = args.candidates
    .filter((c) => c.status === "accepted" || c.status === "chosen")
    .map((c) => {
      const f = args.freelancers.get(c.freelancerId);
      return f ? `ID: ${f.id} — ${f.name} (${f.role})` : null;
    })
    .filter(Boolean)
    .join("\n");

  const llm = getChatModel().withStructuredOutput(SelectionSchema, {
    name: "selection",
  });
  const res = await llm.invoke([
    new SystemMessage(SELECT_SYSTEM),
    new HumanMessage(
      `Shortlist shown to the client:\n${roster}\n\nClient reply:\n${args.text}\n\nWhich IDs did they choose?`,
    ),
  ]);
  const validIds = new Set(args.candidates.map((c) => c.freelancerId));
  return res.chosen_freelancer_ids.filter((id) => validIds.has(id));
}

// ---------------------------------------------------------------------------
// 5. Client picked. Mark chosen, notify them, schedule the intro.
// ---------------------------------------------------------------------------
export async function handleClientSelection(args: {
  request: PendingMatch;
  chosenFreelancerIds: string[];
}): Promise<{ chosen: number }> {
  const { request, chosenFreelancerIds } = args;
  if (chosenFreelancerIds.length === 0) return { chosen: 0 };

  const candidates = await listCandidates(request.id);
  const freelancers = await freelancerMap(candidates);
  let chosen = 0;
  for (const c of candidates) {
    if (!chosenFreelancerIds.includes(c.freelancerId)) continue;
    await setCandidateStatus(c.id, "connecting");
    const f = freelancers.get(c.freelancerId);
    if (f) {
      const notice = await connectNotice({ freelancer: f, brief: request.brief });
      await dispatch({
        kind: "freelancer_connect_notice",
        to: f.email,
        subject: "Good news — connecting you",
        text: notice,
        replyToMessageId: c.outreachMessageId,
      });
    }
    chosen += 1;
  }

  await setRequestPhase(request.id, "connecting", {
    connectAfter: new Date(Date.now() + CONNECT_DELAY_MIN * 60 * 1000),
  });
  return { chosen };
}

// ---------------------------------------------------------------------------
// 6. Fire the intro emails (CC client + freelancer). Called by the cron once
//    connect_after has elapsed.
// ---------------------------------------------------------------------------
export async function sendDueConnects(request: PendingMatch): Promise<{
  connected: number;
}> {
  const candidates = await listCandidates(request.id);
  const connecting = candidates.filter((c) => c.status === "connecting");
  if (connecting.length === 0) return { connected: 0 };

  const freelancers = await freelancerMap(connecting);
  let connected = 0;
  for (const c of connecting) {
    const f = freelancers.get(c.freelancerId);
    if (!f) continue;
    const intro = await connectIntro({
      freelancer: f,
      clientName: request.userEmail.split("@")[0],
      brief: request.brief,
      rationale: c.rationale,
    });
    await dispatch({
      kind: "connect_intro",
      to: request.userEmail,
      cc: [f.email],
      subject: `Connecting you with ${f.name}`,
      text: intro,
    });
    await setCandidateStatus(c.id, "connected");
    connected += 1;
  }
  await setRequestPhase(request.id, "connected");
  return { connected };
}
