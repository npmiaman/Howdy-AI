/**
 * Freelancer outreach saga orchestrator. Quietly recruits a shortlist of 3
 * willing freelancers over email, invisible to the client, then hands off to
 * the client-shortlist step. See DECISIONS.md (2026-06-16, 2026-09-29).
 *
 * Everything routes through `dispatch()`, which honours HOWDY_OUTREACH_DRYRUN
 * (default ON): in dry-run, intended emails are logged + given synthetic ids,
 * never actually sent. Flip the env to go live.
 *
 * Every step that sends email first *claims* its state change with a
 * conditional update (see candidates.ts / scheduler.ts), so overlapping cron
 * runs and retried webhooks can't double-invite or double-send.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { dispatch, type SendResult } from "./mailer";

import {
  claimForInvite,
  claimRequestPhase,
  countByStatus,
  listCandidates,
  listCandidatesForThread,
  listTimedOutInvites,
  markShown,
  nextQueued,
  recordOutreach,
  releaseInvite,
  seedCandidates,
  setRequestPhase,
  transitionCandidate,
} from "./candidates";
import { getFreelancersByIds } from "./data";
import { appendMessage } from "./threads";
import { getChatModel } from "./llm";
import { rankMatches } from "./matcher";
import {
  chosenNudge,
  chosenUnavailableNotice,
  clientShortlistEmail,
  connectIntro,
  connectNotice,
  freelancerAcceptAck,
  freelancerPitch,
  noMatchNotice,
  selectionAck,
} from "./outreach-content";
import {
  claimFallback,
  createImmediateRequest,
  type PendingMatch,
  releaseFallback,
} from "./scheduler";
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
//    Safe to re-run: seeding skips existing rows and invites are claimed.
// ---------------------------------------------------------------------------
export async function startOutreach(request: PendingMatch): Promise<{
  invited: number;
  poolSize: number;
}> {
  const ranked = await rankMatches(request.brief);
  if (ranked.length === 0) return { invited: 0, poolSize: 0 };
  await seedCandidates({
    requestId: request.id,
    threadId: request.threadId,
    ranked,
  });
  await setRequestPhase(request.id, "outreach");
  const invited = await refillInvites(request.id, request.brief);
  return { invited, poolSize: ranked.length };
}

/**
 * Rematch: a fresh request on the same conversation, recruiting only people
 * who haven't been contacted for it yet (plus anyone explicitly excluded), with
 * the "why it didn't work" folded into the brief so ranking steers clear.
 * A new request (rather than reopening the old one) restarts the 24h shortlist
 * guarantee for the new search.
 */
export async function startRematch(args: {
  request: PendingMatch;
  excludeFreelancerIds: string[];
  reason: string;
  brief?: Brief;
}): Promise<{ started: boolean; invited: number }> {
  const base = args.brief ?? args.request.brief;
  const brief: Brief = {
    ...base,
    red_flags: Array.from(new Set([...(base.red_flags ?? []), args.reason])),
  };
  const contacted = (await listCandidatesForThread(args.request.threadId))
    .filter((c) => c.status !== "queued")
    .map((c) => c.freelancerId);
  const exclude = new Set([...args.excludeFreelancerIds, ...contacted]);

  const ranked = (await rankMatches(brief)).filter(
    (r) => !exclude.has(r.freelancer.id),
  );
  if (ranked.length === 0) return { started: false, invited: 0 };

  const next = await createImmediateRequest({
    threadId: args.request.threadId,
    userEmail: args.request.userEmail,
    subject: args.request.subject,
    brief,
  });
  await seedCandidates({
    requestId: next.id,
    threadId: next.threadId,
    ranked: ranked.map((r, i) => ({ ...r, rank: i })),
  });
  await setRequestPhase(next.id, "outreach");
  const invited = await refillInvites(next.id, brief);
  return { started: true, invited };
}

/**
 * Invite one candidate. Claims queued → invited before sending; if the send
 * fails the claim is released so a later run retries. Returns false when
 * another run already claimed this candidate.
 */
async function inviteCandidate(
  candidate: MatchCandidate,
  freelancer: Freelancer,
  brief: Brief,
): Promise<boolean> {
  if (!(await claimForInvite(candidate.id))) return false;
  try {
    const text = await freelancerPitch({ freelancer, brief });
    const sent = await dispatch({
      kind: "freelancer_invite",
      to: freelancer.email,
      subject: `Quick one — are you open to a ${brief.role ?? "creative"} gig?`,
      text,
    });
    await recordOutreach({
      candidateId: candidate.id,
      outreachThreadId: sent.threadId,
      outreachMessageId: sent.messageId,
    });
    return true;
  } catch (err) {
    await releaseInvite(candidate.id);
    throw err;
  }
}

