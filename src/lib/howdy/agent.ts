import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  briefCompleteness,
  briefIsActionable,
  extractBrief,
} from "./extractor";
import { getChatModel } from "./llm";
import { findBestMatch } from "./matcher";
import { memoriesAsContext } from "./memories";
import {
  type PendingMatch,
  schedulePendingMatch,
} from "./scheduler";
import { type Brief, EMPTY_BRIEF, type MatchResult } from "./types";

const HowdyState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, next) => curr.concat(next),
    default: () => [],
  }),
  brief: Annotation<Brief>({
    reducer: (_curr, next) => next,
    default: () => EMPTY_BRIEF,
  }),
  scheduled: Annotation<PendingMatch | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
  threadId: Annotation<string | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
  userEmail: Annotation<string | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
  subject: Annotation<string | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
  memories: Annotation<string[]>({
    reducer: (_curr, next) => next,
    default: () => [],
  }),
  /** Set when a match has already been delivered on this thread. */
  hasPreviousMatch: Annotation<boolean>({
    reducer: (_curr, next) => next,
    default: () => false,
  }),
});

type HowdyStateType = typeof HowdyState.State;

async function extractNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  const updated = await extractBrief(
    state.messages,
    state.brief,
    memoriesAsContext(state.memories),
  );
  return { brief: updated };
}

const CLARIFY_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent.

Your job in THIS turn is to ask ONE precise clarifying question that will most improve the match. Then stop. Future turns will ask more questions.

Rules:
- Look at the FULL conversation history (Howdy + Hirer). NEVER repeat a topic you've already asked about — they may have answered partially or you might already have the info.
- If a "Things you already know" memory section is provided, NEVER ask about facts contained there (e.g. don't ask their name, company, or role if you already know it).
- Pick the SINGLE highest-priority unanswered topic from this priority list:
  1. Concrete project description (what are they building / why does this work matter?)
  2. Deadline / timeline
  3. Budget (hourly or total — rough is fine)
  4. Style references or examples of work they admire (the "vibe")
  5. Specific tools / stack / skill requirements
  6. Must-haves (e.g. shipped X before, has Y experience)
  7. Timezone overlap if relevant
- Ground the question in what the user already said. If they said "Flutter developer", the next question should reference Flutter and probe deeper, not start from scratch.
- The question should feel like a sharp, friendly text from a smart human matchmaker (not a form). Vary phrasing — don't sound formulaic across turns.
- Keep it under two sentences. No greetings, no preamble. Just the question.`;

async function clarifyNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  const { missing, filled, total } = briefCompleteness(state.brief);
  const memoryBlock = memoriesAsContext(state.memories);
  const llm = getChatModel();
  const reply = await llm.invoke([
    new SystemMessage(CLARIFY_SYSTEM_PROMPT),
    new HumanMessage(
      `${memoryBlock ? memoryBlock + "\n\n" : ""}Conversation so far:
${state.messages
  .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
  .join("\n")}

Current brief (extracted):
${JSON.stringify(state.brief, null, 2)}

Brief is ${filled}/${total} fields filled. Still missing: ${missing.join(", ") || "none"}.

Pick the single highest-priority unanswered topic from your priority list and ask one focused question. Don't repeat anything you've already asked about, and don't ask anything that's already in the memory context.`,
    ),
  ]);
  const text =
    typeof reply.content === "string"
      ? reply.content
      : JSON.stringify(reply.content);
  return { messages: [new AIMessage(text.trim())] };
}

const ACK_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent. The hirer has just given you enough info to find a match.

Write ONE short reply that:
- Acknowledges what they're looking for in 1 sentence (reference one specific detail from their brief).
- Tells them you're working on it and will come back later today with someone.
- Sounds like a friendly text, not a form letter.
- Does NOT promise an exact time.
- Stays under 2 sentences. No greetings or signoffs.`;

async function scheduleNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  // Persist a pending match for the worker to pick up later.
  const threadId = state.threadId ?? `local-${Date.now()}`;
  const userEmail = state.userEmail ?? "local@howdy.test";
  const pending = await schedulePendingMatch({
    threadId,
    userEmail,
    subject: state.subject,
    brief: state.brief,
  });

  const llm = getChatModel();
  const reply = await llm.invoke([
    new SystemMessage(ACK_SYSTEM_PROMPT),
    new HumanMessage(
      `Brief:\n${JSON.stringify(state.brief, null, 2)}\n\nWrite the acknowledgment reply.`,
    ),
  ]);
  const text =
    typeof reply.content === "string"
      ? reply.content
      : JSON.stringify(reply.content);

  return {
    messages: [new AIMessage(text.trim())],
    scheduled: pending,
  };
}

function decideRoute(
  state: HowdyStateType,
): "schedule" | "clarify" | "followUp" {
  // Once a match has been delivered on this thread, every subsequent reply
  // is a follow-up — never re-trigger the matcher.
  if (state.hasPreviousMatch) return "followUp";
  return briefIsActionable(state.brief) ? "schedule" : "clarify";
}

const FOLLOW_UP_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent. The hirer is replying to a thread where you've ALREADY sent them a match.

Your job in this turn is to write ONE short, human reply that handles whatever they just said. Do NOT re-run the search or schedule a new match.

