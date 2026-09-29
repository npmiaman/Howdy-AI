import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { assessBrief } from "./assessor";
import { rateLabel } from "./data";
import { extractBrief } from "./extractor";
import { generateText } from "./generate";
import { findBestMatch } from "./matcher";
import { memoriesAsContext } from "./memories";
import {
  type PendingMatch,
  schedulePendingMatch,
} from "./scheduler";
import { polish } from "./voice";
import {
  type Brief,
  type BriefAssessment,
  EMPTY_BRIEF,
  type MatchResult,
} from "./types";

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
  /** Per-field clarity audit produced after each extraction. */
  assessment: Annotation<BriefAssessment | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
});

type HowdyStateType = typeof HowdyState.State;

/** Count of Howdy's own replies so far — a proxy for how many clarifying
 *  turns have happened, used to backstop the question loop. */
function clarifyTurnCount(state: HowdyStateType): number {
  return state.messages.filter((m) => m.getType() !== "human").length;
}

async function extractNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  const memoryContext = memoriesAsContext(state.memories);
  const updated = await extractBrief(state.messages, state.brief, memoryContext);
  // Audit clarity of every field, then decide if we can match or must ask more.
  const assessment = await assessBrief(
    state.messages,
    updated,
    memoryContext,
    clarifyTurnCount(state),
  );
  return { brief: updated, assessment };
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
  4. Experience level / seniority they want (junior, mid, senior, or lead)
  5. Domain or industry the work sits in (e.g. fintech, fashion, gaming)
  6. Style references or examples of work they admire (the "vibe")
  7. Red flags — work, styles, or traits they want to avoid (dealbreakers)
  8. Collaboration style — how they want the freelancer to operate (proactive and self-directed, communicative, takes close direction)
  9. Specific tools / stack / skill requirements
  10. Must-haves (e.g. shipped X before, has Y experience)
  11. Timezone overlap if relevant
- Ground the question in what the user already said. If they said "Flutter developer", the next question should reference Flutter and probe deeper, not start from scratch.
- The question should feel like a sharp, friendly text from a smart human matchmaker (not a form). Vary phrasing — don't sound formulaic across turns.
- Keep it under two sentences. No greetings, no preamble. Just the question.`;

async function clarifyNode(
  state: HowdyStateType,
): Promise<Partial<HowdyStateType>> {
  // The assessor already chose the highest-priority unresolved field and wrote
  // a sharp, context-grounded question for it (re-asking sharper when the prior
  // answer was vague). Emit that directly.
  const question = state.assessment?.nextQuestion?.trim();
  if (question) {
    return { messages: [new AIMessage(await polish(question))] };
  }

  // Fallback: assessment produced no question (shouldn't happen on the clarify
  // route). Ask a focused question from the raw priority prompt.
  const memoryBlock = memoriesAsContext(state.memories);
  const text = await generateText(
    CLARIFY_SYSTEM_PROMPT,
    `${memoryBlock ? memoryBlock + "\n\n" : ""}Conversation so far:
${state.messages
  .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
  .join("\n")}

Current brief (extracted):
${JSON.stringify(state.brief, null, 2)}

Ask the single highest-priority unanswered question. Don't repeat anything you've already asked, and don't ask anything that's in the memory context.`,
  );
  return { messages: [new AIMessage(text)] };
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

  const text = await generateText(
    ACK_SYSTEM_PROMPT,
    `Brief:\n${JSON.stringify(state.brief, null, 2)}\n\nWrite the acknowledgment reply.`,
  );

  return {
    messages: [new AIMessage(text)],
    scheduled: pending,
  };
}

// Replies after a request exists are routed by client-replies.ts, not here.
function decideRoute(state: HowdyStateType): "schedule" | "clarify" {
  // Match once the required core of the brief is clear (see REQUIRED_FIELDS);
  // otherwise keep clarifying.
  return state.assessment?.allResolved ? "schedule" : "clarify";
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
- Lead with the freelancer's name and why they fit, in plain text.
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
  return generateText(
    PROPOSE_SYSTEM_PROMPT,
    `Brief:
${JSON.stringify(args.brief, null, 2)}

Freelancer:
- Name: ${f.name}
- Role: ${f.role}
- Bio: ${f.bio}
- Portfolio: ${f.portfolio_summary}
- Rate: ${rateLabel(f.rate_usd_per_hour)}
- Timezone: ${f.timezone}
- Skills: ${f.skills.join(", ")}

Rationale: ${rationale}
Confidence: ${confidence}

Write the reply.`,
  );
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