/** Keep the outreach pool topped up to INITIAL_INVITES outstanding+accepted. */
async function refillInvites(requestId: string, brief: Brief): Promise<number> {
  let candidates = await listCandidates(requestId);
  const freelancers = await freelancerMap(candidates);
  let invited = 0;
  while (true) {
    const { accepted, outstanding } = liveCount(candidates);
    if (accepted >= SHORTLIST_TARGET) return invited;
    if (accepted + outstanding >= INITIAL_INVITES) return invited;
    const next = nextQueued(candidates);
    if (!next) return invited; // roster exhausted
    const f = freelancers.get(next.freelancerId);
    if (!f) {
      await transitionCandidate(next.id, ["queued"], "declined"); // can't reach → skip
    } else if (await inviteCandidate(next, f, brief)) {
      invited += 1;
    }
    candidates = await listCandidates(requestId);
  }
}

// ---------------------------------------------------------------------------
// 2. A freelancer replied yes/no — to an invite, or after the client already
//    picked them (status `chosen`).
// ---------------------------------------------------------------------------
export async function handleFreelancerDecision(args: {
  candidate: MatchCandidate;
  accepted: boolean;
  request: PendingMatch;
}): Promise<{ outcome: "accepted" | "declined" | "noop"; shortlistReady: boolean }> {
  const { candidate, accepted, request } = args;
  if (candidate.status === "chosen")
    return confirmChosen(candidate, accepted, request);

  const now = new Date().toISOString();
  if (!accepted) {
    const moved = await transitionCandidate(candidate.id, ["invited"], "declined", {
      responded_at: now,
    });
    if (!moved) return { outcome: "noop", shortlistReady: false };
    if (request.phase === "outreach") {
      await refillInvites(request.id, request.brief);
      await maybeFinalizeShortlist(request);
    }
    return { outcome: "declined", shortlistReady: false };
  }

  const moved = await transitionCandidate(candidate.id, ["invited"], "accepted", {
    responded_at: now,
  });
  if (!moved) return { outcome: "noop", shortlistReady: false };
  // Warm acknowledgment to the freelancer (still anonymized).
  const f = (await freelancerMap([candidate])).get(candidate.freelancerId);
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

  // Once the client has a shortlist, a late yes just makes them pickable.
  if (request.phase !== "outreach")
    return { outcome: "accepted", shortlistReady: false };

  const accepts = (await listCandidates(request.id)).filter(
    (c) => c.status === "accepted",
  );
  if (accepts.length >= SHORTLIST_TARGET) {
    const sent = await sendShortlistToClient(request, false);
    return { outcome: "accepted", shortlistReady: sent };
  }
  // Not enough yet — make sure we keep enough invites outstanding.
  await refillInvites(request.id, request.brief);
  return { outcome: "accepted", shortlistReady: false };
}

/** The client already picked this freelancer; their yes/no settles it. */
async function confirmChosen(
  candidate: MatchCandidate,
  accepted: boolean,
  request: PendingMatch,
): Promise<{ outcome: "accepted" | "declined" | "noop"; shortlistReady: boolean }> {
  const now = new Date().toISOString();
  const f = (await freelancerMap([candidate])).get(candidate.freelancerId);
  if (accepted) {
    const moved = await transitionCandidate(candidate.id, ["chosen"], "connecting", {
      responded_at: now,
    });
    if (!moved) return { outcome: "noop", shortlistReady: false };
    if (f) await sendConnectNotice(candidate, f, request.brief);
    await setRequestPhase(request.id, "connecting", {
      connectAfter: new Date(Date.now() + CONNECT_DELAY_MIN * 60 * 1000),
    });
    return { outcome: "accepted", shortlistReady: false };
  }

  const moved = await transitionCandidate(candidate.id, ["chosen"], "declined", {
    responded_at: now,
  });
  if (!moved) return { outcome: "noop", shortlistReady: false };
  if (f) await tellClient(request, "client_chosen_unavailable", chosenUnavailableNotice(f));
  const remaining = (await listCandidates(request.id)).filter((c) =>
    ["chosen", "connecting"].includes(c.status),
  );
  if (remaining.length === 0) await setRequestPhase(request.id, "shortlist_sent");
  return { outcome: "declined", shortlistReady: false };
}

