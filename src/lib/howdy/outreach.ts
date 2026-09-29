/**
 * Freelancer outreach saga orchestrator. Quietly recruits a shortlist of 3
 * willing freelancers over email, invisible to the client, then hands off to
 * the client-shortlist step. See DECISIONS.md (2026-06-16, 2026-09-29).
 *
 * Everything routes through `dispatch()`, which honours HOWDY_OUTREACH_DRYRUN
 * (default ON): in dry-run, intended emails are logged + given synthetic ids,
 * never actually sent. Flip the env to go live.
 *
 * Every step that sends email first *claims* its state change (claims.ts), so
 * overlapping cron runs and retried webhooks can't double-invite or
 * double-send. The step functions own their claims; callers just loop.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import { firstName } from "@/lib/utils";

import { recordBillableIntro } from "./billing";
import { leaseFree, releaseClaim } from "./claims";
import {
  claimForInvite,
  claimRequestPhase,
  countByStatus,
  listCandidates,
  listCandidatesForThread,
  listTimedOutInvites,
  markShown,
  recordOutreach,
  releaseInvite,
  seedCandidates,
  setRequestPhase,
  timeOutInvites,
  transitionCandidate,
} from "./candidates";
import { getFreelancerMap } from "./data";
import { getChatModel } from "./llm";
import { dispatch, type SendResult } from "./mailer";
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
  claimConnect,
  claimPending,
  claimShortlist,
  type PendingMatch,
  queueRequestNow,
} from "./scheduler";
import { OPT_OUT_LINE } from "./suppression";
import { getLatestGmailMessageId } from "./threads";
import {
  type Brief,
  type CandidateStatus,
  type Freelancer,
  type MatchCandidate,
  INITIAL_INVITES,
  REPLY_TIMEOUT_HOURS,
  SHORTLIST_TARGET,
} from "./types";

const CONNECT_DELAY_MIN = Number(process.env.HOWDY_CONNECT_DELAY_MIN ?? 5);

type FreelancerMap = Map<string, Freelancer>;

// ---------------------------------------------------------------------------
// 1. Start outreach for a due request: claim it, rank, seed the pool (minus
//    anyone already contacted on this conversation — which is what makes a
//    rematch recruit fresh people), invite the top INITIAL_INVITES. A pool of
//    zero closes the request with an honest email. Safe to re-run.
// ---------------------------------------------------------------------------
export async function startOutreach(
  request: PendingMatch,
): Promise<{ skipped: true } | { skipped: false; invited: number; poolSize: number }> {
  if (!(await claimPending(request.id))) return { skipped: true };
  try {
    const contacted = new Set(
      (await listCandidatesForThread(request.threadId))
        .filter((c) => c.requestId !== request.id && c.status !== "queued")
        .map((c) => c.freelancerId),
    );
    const ranked = (await rankMatches(request.brief)).filter(
      (r) => !contacted.has(r.freelancer.id),
    );
    if (ranked.length === 0) {
      await failRequest(request);
      return { skipped: false, invited: 0, poolSize: 0 };
    }
    await seedCandidates({
      requestId: request.id,
      threadId: request.threadId,
      ranked: ranked.map((r, i) => ({ ...r, rank: i })),
    });
    await setRequestPhase(request.id, "outreach");
    const invited = await refillInvites(request.id, request.brief);
    return { skipped: false, invited, poolSize: ranked.length };
  } catch (err) {
    await releaseClaim("pending_matches", request.id, { processed_at: null });
    throw err;
  }
}

/**
 * Rematch: queue a fresh request on the same conversation, with the "why it
 * didn't work" folded into the brief so ranking steers clear. The cron starts
 * it like any other request (so the webhook never waits on ranking + pitches),
 * and startOutreach skips everyone already contacted here.
 */
export async function startRematch(args: {
  request: PendingMatch;
  reason: string;
  brief?: Brief;
}): Promise<void> {
  const base = args.brief ?? args.request.brief;
  await queueRequestNow({
    threadId: args.request.threadId,
    userEmail: args.request.userEmail,
    subject: args.request.subject,
    brief: {
      ...base,
      red_flags: Array.from(new Set([...(base.red_flags ?? []), args.reason])),
    },
  });
}

/**
 * Invite several candidates at once. Every claim (queued → invited) is taken
 * before any email is written; then each claimed candidate's pitch and send
 * run in parallel. A failed send releases just that claim so a later run
 * retries it. Returns how many were invited.
 */
