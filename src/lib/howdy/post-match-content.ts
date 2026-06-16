/**
 * Email copy + reply classifiers for the post-match experience. Pure content
 * and judgments — no sending, no persistence.
 */
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getChatModel } from "./llm";
import type { CheckinParty, CheckinSentiment } from "./types";

async function write(system: string, user: string): Promise<string> {
  const reply = await getChatModel().invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);
  return (
    typeof reply.content === "string"
      ? reply.content
      : JSON.stringify(reply.content)
  ).trim();
}

const PARTY_LABEL: Record<CheckinParty, string> = {
  company: "the client who hired",
  freelancer: "the freelancer",
};

// --------------------------------------------------------------- check-in email
const CHECKIN_SYSTEM = `You are Howdy, checking in after you connected a client and a freelancer. Write ONE short, warm email (2 sentences) asking how their call went. Friendly human tone, not a survey. No greeting block or signature beyond a casual close. Ask openly so they can say it went well OR badly.`;

export async function checkinEmail(args: {
  party: CheckinParty;
  counterpartName: string;
  round: number;
}): Promise<string> {
  const which =
    args.round >= 2 ? "follow-up call" : "first call";
  return write(
    CHECKIN_SYSTEM,
    `You're checking in with ${PARTY_LABEL[args.party]}. Their ${which} was with ${args.counterpartName}. Ask how that ${which} went.`,
  );
}

// --------------------------------------------------------------- dig-in question
const DIGIN_SYSTEM = `You are Howdy, digging into feedback after a call between a client and a freelancer. Ask ONE sharp, specific follow-up question that gets concrete detail. Under two sentences, warm, no preamble.
- If sentiment is "bad": probe WHY — what specifically didn't work (communication, skill, fit, pace, expectations)? Reference what they already said; don't repeat a question.
- If sentiment is "good": probe WHAT made it great — specific strengths, what they liked, whether the work/portfolio matched. Reference what they already said.`;

export async function digInQuestion(args: {
  party: CheckinParty;
  sentiment: CheckinSentiment;
  conversation: string;
}): Promise<string> {
  return write(
    DIGIN_SYSTEM,
    `Sentiment: ${args.sentiment}. You're talking to ${PARTY_LABEL[args.party]}.\n\nConversation so far:\n${args.conversation}\n\nAsk the next sharp dig-in question.`,
  );
}

// --------------------------------------------------------------- branch prompts
const REMATCH_OFFER_SYSTEM = `You are Howdy. The person wasn't happy with the match. In ONE short, supportive sentence, ask whether they'd like you to find them someone else. Make it easy to say yes or no. No preamble.`;

export async function rematchOffer(party: CheckinParty): Promise<string> {
  return write(
    REMATCH_OFFER_SYSTEM,
    `You're asking ${PARTY_LABEL[party]} if they want a different match. Write the one-line offer.`,
  );
}

const FOLLOWUP_SYSTEM = `You are Howdy. The person was happy with the call. In ONE short, friendly sentence, ask whether they're planning a follow-up call with them. No preamble.`;

export async function followupQuestion(party: CheckinParty): Promise<string> {
  return write(
    FOLLOWUP_SYSTEM,
    `You're asking ${PARTY_LABEL[party]} if a follow-up call is planned. Write the one-liner.`,
  );
}

const ACK_SYSTEM = `You are Howdy, writing ONE short warm line acknowledging the feedback someone just gave and closing the loop kindly. No preamble, no signature.`;

export async function feedbackAck(args: {
  party: CheckinParty;
  sentiment: CheckinSentiment;
}): Promise<string> {
  return write(
    ACK_SYSTEM,
    `Sentiment was ${args.sentiment}. Write a short thank-you-for-the-feedback close.`,
  );
}

// --------------------------------------------------------------- classifiers
const SentimentSchema = z.object({
  sentiment: z
    .enum(["good", "bad", "unclear"])
    .describe("Overall: did the call go well (good), poorly (bad), or is it ambiguous (unclear)?"),
});

export async function classifyCallSentiment(
  text: string,
): Promise<"good" | "bad" | "unclear"> {
  const llm = getChatModel().withStructuredOutput(SentimentSchema, {
    name: "sentiment",
  });
  const res = await llm.invoke([
    new SystemMessage(
      `Classify how someone felt about a call they had. "good" = positive/satisfied, "bad" = negative/disappointed, "unclear" = can't tell. Judge overall sentiment, not politeness.`,
    ),
    new HumanMessage(`Their message:\n${text}\n\nClassify the sentiment.`),
  ]);
  return res.sentiment;
}

const YesNoSchema = z.object({
  answer: z.enum(["yes", "no", "unclear"]),
});

export async function classifyYesNo(
  text: string,
  question: string,
): Promise<"yes" | "no" | "unclear"> {
  const llm = getChatModel().withStructuredOutput(YesNoSchema, {
    name: "yesno",
  });
  const res = await llm.invoke([
    new SystemMessage(
      `You determine whether a reply means yes, no, or is unclear, given the question it answers. Judge intent.`,
    ),
    new HumanMessage(
      `Question asked: ${question}\nTheir reply: ${text}\n\nIs it yes, no, or unclear?`,
    ),
  ]);
  return res.answer;
}
