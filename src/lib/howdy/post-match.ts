/**
 * Post-match experience orchestrator. After a client + freelancer are connected,
 * Howdy checks in with BOTH (separately) 3 days later, classifies the call,
 * digs into why over a short conversation, then offers a rematch (bad) or asks
 * about a follow-up call (good). Two rounds max. See DECISIONS.md (2026-06-16).
 *
 * Driven by the cron (sendDueCheckins) and the inbound router (handleCheckinReply).
 * All email goes through the shared dry-run-aware mailer.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { listCandidates } from "./candidates";
import { getFreelancersByIds } from "./data";
import { dispatch } from "./mailer";
import { notifyOps } from "./notify";
import { startRematch } from "./outreach";
import {
  checkinEmail,
  classifyCallSentiment,
  classifyYesNo,
  digInQuestion,
  feedbackAck,
  followupQuestion,
  rematchOffer,
} from "./post-match-content";
import { getPendingById, type PendingMatch } from "./scheduler";
import {
  type CheckinParty,
  type CheckinSentiment,
  type CheckinStatus,
  type Freelancer,
  type PostMatchCheckin,
  CHECKIN_DELAY_DAYS,
  MAX_CHECKIN_ROUND,
  MAX_DIGIN_TURNS,
} from "./types";

const ROUND2_DELAY_DAYS = 5; // after they confirm a follow-up call is planned

type CheckinRow = {
  id: string;
  request_id: string;
  candidate_id: string | null;
  party: CheckinParty;
  round: number;
  status: CheckinStatus;
  sentiment: CheckinSentiment | null;
  feedback: string | null;
  to_email: string;
  checkin_thread_id: string | null;
  checkin_message_id: string | null;
  turns: number;
  scheduled_at: string;
  sent_at: string | null;
};

function rowToCheckin(r: CheckinRow): PostMatchCheckin {
  return {
    id: r.id,
    requestId: r.request_id,
    candidateId: r.candidate_id,
    party: r.party,
    round: r.round,
    status: r.status,
    sentiment: r.sentiment,
    feedback: r.feedback,
    toEmail: r.to_email,
    checkinThreadId: r.checkin_thread_id,
    checkinMessageId: r.checkin_message_id,
    turns: r.turns,
    scheduledAt: new Date(r.scheduled_at),
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
  };
}

async function update(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("post_match_checkins")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// 1. Schedule check-ins when a match is connected (called by the worker).
// ---------------------------------------------------------------------------
export async function schedulePostMatchCheckins(
  request: PendingMatch,
): Promise<{ scheduled: number }> {
  if (!isSupabaseConfigured()) return { scheduled: 0 };
  const sb = getSupabaseAdmin();
  const candidates = (await listCandidates(request.id)).filter(
    (c) => c.status === "connected",
  );
  if (candidates.length === 0) return { scheduled: 0 };

  const freelancers = await freelancerMap(candidates.map((c) => c.freelancerId));
  const when = new Date(
    Date.now() + CHECKIN_DELAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows: Record<string, unknown>[] = [];
  for (const c of candidates) {
    const f = freelancers.get(c.freelancerId);
    if (!f) continue;
    // Company side.
    rows.push({
      request_id: request.id,
      candidate_id: c.id,
      party: "company",
      round: 1,
      status: "scheduled",
      to_email: request.userEmail,
      scheduled_at: when,
    });
    // Freelancer side.
    rows.push({
      request_id: request.id,
      candidate_id: c.id,
      party: "freelancer",
      round: 1,
      status: "scheduled",
      to_email: f.email,
      scheduled_at: when,
    });
  }
  if (rows.length === 0) return { scheduled: 0 };
  const { error } = await sb
    .from("post_match_checkins")
    .upsert(rows, {
      onConflict: "request_id,candidate_id,party,round",
      ignoreDuplicates: true,
    });
  if (error) throw error;
  return { scheduled: rows.length };
}

// ---------------------------------------------------------------------------
// 2. Send due check-ins (called by the cron).
// ---------------------------------------------------------------------------
export async function sendDueCheckins(): Promise<{ sent: number }> {
  if (!isSupabaseConfigured()) return { sent: 0 };
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("post_match_checkins")
    .select("*")
    .eq("status", "scheduled")
    .is("sent_at", null)
    .lte("scheduled_at", new Date().toISOString());
  if (error) throw error;
  const due = (data ?? []).map(rowToCheckin);

  let sent = 0;
  for (const ch of due) {
    // Claim before sending so overlapping cron runs send each check-in once.
    const { data: claimed } = await sb
      .from("post_match_checkins")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", ch.id)
      .eq("status", "scheduled")
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    try {
      const counterpart = await counterpartName(ch);
      const text = await checkinEmail({
        party: ch.party,
        counterpartName: counterpart,
        round: ch.round,
      });
      const res = await dispatch({
        kind: `checkin_${ch.party}_r${ch.round}`,
        to: ch.toEmail,
        subject:
          ch.round >= 2 ? "How'd the follow-up go?" : "How was the call?",
        text,
      });
      await update(ch.id, {
        status: "awaiting_reply",
        checkin_thread_id: res.threadId,
        checkin_message_id: res.messageId,
        sent_at: new Date().toISOString(),
      });
      sent += 1;
    } catch (e) {
      console.error("[post-match] sendCheckin failed:", e);
      await update(ch.id, { sent_at: null }); // release the claim → retry next run
    }
  }
  return { sent };
}

// ---------------------------------------------------------------------------
// 3. Inbound: a reply to a check-in. Drives the conversation state machine.
// ---------------------------------------------------------------------------
export async function findCheckinByThread(
  threadId: string,
): Promise<PostMatchCheckin | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("post_match_checkins")
    .select("*")
    .eq("checkin_thread_id", threadId)
    .not("status", "in", "(done)")
    .order("sent_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[post-match] findByThread:", error.message);
    return null;
  }
  return data?.[0] ? rowToCheckin(data[0] as CheckinRow) : null;
}

/**
 * Fallback when a check-in reply arrives under a new provider thread id: an
 * open check-in to this sender, but only if the subject is a check-in reply —
 * so an unrelated new email from the same person is never swallowed here.
 */
