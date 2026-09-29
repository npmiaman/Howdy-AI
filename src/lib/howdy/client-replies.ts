/**
 * Client replies once a request exists on their conversation. Routed by where
 * the request actually is — so Howdy never talks as if a match was sent before
 * it was, and every "on it" is backed by a real action:
 *
 *   matching / outreach     → status update (+ fold any new details into the brief)
 *   shortlist sent / after  → pick → connect · more options → rematch ·
 *                             question → answered from the profiles shown ·
 *                             new project → start a fresh email · other → short reply
 */
import {
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { z } from "zod";

import { listCandidates } from "./candidates";
import { getFreelancersByIds } from "./data";
import { extractBrief } from "./extractor";
import { getChatModel } from "./llm";
import { memoriesAsContext } from "./memories";
import { handleClientSelection, startRematch, tellClient } from "./outreach";
import { noMatchNotice } from "./outreach-content";
import { type PendingMatch, updateRequestBrief } from "./scheduler";
import { saveBrief, type ThreadRow } from "./threads";
import type { Brief, Freelancer, MatchCandidate } from "./types";

const PROMISE_HOURS = 24;

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
});

const CLIENT_REPLY_SYSTEM = `You read a client's email reply after Howdy sent them a shortlist of freelancers (or already introduced them to one). Classify what they want:
- "pick": they want to be connected with one or more shortlisted freelancers (by name, "the first one", "#2", "both", "all three"). Put those IDs in chosen_freelancer_ids.
- "more_options": they want different or additional people ("anyone else?", "none of these", "not quite right"). Put what they want different, in their words, in reason.
- "question": they're asking about one or more of the freelancers (rate, portfolio, availability, experience). Put the IDs it's about in chosen_freelancer_ids (empty if unclear).
- "new_project": they want to hire for a separate, different role or project.
- "other": thanks, small talk, or anything else.
Only use IDs from the shortlist. Return JSON matching the schema.`;

const STATUS_SYSTEM = `You are Howdy, an AI talent scout. The client just replied while you're still recruiting freelancers for their brief — no shortlist has been sent yet. Write ONE or two short sentences that acknowledge anything new they said (it's been added to their brief) and tell them their shortlist will reach them within the number of hours given. Never name a freelancer or claim anyone has confirmed. No greeting or signature.`;

const QUESTION_SYSTEM = `You are Howdy, answering a client's question about freelancers you put in front of them. Use ONLY the profiles provided. If the answer isn't in them, say plainly you don't have that detail and suggest they ask the freelancer directly once connected — never promise to find out. Two or three short sentences. No greeting or signature.`;

const OTHER_SYSTEM = `You are Howdy, an AI talent scout. Write ONE short, warm reply to the client's latest message. Do not promise any action beyond what the situation note says. No greeting or signature.`;

const SITUATION: Record<string, string> = {
  shortlist_sent:
    "They have your shortlist. If it fits, remind them to reply with the name(s) they'd like to meet.",
  client_selected:
    "They picked someone; you're waiting for that freelancer to confirm and will intro them as soon as they do.",
  connecting: "Their intro email is going out shortly.",
  connected:
    "They've been introduced. They can reply here any time if something comes up or they'd like someone else.",
};

function inboxAddress(): string {
  const id = process.env.AGENTMAIL_INBOX_ID ?? "";
  return id.includes("@") ? id : "howdyai@agentmail.to";
}

async function write(system: string, human: string): Promise<string> {
  const reply = await getChatModel().invoke([
    new SystemMessage(system),
    new HumanMessage(human),
  ]);
  return (
    typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)
  ).trim();
}

function profile(f: Freelancer): string {
  return [
    `ID: ${f.id} — ${f.name} (${f.role})`,
    `Rate: $${f.rate_usd_per_hour}/hr · Timezone: ${f.timezone} · Availability: ${f.availability_hours_per_week} hrs/week`,
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
  const reply = (kind: string, body: string) =>
    tellClient(request, kind, body, inboundMessageId);

  // Still recruiting: never talk as if a match was sent. Keep the brief current
  // so refills and the 24h fallback rank on what they just added.
  if (request.phase === "matching" || request.phase === "outreach") {
    const brief = await refreshBrief(args);
    await updateRequestBrief(request.id, brief);
    const elapsed = (Date.now() - request.createdAt.getTime()) / 3_600_000;
    const hours = Math.max(1, Math.ceil(PROMISE_HOURS - elapsed));
    const body = await write(
      STATUS_SYSTEM,
      `Brief:\n${JSON.stringify(brief, null, 2)}\n\nHours until the shortlist: ${hours}\n\nClient's message:\n${text}`,
    );
    await reply("client_status_update", body);
    return { action: "status_update" };
  }

  const candidates = await listCandidates(request.id);
  const shown = candidates
    .filter((c) => c.shownToClientAt)
    .sort((a, b) => a.rank - b.rank);
  const freelancers = new Map(
    (await getFreelancersByIds(shown.map((c) => c.freelancerId))).map((f) => [f.id, f]),
  );

  const intent = await classify(text, shown, freelancers);
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
    const { started } = await startRematch({
      request,
      excludeFreelancerIds: [...shownIds],
      reason: intent.reason ?? text,
      brief,
    });
    await reply(
      "client_more_options",
      started
        ? `On it — I'll line up fresh people (nobody from this shortlist) and send them over within ${PROMISE_HOURS} hours.`
        : noMatchNotice(brief.role),
    );
    return { action: "client_more_options" };
  }

  if (intent.intent === "question") {
    const about = ids.length ? ids : [...shownIds];
    const profiles = about
      .map((id) => freelancers.get(id))
      .filter((f): f is Freelancer => !!f)
      .map(profile)
      .join("\n\n");
    const body = await write(
      QUESTION_SYSTEM,
      `Profiles:\n${profiles || "(none)"}\n\nClient's question:\n${text}`,
    );
    await reply("client_question", body);
    return { action: "client_question" };
  }

  if (intent.intent === "new_project") {
    await reply(
      "client_new_project",
      `Love it. Start a new email to ${inboxAddress()} with a subject line for the new role and I'll scout that one separately — this thread stays focused on your ${request.brief.role ?? "current"} search.`,
    );
    return { action: "client_new_project" };
  }

  const body = await write(
    OTHER_SYSTEM,
    `Situation: ${SITUATION[request.phase] ?? SITUATION.connected}\n\nClient's message:\n${text}`,
  );
  await reply("client_other", body);
  return { action: "client_other" };
}

async function classify(
  text: string,
  shown: MatchCandidate[],
  freelancers: Map<string, Freelancer>,
): Promise<z.infer<typeof ClientReplySchema>> {
  const roster = shown
    .map((c) => freelancers.get(c.freelancerId))
    .filter((f): f is Freelancer => !!f)
    .map((f) => `ID: ${f.id} — ${f.name} (${f.role})`)
    .join("\n");
  const llm = getChatModel().withStructuredOutput(ClientReplySchema, {
    name: "client_reply",
  });
  return llm.invoke([
    new SystemMessage(CLIENT_REPLY_SYSTEM),
    new HumanMessage(`Shortlist:\n${roster || "(none)"}\n\nClient reply:\n${text}\n\nClassify it.`),
  ]);
}

/** Re-extract the brief from the whole conversation and persist it. */
async function refreshBrief(args: {
  thread: ThreadRow;
  history: BaseMessage[];
  memories: string[];
}): Promise<Brief> {
  const brief = await extractBrief(
    args.history,
    args.thread.brief,
    memoriesAsContext(args.memories),
  );
  await saveBrief(args.thread.id, brief);
  return brief;
}