async function inviteCandidates(
  candidates: MatchCandidate[],
  freelancers: FreelancerMap,
  brief: Brief,
): Promise<number> {
  const claimed = (
    await Promise.all(candidates.map(async (c) => ((await claimForInvite(c.id)) ? c : null)))
  ).filter((c): c is MatchCandidate => c !== null);

  const results = await Promise.allSettled(
    claimed.map(async (c) => {
      const f = freelancers.get(c.freelancerId)!;
      try {
        const sent = await dispatch({
          kind: "freelancer_invite",
          to: f.email,
          subject: `Quick one: are you open to a ${brief.role ?? "creative"} gig?`,
          text: `${await freelancerPitch({ freelancer: f, brief })}\n\n${OPT_OUT_LINE}`,
        });
        await recordOutreach({
          candidateId: c.id,
          outreachThreadId: sent.threadId,
          outreachMessageId: sent.messageId,
        });
      } catch (err) {
        await releaseInvite(c.id);
        throw err;
      }
    }),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
  return claimed.length;
}

/** Keep the outreach pool topped up to INITIAL_INVITES outstanding+accepted. */
async function refillInvites(requestId: string, brief: Brief): Promise<number> {
  let candidates = await listCandidates(requestId);
  const freelancers = await getFreelancerMap(candidates.map((c) => c.freelancerId));
  let invited = 0;
  while (true) {
    const c = countByStatus(candidates);
    const need = Math.min(SHORTLIST_TARGET - c.accepted, INITIAL_INVITES - c.accepted - c.invited);
    const queued = candidates.filter((x) => x.status === "queued").sort((a, b) => a.rank - b.rank);
    if (need <= 0 || queued.length === 0) return invited;

    const next = queued.slice(0, need);
    const unreachable = next.filter((x) => !freelancers.has(x.freelancerId));
    await Promise.all(unreachable.map((x) => transitionCandidate(x.id, ["queued"], "declined")));
    invited += await inviteCandidates(
      next.filter((x) => freelancers.has(x.freelancerId)),
      freelancers,
      brief,
    );
    candidates = await listCandidates(requestId);
  }
}

// ---------------------------------------------------------------------------
// 2. A freelancer replied yes/no — to an invite, or after the client already
//    picked them (status `chosen`).
// ---------------------------------------------------------------------------
type DecisionResult = { outcome: "accepted" | "declined" | "noop"; shortlistReady: boolean };

const DECISION: Record<"invited" | "chosen", Record<"yes" | "no", CandidateStatus>> = {
  invited: { yes: "accepted", no: "declined" },
  chosen: { yes: "connecting", no: "declined" },
};

export async function handleFreelancerDecision(args: {
  candidate: MatchCandidate;
  accepted: boolean;
  request: PendingMatch;
}): Promise<DecisionResult> {
  const { candidate, accepted, request } = args;
  const from = candidate.status === "chosen" ? "chosen" : "invited";
  const moved = await transitionCandidate(candidate.id, [from], DECISION[from][accepted ? "yes" : "no"], {
    responded_at: new Date().toISOString(),
  });
  if (!moved) return { outcome: "noop", shortlistReady: false };
  const f = (await getFreelancerMap([candidate.freelancerId])).get(candidate.freelancerId);

  // Picked by the client before they'd confirmed: their answer settles it.
  if (from === "chosen") {
    if (accepted) {
      if (f) await sendConnectNotice(candidate, f);
      await setRequestPhase(request.id, "connecting", {
        connectAfter: new Date(Date.now() + CONNECT_DELAY_MIN * 60 * 1000),
      });
      return { outcome: "accepted", shortlistReady: false };
    }
    if (f) await tellClient(request, "client_chosen_unavailable", chosenUnavailableNotice(f));
    const stillPicked = (await listCandidates(request.id)).some((c) =>
      ["chosen", "connecting"].includes(c.status),
    );
    if (!stillPicked) await setRequestPhase(request.id, "shortlist_sent");
    return { outcome: "declined", shortlistReady: false };
  }

  if (!accepted) {
    if (request.phase === "outreach") {
      await refillInvites(request.id, request.brief);
      await maybeFinalizeShortlist(request);
    }
    return { outcome: "declined", shortlistReady: false };
  }

  // Warm acknowledgment to the freelancer (still anonymized).
  if (f)
    await dispatch({
      kind: "freelancer_accept_ack",
      to: f.email,
      subject: "Thanks, noted",
      text: freelancerAcceptAck(f),
      replyToMessageId: candidate.outreachMessageId,
    });

  // Once the client has a shortlist, a late yes just makes them pickable.
  if (request.phase !== "outreach") return { outcome: "accepted", shortlistReady: false };

  const accepts = (await listCandidates(request.id)).filter((c) => c.status === "accepted");
  if (accepts.length >= SHORTLIST_TARGET) {
    const sent = await sendShortlistToClient(request, false, accepts);
    return { outcome: "accepted", shortlistReady: sent };
  }
  // Not enough yet — make sure we keep enough invites outstanding.
  await refillInvites(request.id, request.brief);
  return { outcome: "accepted", shortlistReady: false };
}

// ---------------------------------------------------------------------------
// 3. Send the client the shortlist of acceptors. Returns whether this call
//    sent it: it takes the same shortlist claim as the 24h fallback, so the
//    two can never both send.
// ---------------------------------------------------------------------------
export async function sendShortlistToClient(
  request: PendingMatch,
  fewerThanTarget: boolean,
  accepts?: MatchCandidate[],
): Promise<boolean> {
  const shown = (accepts ?? (await listCandidates(request.id)).filter((c) => c.status === "accepted"))
    .sort((a, b) => a.rank - b.rank);
  if (shown.length === 0) return false;

  const claimed = await claimRequestPhase(
    request.id,
    ["outreach"],
    "shortlist_sent",
    { shortlist_sent_at: new Date().toISOString() },
    (q) => q.or(leaseFree("shortlist_sent_at")),
  );
  if (!claimed) return false;

  try {
    await deliverShortlist(request, shown, { fewerThanTarget, provisional: false });
    return true;
  } catch (err) {
    await claimRequestPhase(request.id, ["shortlist_sent"], "outreach", { shortlist_sent_at: null });
    throw err;
  }
}

/** Email the shortlist on the client's conversation and stamp who was shown. */
async function deliverShortlist(
  request: PendingMatch,
  shown: MatchCandidate[],
  opts: { fewerThanTarget: boolean; provisional: boolean; freelancers?: FreelancerMap },
): Promise<number> {
  const freelancers = opts.freelancers ?? (await getFreelancerMap(shown.map((c) => c.freelancerId)));
  const picks = shown.flatMap((c) => {
    const f = freelancers.get(c.freelancerId);
    return f ? [{ freelancer: f, rationale: c.rationale }] : [];
  });
  if (picks.length === 0) return 0;

  const body = await clientShortlistEmail({
    brief: request.brief,
    picks,
    fewerThanTarget: opts.fewerThanTarget,
    provisional: opts.provisional,
  });
  await tellClient(request, "client_shortlist", body);
  await markShown(shown.map((c) => c.id), new Date());
  return picks.length;
}

// ---------------------------------------------------------------------------
// 3b. Hard 24h fallback. If the recruit-then-confirm flow hasn't produced a
//     shortlist in time, deliver the best-ranked DB matches directly so the
//     client always gets something inside 24h. Prefers freelancers who already
//     accepted; otherwise sends top-ranked picks flagged as still-being-
//     confirmed — inviting any not yet contacted *before* the email goes out,
//     so "I'm confirming their availability" is true. Never shows decliners.
// ---------------------------------------------------------------------------
export async function deliverFallbackShortlist(request: PendingMatch): Promise<{
  delivered: boolean;
  skipped: boolean;
  count: number;
  provisional: boolean;
}> {
  if (!(await claimShortlist(request.id)))
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

    const accepts = candidates.filter((c) => c.status === "accepted");
    const provisional = accepts.length === 0;
    const shown = (provisional ? candidates.filter((c) => c.status !== "declined") : accepts)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, SHORTLIST_TARGET);
    if (shown.length === 0) {
      await releaseClaim("pending_matches", request.id, { shortlist_sent_at: null });
      return { delivered: false, skipped: false, count: 0, provisional };
    }

    const freelancers = await getFreelancerMap(shown.map((c) => c.freelancerId));
    if (provisional) {
      const uncontacted = shown.filter((c) => c.status === "queued" && freelancers.has(c.freelancerId));
      await inviteCandidates(uncontacted, freelancers, request.brief);
    }
    const count = await deliverShortlist(request, shown, {
      fewerThanTarget: shown.length < SHORTLIST_TARGET,
      provisional,
      freelancers,
    });
    await setRequestPhase(request.id, "shortlist_sent");
    return { delivered: true, skipped: false, count, provisional };
  } catch (err) {
    await releaseClaim("pending_matches", request.id, { shortlist_sent_at: null });
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
  const stale = (await listTimedOutInvites(cutoff)).filter((c) => requestsById.has(c.requestId));
  const moved = await timeOutInvites(stale.map((c) => c.id));
  // Refill / finalize each affected request.
  for (const reqId of new Set(moved.map((c) => c.request_id))) {
    const req = requestsById.get(reqId)!;
    await refillInvites(reqId, req.brief);
    await maybeFinalizeShortlist(req);
  }
  return { timedOut: moved.length };
}