export async function findOpenCheckinBySender(args: {
  email: string;
  subject: string;
}): Promise<PostMatchCheckin | null> {
  if (!isSupabaseConfigured() || !args.email) return null;
  if (!/how was the call|how'd the follow-up go|your call/i.test(args.subject))
    return null;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("post_match_checkins")
    .select("*")
    .ilike("to_email", args.email)
    .not("status", "in", "(done,scheduled)")
    .order("sent_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0] ? rowToCheckin(data[0] as CheckinRow) : null;
}

export async function handleCheckinReply(args: {
  checkin: PostMatchCheckin;
  text: string;
}): Promise<{ stage: string }> {
  const ch = args.checkin;
  const text = args.text.trim();
  const reply = (t: string) =>
    dispatch({
      kind: `checkin_reply_${ch.party}`,
      to: ch.toEmail,
      subject: "Re: your call",
      text: t,
      replyToMessageId: ch.checkinMessageId,
    });

  // --- First reply: classify good/bad. ---
  if (ch.status === "awaiting_reply") {
    const s = await classifyCallSentiment(text);
    if (s === "unclear") {
      await reply(
        "Thanks for getting back — could you say a bit more about how it actually went?",
      );
      return { stage: "sentiment_unclear" };
    }
    const q = await digInQuestion({
      party: ch.party,
      sentiment: s,
      conversation: text,
    });
    const sent = await reply(q);
    await update(ch.id, {
      sentiment: s,
      status: "digging",
      turns: 0,
      feedback: text,
      checkin_message_id: sent.messageId,
    });
    return { stage: `digging_${s}` };
  }

  // --- Mid dig-in: accumulate, then branch when we have enough. ---
  if (ch.status === "digging") {
    const feedback = `${ch.feedback ?? ""}\n${text}`.trim();
    const turns = ch.turns + 1;
    const sentiment = ch.sentiment ?? "good";

    if (turns < MAX_DIGIN_TURNS) {
      const q = await digInQuestion({
        party: ch.party,
        sentiment,
        conversation: feedback,
      });
      const sent = await reply(q);
      await update(ch.id, {
        feedback,
        turns,
        checkin_message_id: sent.messageId,
      });
      return { stage: "digging_more" };
    }

    // Enough detail — branch on sentiment. A freelancer can't be "rematched"
    // to a different client, so their bad-call feedback goes to the team.
    if (sentiment === "bad" && ch.party === "freelancer") {
      const ack = await feedbackAck({ party: ch.party, sentiment: "bad" });
      await reply(ack);
      await update(ch.id, { feedback, turns, status: "done" });
      await notifyOps({
        subject: "⚠️ Freelancer had a bad call on Howdy",
        text: `${ch.toEmail} said their call didn't go well:\n\n${feedback}\n\n— Howdy`,
      });
      return { stage: "done_bad" };
    }
    if (sentiment === "bad") {
      const offer = await rematchOffer(ch.party);
      const sent = await reply(offer);
      await update(ch.id, {
        feedback,
        turns,
        status: "offered_rematch",
        checkin_message_id: sent.messageId,
      });
      return { stage: "offered_rematch" };
    }
    // good
    if (ch.round >= MAX_CHECKIN_ROUND) {
      const ack = await feedbackAck({ party: ch.party, sentiment: "good" });
      await reply(ack);
      await update(ch.id, { feedback, turns, status: "done" });
      return { stage: "done_good_final" };
    }
    const q = await followupQuestion(ch.party);
    const sent = await reply(q);
    await update(ch.id, {
      feedback,
      turns,
      status: "awaiting_followup",
      checkin_message_id: sent.messageId,
    });
    return { stage: "awaiting_followup" };
  }

  // --- Bad path: did they want a rematch? ---
  if (ch.status === "offered_rematch") {
    const yn = await classifyYesNo(
      text,
      "do you want to be matched with someone else?",
    );
    if (yn === "yes") {
      const started = await runRematch(ch);
      await reply(
        started
          ? "On it — I'll line up someone who's a better fit and send you a fresh shortlist within 24 hours."
          : "I've already been through everyone in my network who fits this brief. If you can loosen one thing — budget, timeline, or style — reply with it and I'll search again.",
      );
      await update(ch.id, { status: "done" });
      return { stage: started ? "rematch_started" : "rematch_unavailable" };
    }
    const ack = await feedbackAck({ party: ch.party, sentiment: "bad" });
    await reply(ack);
    await update(ch.id, { status: "done" });
    return { stage: "done_bad" };
  }

  // --- Good path: is a follow-up call happening? ---
  if (ch.status === "awaiting_followup") {
    const yn = await classifyYesNo(
      text,
      "are you planning a follow-up call?",
    );
    if (yn === "yes" && ch.round < MAX_CHECKIN_ROUND) {
      await scheduleRound2(ch);
      await reply("Love it — I'll check in after that one too.");
      await update(ch.id, { status: "done" });
      return { stage: "round2_scheduled" };
    }
    const ack = await feedbackAck({ party: ch.party, sentiment: "good" });
    await reply(ack);
    await update(ch.id, { status: "done" });
    return { stage: "done_good" };
  }

  return { stage: "noop" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function scheduleRound2(ch: PostMatchCheckin): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseAdmin();
  const when = new Date(
    Date.now() + ROUND2_DELAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  await sb.from("post_match_checkins").upsert(
    [
      {
        request_id: ch.requestId,
        candidate_id: ch.candidateId,
        party: ch.party,
        round: 2,
        status: "scheduled",
        to_email: ch.toEmail,
        scheduled_at: when,
      },
    ],
    {
      onConflict: "request_id,candidate_id,party,round",
      ignoreDuplicates: true,
    },
  );
}

async function runRematch(ch: PostMatchCheckin): Promise<boolean> {
  const request = await getPendingById(ch.requestId);
  if (!request) return false;
  const candidates = await listCandidates(ch.requestId);
  const disliked = candidates.find((c) => c.id === ch.candidateId);
  const { started } = await startRematch({
    request,
    excludeFreelancerIds: disliked ? [disliked.freelancerId] : [],
    reason: ch.feedback ?? "previous match was not the right fit",
  });
  return started;
}

async function freelancerMap(
  ids: string[],
): Promise<Map<string, Freelancer>> {
  const list = await getFreelancersByIds([...new Set(ids)]);
  return new Map(list.map((f) => [f.id, f]));
}

/** The other party's display name, for the check-in copy. */
async function counterpartName(ch: PostMatchCheckin): Promise<string> {
  if (ch.party === "company") {
    // Counterpart is the freelancer.
    if (!ch.candidateId) return "them";
    const cands = await listCandidates(ch.requestId);
    const cand = cands.find((c) => c.id === ch.candidateId);
    if (!cand) return "them";
    const f = (await getFreelancersByIds([cand.freelancerId]))[0];
    return f?.name ?? "them";
  }
  // Counterpart is the client — use the email's name part.
  return ch.toEmail.split("@")[0];
}