// ---------------------------------------------------------------------------
// 3. Send the client the shortlist of acceptors. Returns whether this call
//    sent it (only one caller can move the request out of `outreach`).
// ---------------------------------------------------------------------------
export async function sendShortlistToClient(
  request: PendingMatch,
  fewerThanTarget: boolean,
): Promise<boolean> {
  const accepts = (await listCandidates(request.id))
    .filter((c) => c.status === "accepted")
    .sort((a, b) => a.rank - b.rank);
  if (accepts.length === 0) return false;

  const sentAt = new Date();
  const claimed = await claimRequestPhase(request.id, ["outreach"], "shortlist_sent", {
    shortlist_sent_at: sentAt.toISOString(),
  });
  if (!claimed) return false;

  const shown = accepts;
  try {
    await deliverShortlist(request, shown, { fewerThanTarget, provisional: false });
    await markShown(shown.map((c) => c.id), sentAt);
    return true;
  } catch (err) {
    await setRequestPhase(request.id, "outreach", { shortlistSentAt: null });
    throw err;
  }
}

async function deliverShortlist(
  request: PendingMatch,
  shown: MatchCandidate[],
  opts: { fewerThanTarget: boolean; provisional: boolean },
): Promise<number> {
  const freelancers = await freelancerMap(shown);
  const picks = shown
    .map((c) => {
      const f = freelancers.get(c.freelancerId);
      return f ? { freelancer: f, rationale: c.rationale } : null;
    })
    .filter((p): p is { freelancer: Freelancer; rationale: string | null } => p !== null);
  if (picks.length === 0) return 0;

  const body = await clientShortlistEmail({
    brief: request.brief,
    picks,
    fewerThanTarget: opts.fewerThanTarget,
    provisional: opts.provisional,
  });
  await tellClient(request, "client_shortlist", body);
  return picks.length;
}

// ---------------------------------------------------------------------------
// 3b. Hard 24h fallback. If the recruit-then-confirm flow hasn't produced a
//     shortlist in time, deliver the best-ranked DB matches directly so the
//     client always gets something inside 24h. Prefers freelancers who already
//     accepted; otherwise sends top-ranked picks flagged as still-being-
//     confirmed — and actually invites any of them not yet contacted, so the
//     "I'm confirming their availability" copy is true. Never shows anyone
//     who declined.
// ---------------------------------------------------------------------------
export async function deliverFallbackShortlist(request: PendingMatch): Promise<{
  delivered: boolean;
  skipped: boolean;
  count: number;
  provisional: boolean;
}> {
  if (!(await claimFallback(request.id)))
    return { delivered: false, skipped: true, count: 0, provisional: false };

  try {
    let candidates = await listCandidates(request.id);
    // Outreach may never have started (phase still 'matching') — rank now.
    if (candidates.length === 0) {
      const ranked = await rankMatches(request.brief);
      if (ranked.length > 0)
        await seedCandidates({ requestId: request.id, threadId: request.threadId, ranked });
      candidates = await listCandidates(request.id);
    }

    const accepts = candidates
      .filter((c) => c.status === "accepted")
      .sort((a, b) => a.rank - b.rank);
    const provisional = accepts.length === 0;
    const shown = (
      provisional
        ? candidates.filter((c) => c.status !== "declined").sort((a, b) => a.rank - b.rank)
        : accepts
    ).slice(0, SHORTLIST_TARGET);
    if (shown.length === 0) {
      await releaseFallback(request.id);
      return { delivered: false, skipped: false, count: 0, provisional };
    }

    const count = await deliverShortlist(request, shown, {
      fewerThanTarget: shown.length < SHORTLIST_TARGET,
      provisional,
    });
    await markShown(shown.map((c) => c.id), new Date());
    await setRequestPhase(request.id, "shortlist_sent");

    if (provisional) {
      const freelancers = await freelancerMap(shown);
      for (const c of shown.filter((x) => x.status === "queued")) {
        const f = freelancers.get(c.freelancerId);
        if (f) await inviteCandidate(c, f, request.brief);
      }
    }
    return { delivered: true, skipped: false, count, provisional };
  } catch (err) {
    await releaseFallback(request.id);
    throw err;
  }
}

/** Nobody fits: close the request and tell the client honestly what to do. */
export async function failRequest(request: PendingMatch): Promise<void> {
  await setRequestPhase(request.id, "failed");
  await tellClient(request, "client_no_match", noMatchNotice(request.brief.role));
}