/** If the roster is exhausted and we have 1-2 accepts, send what we have. */
async function maybeFinalizeShortlist(request: PendingMatch): Promise<void> {
  const candidates = await listCandidates(request.id);
  const c = countByStatus(candidates);
  if (c.accepted >= SHORTLIST_TARGET) return; // handled on the accept path
  if (c.queued + c.invited === 0 && c.accepted > 0) {
    // Roster dry, fewer than target accepted → send what we have + flag.
    await sendShortlistToClient(
      request,
      true,
      candidates.filter((x) => x.status === "accepted"),
    );
  }
}

// ------------------------------------------------------------------ helpers
/**
 * The message to reply to so an email lands in the client's conversation:
 * their latest email if they've sent one, otherwise our latest (e.g. a web-chat
 * handoff thread, where the transcript has no email ids).
 */
async function replyTarget(threadId: string | null): Promise<string | null> {
  if (!threadId || !isSupabaseConfigured()) return null;
  const { data } = await getSupabaseAdmin()
    .from("messages")
    .select("gmail_message_id")
    .eq("thread_id", threadId)
    .eq("role", "human")
    .not("gmail_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.gmail_message_id as string | undefined) ?? (await getLatestGmailMessageId(threadId));
}

/** Email the client on their conversation, and record it there once sent. */
export async function tellClient(
  request: PendingMatch,
  kind: string,
  text: string,
  replyToMessageId?: string | null,
): Promise<SendResult> {
  return dispatch({
    kind,
    to: request.userEmail,
    subject: request.subject ?? "Your Howdy search",
    text,
    replyToMessageId: replyToMessageId ?? (await replyTarget(request.threadId)),
    threadId: request.threadId,
  });
}

// ---------------------------------------------------------------------------
// Reply classification: did a freelancer say yes or no?
// ---------------------------------------------------------------------------
const DecisionSchema = z.object({
  decision: z
    .enum(["yes", "no", "question", "unclear"])
    .describe(
      "yes = open/available, no = decline, question = they ask about the gig before deciding, unclear = none of these.",
    ),
});

const CLASSIFY_SYSTEM = `You classify a freelancer's reply to an availability check-in. Output one of: "yes" (they're open/interested/available), "no" (they decline or aren't available), "question" (they ask something about the gig, like budget, timeline or scope, before deciding), or "unclear" (none of these). A reply that says yes and also asks a question is "yes". Judge intent, not politeness.`;

export async function classifyFreelancerReply(
  text: string,
): Promise<"yes" | "no" | "question" | "unclear"> {
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

  const freelancers = await getFreelancerMap(candidates.map((c) => c.freelancerId));
  const confirmed: string[] = [];
  const pending: string[] = [];
  for (const c of candidates) {
    const f = freelancers.get(c.freelancerId);
    if (!f) continue;
    if (c.status === "accepted") {
      if (await transitionCandidate(c.id, ["accepted"], "connecting")) {
        await sendConnectNotice(c, f);
        confirmed.push(firstName(f.name));
      }
    } else if (["invited", "timed_out", "queued"].includes(c.status)) {
      // Normally already invited when shown; a queued one means that invite
      // never went out, so send it first.
      if (c.status === "queued") await inviteCandidates([c], freelancers, request.brief);
      if (await transitionCandidate(c.id, ["invited", "timed_out"], "chosen")) {
        await dispatch({
          kind: "freelancer_chosen_nudge",
          to: f.email,
          subject: "The client picked you",
          text: chosenNudge(f),
          replyToMessageId: c.outreachMessageId,
        });
        pending.push(firstName(f.name));
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

async function sendConnectNotice(candidate: MatchCandidate, freelancer: Freelancer): Promise<void> {
  await dispatch({
    kind: "freelancer_connect_notice",
    to: freelancer.email,
    subject: "Good news: connecting you",
    text: connectNotice(freelancer),
    replyToMessageId: candidate.outreachMessageId,
  });
}

// ---------------------------------------------------------------------------
// 6. Fire the intro emails (CC client + freelancer) once connect_after has
//    elapsed. Claims the send; a failed run releases it to retry.
// ---------------------------------------------------------------------------
export async function sendDueConnects(
  request: PendingMatch,
): Promise<{ skipped: true } | { skipped: false; connected: number }> {
  if (!(await claimConnect(request.id))) return { skipped: true };
  try {
    const candidates = await listCandidates(request.id);
    const connecting = candidates.filter((c) => c.status === "connecting");
    const freelancers = await getFreelancerMap(connecting.map((c) => c.freelancerId));
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
      await recordBillableIntro({
        requestId: request.id,
        candidateId: c.id,
        clientEmail: request.userEmail,
        freelancerId: f.id,
      });
      connected += 1;
    }
    if (connecting.length > 0) {
      const stillPending = candidates.some((c) => c.status === "chosen");
      await setRequestPhase(request.id, stillPending ? "client_selected" : "connected");
    }
    return { skipped: false, connected };
  } catch (err) {
    await releaseClaim("pending_matches", request.id, { connect_after: new Date().toISOString() });
    throw err;
  }
}
