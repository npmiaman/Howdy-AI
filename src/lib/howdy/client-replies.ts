/**
 * Client replies once a request exists on their conversation. Routed by where
 * the request actually is — so Howdy never talks as if a match was sent before
 * it was, and every "on it" is backed by a real action:
 *
 *   matching / outreach     → status update (+ fold any new details into the brief)
 *   shortlist sent / after  → pick → connect · more options → rematch ·
 *                             question → answered from the profiles shown ·
 *                             new project → start a fresh email · other → short reply
 *
 * One LLM call classifies the reply and, for questions and small talk, writes
 * the answer too — every round trip here is 17–55s against a 60s function.
 */
import {
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { z } from "zod";

import { listCandidates } from "./candidates";
import { getFreelancerMap, rateLabel } from "./data";
import { extractBrief } from "./extractor";
import { howdyAddresses } from "./inbound-guard";
import { getChatModel } from "./llm";
import { memoriesAsContext } from "./memories";
import { handleClientSelection, startRematch, tellClient } from "./outreach";
import { rematchStartedNotice } from "./outreach-content";
import { type PendingMatch, updateRequestBrief } from "./scheduler";
import { saveBrief, type ThreadRow } from "./threads";
import { HOWDY_VOICE, polish } from "./voice";
import { type Brief, type Freelancer, PROMISE_HOURS } from "./types";

export type ClientReplyAction =
  | "status_update"
  | "client_selected"
  | "client_more_options"
  | "client_question"
  | "client_new_project"
  | "client_other";

const ClientReplySchema = z.object({
  intent: z.enum(["pick", "more_options", "question", "new_project", "other"]),
  chosen_freelancer_ids: z
    .array(z.string())
    .describe(
      "pick: the IDs they want to be connected with. question: the IDs it's about. Otherwise empty.",
    ),
  reason: z
    .string()
    .nullable()
    .describe("more_options: what they want different, in their words. Otherwise null."),
  reply: z
    .string()
    .nullable()
    .describe(
      "question or other: your reply to the client, 1-3 short sentences, no greeting or signature. Otherwise null.",
    ),
});

const CLIENT_REPLY_SYSTEM = `You are Howdy, an AI talent scout. You read a client's email reply after you sent them a shortlist of freelancers (or already introduced them to one), classify what they want, and for some intents write the reply.

Intents:
- "pick": they want to be connected with one or more shortlisted freelancers (by name, "the first one", "#2", "both", "all three"). Put those IDs in chosen_freelancer_ids.
- "more_options": they want different or additional people ("anyone else?", "none of these", "not quite right"). Put what they want different, in their words, in reason.
- "question": they're asking about one or more of the freelancers (rate, portfolio, availability, experience). Put the IDs it's about in chosen_freelancer_ids, and answer in reply using ONLY the profiles given — if the answer isn't there, say plainly you don't have that detail and suggest they ask the freelancer directly once connected. Never promise to find out.
- "new_project": they want to hire for a separate, different role or project.
- "other": thanks, small talk, or anything else. Write a short, warm reply that promises nothing beyond the situation note.

If they name someone to meet AND ask a question in the same reply, the intent is "pick" — acting on the choice matters more than the question.
Only use IDs from the shortlist. Return JSON matching the schema.

For the reply field: ${HOWDY_VOICE}`;

const SITUATION: Record<string, string> = {
  shortlist_sent:
    "They have your shortlist. If it fits, remind them to reply with the name(s) they'd like to meet.",
  client_selected:
    "They picked someone; you're waiting for that freelancer to confirm and will intro them as soon as they do.",
  connecting: "Their intro email is going out shortly.",
  connected:
    "They've been introduced. They can reply here any time if something comes up or they'd like someone else.",
};

function profile(f: Freelancer): string {
  return [
    `ID: ${f.id} — ${f.name} (${f.role})`,
    `Rate: ${rateLabel(f.rate_usd_per_hour)} · Timezone: ${f.timezone} · Availability: ${f.availability_hours_per_week} hrs/week`,
    `Skills: ${f.skills.join(", ")}`,
    `Bio: ${f.bio}`,
    `Portfolio: ${f.portfolio_summary}`,
  ].join("\n");
}

export async function handleClientReply(args: {
  request: PendingMatch;
  thread: ThreadRow;
  history: BaseMessage[];
  memories: string[];
  text: string;
  inboundMessageId: string;
}): Promise<{ action: ClientReplyAction }> {
  const { request, text, inboundMessageId } = args;
  const reply = (kind: string, body: string) => tellClient(request, kind, body, inboundMessageId);

  // Still recruiting: never talk as if a match was sent. Keep the brief current
  // so refills and the 24h fallback rank on what they just added.
  if (request.phase === "matching" || request.phase === "outreach") {
    await refreshBrief(args, request.id);
    const elapsed = (Date.now() - request.createdAt.getTime()) / 3_600_000;
    const hours = Math.max(1, Math.ceil(PROMISE_HOURS - elapsed));
    await reply(
      "client_status_update",
      `Got it, I've added that to your brief. I'm still lining people up, and your shortlist will reach you within ${hours} hour${hours === 1 ? "" : "s"}.`,
    );
    return { action: "status_update" };
  }

  const shown = (await listCandidates(request.id))
    .filter((c) => c.shownToClientAt)
    .sort((a, b) => a.rank - b.rank);
  const freelancers = await getFreelancerMap(shown.map((c) => c.freelancerId));
  const profiles = shown.flatMap((c) => {
    const f = freelancers.get(c.freelancerId);
    return f ? [profile(f)] : [];
  });

  const intent = await classifyClientReply({ text, profiles, phase: request.phase });
  const shownIds = new Set(shown.map((c) => c.freelancerId));
  const ids = intent.chosen_freelancer_ids.filter((id) => shownIds.has(id));

  if (intent.intent === "pick" && ids.length > 0) {
    const { confirmed, pending } = await handleClientSelection({
      request,
      chosenFreelancerIds: ids,
      replyToMessageId: inboundMessageId,
    });
    if (confirmed + pending > 0) return { action: "client_selected" };
  }

  if (intent.intent === "more_options") {
    const brief = await refreshBrief(args);
    await startRematch({ request, reason: intent.reason ?? text, brief });
    await reply("client_more_options", rematchStartedNotice());
    return { action: "client_more_options" };
  }

  if (intent.intent === "new_project") {
    await reply(
      "client_new_project",
      `Love it. Start a new email to ${howdyAddresses()[0]} with a subject line for the new role and I'll scout that one separately. This thread stays focused on your ${request.brief.role ?? "current"} search.`,
    );
    return { action: "client_new_project" };
  }

  const isQuestion = intent.intent === "question";
  const answer = intent.reply?.trim() ? await polish(intent.reply.trim()) : "";
  await reply(
    isQuestion ? "client_question" : "client_other",
    answer ||
      (isQuestion
        ? "I don't have that detail on hand. Best to ask them directly once you're connected."
        : "Thanks! Reply here any time."),
  );
  return { action: isQuestion ? "client_question" : "client_other" };
}

export async function classifyClientReply(args: {
  text: string;
  profiles: string[];
  phase: string;
}): Promise<z.infer<typeof ClientReplySchema>> {
  const llm = getChatModel().withStructuredOutput(ClientReplySchema, {
    name: "client_reply",
  });
  return llm.invoke([
    new SystemMessage(CLIENT_REPLY_SYSTEM),
    new HumanMessage(
      `Situation: ${SITUATION[args.phase] ?? SITUATION.connected}\n\nShortlist (full profiles):\n${args.profiles.join("\n\n") || "(none)"}\n\nClient reply:\n${args.text}\n\nClassify it.`,
    ),
  ]);
}

/**
 * Re-extract the brief from the whole conversation and persist it (on the
 * thread, and on the request when given).
 */
async function refreshBrief(
  args: { thread: ThreadRow; history: BaseMessage[]; memories: string[] },
  requestId?: string,
): Promise<Brief> {
  const brief = await extractBrief(
    args.history,
    args.thread.brief,
    memoriesAsContext(args.memories),
  );
  await Promise.all([
    saveBrief(args.thread.id, brief),
    requestId ? updateRequestBrief(requestId, brief) : null,
  ]);
  return brief;
}
