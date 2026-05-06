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

function decideRoute(state: HowdyStateType): "schedule" | "clarify" {
  return briefIsActionable(state.brief) ? "schedule" : "clarify";
}

const graph = new StateGraph(HowdyState)
  .addNode("extract", extractNode)
  .addNode("clarify", clarifyNode)
  .addNode("schedule", scheduleNode)
  .addEdge(START, "extract")
  .addConditionalEdges("extract", decideRoute, {
    schedule: "schedule",
    clarify: "clarify",
  })
  .addEdge("clarify", END)
  .addEdge("schedule", END);

export const howdyAgent = graph.compile();

export type AgentInput = {
  messages: BaseMessage[];
  brief?: Brief;
  threadId?: string;
  userEmail?: string;
  subject?: string;
  memories?: string[];
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