Possible cases:
- They confirm / want the intro → reply that you'll send the intro and that you'll loop the freelancer in shortly.
- They ask follow-up questions about the matched freelancer → answer based on what's in the conversation history; if you genuinely don't know, say so and offer to find out.
- They want a different match (e.g. "anyone else?", "this one isn't a fit") → tell them you'll look for an alternative and to give you a moment. Don't promise a specific time.
- They want to start a NEW project / hire someone different → say "got it, tell me about the new role and I'll start fresh".
- They thank you / say bye → reply briefly and warmly.

Rules:
- Stay under 2-3 short sentences.
- Sound like a human matchmaker, not a chatbot. Vary phrasing.
- Reference what they wrote — don't be generic.
- No greetings ("Hey X,") or signoffs unless it really fits.`;

async function followUpNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  const memoryBlock = memoriesAsContext(state.memories);
  const llm = getChatModel();
  const reply = await llm.invoke([
    new SystemMessage(FOLLOW_UP_SYSTEM_PROMPT),
    new HumanMessage(
      `${memoryBlock ? memoryBlock + "\n\n" : ""}Conversation so far:
${state.messages
  .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
  .join("\n")}

The hirer just sent the latest "Hirer:" message. Write your reply.`,
    ),
  ]);
  const text =
    typeof reply.content === "string"
      ? reply.content
      : JSON.stringify(reply.content);
  return { messages: [new AIMessage(text.trim())] };
}

const graph = new StateGraph(HowdyState)
  .addNode("extract", extractNode)
  .addNode("clarify", clarifyNode)
  .addNode("schedule", scheduleNode)
  .addNode("followUp", followUpNode)
  .addEdge(START, "extract")
  .addConditionalEdges("extract", decideRoute, {
    schedule: "schedule",
    clarify: "clarify",
    followUp: "followUp",
  })
  .addEdge("clarify", END)
  .addEdge("schedule", END)
  .addEdge("followUp", END);

export const howdyAgent = graph.compile();

export type AgentInput = {
  messages: BaseMessage[];
  brief?: Brief;
  threadId?: string;
  userEmail?: string;
  subject?: string;
  memories?: string[];
  /** True if this thread has already received a match. Switches the agent
   * into follow-up mode so it doesn't keep re-scheduling. */
  hasPreviousMatch?: boolean;
};

export type AgentOutput = {
  reply: string;
  brief: Brief;
  scheduled: PendingMatch | null;
};

export async function runHowdyTurn(input: AgentInput): Promise<AgentOutput> {
  const result = await howdyAgent.invoke({
    messages: input.messages,
    brief: input.brief ?? EMPTY_BRIEF,
    scheduled: null,
    threadId: input.threadId ?? null,
    userEmail: input.userEmail ?? null,
    subject: input.subject ?? null,
    memories: input.memories ?? [],
    hasPreviousMatch: input.hasPreviousMatch ?? false,
  });
  const lastMessage = result.messages[result.messages.length - 1];
  const reply =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
  return {
    reply,
    brief: result.brief,
    scheduled: result.scheduled,
  };
}

/**
 * Compose a "match arrived" reply from a scheduled brief + selected freelancer.
 * Used by the worker that drains pending_matches at the scheduled time.
 */
const PROPOSE_SYSTEM_PROMPT = `You are Howdy, sending the match reply you promised earlier.

Rules:
- Lead with "Got your match." then the freelancer's name in bold (use markdown).
- One short sentence covering: ex-company, years, key skill, hourly rate, availability.
- One short sentence with the rationale (why this person fits the brief specifically).
- One short closer with next step (e.g. "Reply with 'yes' and I'll send the intro.").
- Do NOT include greetings or signoffs. Email shell handles that.
- If confidence is low, soften the language ("the closest fit I have right now").`;

export async function composeMatchReply(args: {
  brief: Brief;
  match: MatchResult;
}): Promise<string> {
  const { freelancer: f, rationale, confidence } = args.match;
  const llm = getChatModel();
  const reply = await llm.invoke([
    new SystemMessage(PROPOSE_SYSTEM_PROMPT),
    new HumanMessage(`Brief:
${JSON.stringify(args.brief, null, 2)}

Freelancer:
- Name: ${f.name}
- Role: ${f.role}
- Bio: ${f.bio}
- Portfolio: ${f.portfolio_summary}
- Rate: $${f.rate_usd_per_hour}/hr
- Timezone: ${f.timezone}
- Skills: ${f.skills.join(", ")}

Rationale: ${rationale}
Confidence: ${confidence}

Write the reply.`),
  ]);
  return typeof reply.content === "string"
    ? reply.content.trim()
    : JSON.stringify(reply.content);
}

/**
 * Run the actual match step for a queued brief. Returns the proposal reply text
 * + the matched freelancer (or null if no candidate cleared the filters).
 */
export async function runScheduledMatch(brief: Brief): Promise<{
  match: MatchResult | null;
  reply: string;
}> {
  const match = await findBestMatch(brief);
  if (!match) {
    return {
      match: null,
      reply:
        "I scanned my network for that brief but couldn't find a strong fit. Want me to widen the criteria?",
    };
  }
  const reply = await composeMatchReply({ brief, match });
  return { match, reply };
}

export { HumanMessage } from "@langchain/core/messages";