// ---------------------------------------------------------------------------
// 4. Timeout sweep: invited + no reply past the window → pass to next-ranked.
//    Only for requests still recruiting. Called by the cron worker.
// ---------------------------------------------------------------------------
export async function sweepTimeouts(
  requestsById: Map<string, PendingMatch>,
): Promise<{ timedOut: number }> {
  const cutoff = new Date(Date.now() - REPLY_TIMEOUT_HOURS * 60 * 60 * 1000);
  const stale = (await listTimedOutInvites(cutoff)).filter((c) =>
    requestsById.has(c.requestId),
  );
  const touchedRequests = new Set<string>();
  let timedOut = 0;
  for (const c of stale) {
    if (await transitionCandidate(c.id, ["invited"], "timed_out")) {
      timedOut += 1;
      touchedRequests.add(c.requestId);
    }
  }
  // Refill / finalize each affected request.
  for (const reqId of touchedRequests) {
    const req = requestsById.get(reqId)!;
    await refillInvites(reqId, req.brief);
    await maybeFinalizeShortlist(req);
  }
  return { timedOut };
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

export async function lastInboundMessageId(
  threadId: string | null,
): Promise<string | null> {
  if (!threadId || !isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("messages")
    .select("gmail_message_id")
    .eq("thread_id", threadId)
    .eq("role", "human")
    .not("gmail_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.gmail_message_id ?? null;
}

/**
 * Email the client on their conversation (as a reply to their latest message)
 * and record it on the thread, so the history shows what Howdy actually sent.
 */
export async function tellClient(
  request: PendingMatch,
  kind: string,
  text: string,
  replyToMessageId?: string | null,
): Promise<SendResult> {
  const sent = await dispatch({
    kind,
    to: request.userEmail,
    subject: request.subject ?? "Your Howdy search",
    text,
    replyToMessageId: replyToMessageId ?? (await lastInboundMessageId(request.threadId)),
  });
  if (sent.delivered)
    await appendMessage({
      threadId: request.threadId,
      role: "ai",
      content: text,
      gmailMessageId: sent.messageId,
    });
  return sent;
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
// 5. Client picked from the shortlist. Confirmed freelancers go straight to
//    connecting; unconfirmed (provisional) picks become `chosen` and get a
//    nudge — the intro waits for their yes. Only candidates actually shown to
//    the client can be picked.
// ---------------------------------------------------------------------------
export async function handleClientSelection(args: {
  request: PendingMatch;
  chosenFreelancerIds: string[];
  replyToMessageId?: string | null;
}): Promise<{ confirmed: number; pending: number }> {
  const { request } = args;
  const candidates = (await listCandidates(request.id)).filter(
    (c) => c.shownToClientAt && args.chosenFreelancerIds.includes(c.freelancerId),
  );
  if (candidates.length === 0) return { confirmed: 0, pending: 0 };

  const freelancers = await freelancerMap(candidates);
  const confirmed: string[] = [];
  const pending: string[] = [];
  for (const c of candidates) {
    const f = freelancers.get(c.freelancerId);
    if (!f) continue;
    const first = f.name.split(" ")[0];
    if (c.status === "accepted") {
      if (await transitionCandidate(c.id, ["accepted"], "connecting")) {
        await sendConnectNotice(c, f, request.brief);
        confirmed.push(first);
      }
    } else if (["invited", "timed_out", "queued"].includes(c.status)) {
      if (c.status === "queued") await inviteCandidate(c, f, request.brief);
      if (await transitionCandidate(c.id, ["invited", "timed_out"], "chosen")) {
        await dispatch({
          kind: "freelancer_chosen_nudge",
          to: f.email,
          subject: "The client picked you",
          text: chosenNudge(f),
          replyToMessageId: c.outreachMessageId,
        });
        pending.push(first);
      }
    }
  }

  if (confirmed.length > 0) {
    await setRequestPhase(request.id, "connecting", {
      connectAfter: new Date(Date.now() + CONNECT_DELAY_MIN * 60 * 1000),
    });
  } else if (pending.length > 0) {
    await setRequestPhase(request.id, "client_selected");
  }

  if (confirmed.length + pending.length > 0) {
    await tellClient(
      request,
      "client_selection_ack",
      selectionAck({ confirmed, pending }),
      args.replyToMessageId,
    );
  }
  return { confirmed: confirmed.length, pending: pending.length };
}

async function sendConnectNotice(
  candidate: MatchCandidate,
  freelancer: Freelancer,
  brief: Brief,
): Promise<void> {
  const notice = await connectNotice({ freelancer, brief });
  await dispatch({
    kind: "freelancer_connect_notice",
    to: freelancer.email,
    subject: "Good news — connecting you",
    text: notice,
    replyToMessageId: candidate.outreachMessageId,
  });
}

// ---------------------------------------------------------------------------
// 6. Fire the intro emails (CC client + freelancer). Called by the cron once
//    connect_after has elapsed and the request has been claimed.
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
    await transitionCandidate(c.id, ["connecting"], "connected");
    connected += 1;
  }
  const stillPending = candidates.some((c) => c.status === "chosen");
  await setRequestPhase(request.id, stillPending ? "client_selected" : "connected");
  return { connected };
}
