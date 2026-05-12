import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  briefCompleteness,
  briefIsActionable,
  extractBrief,
} from "@/lib/howdy/extractor";
import { getChatModel } from "@/lib/howdy/llm";
import { EMPTY_BRIEF } from "@/lib/howdy/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

const CLARIFY_DEMO_PROMPT = `You are Howdy, an AI freelancer-matching agent, talking to a visitor who is trying you out on the website.

Your job in this turn is to ask ONE precise clarifying question that will most improve the eventual match. Then stop.

Rules:
- Look at the FULL conversation history. NEVER repeat a topic you've already asked about.
- Pick the SINGLE highest-priority unanswered topic from this priority list:
  1. Concrete project description (what are they building / why does this work matter?)
  2. Deadline / timeline
  3. Budget (hourly or total — rough is fine)
  4. Style references or examples of work they admire (the "vibe")
  5. Specific tools / stack / skill requirements
  6. Must-haves (e.g. shipped X before, has Y experience)
  7. Timezone overlap if relevant
- Ground the question in what the user already said. If they said "Flutter developer", probe deeper into Flutter, don't start from scratch.
- Sound like a sharp, friendly text from a smart human matchmaker (not a form). Vary phrasing.
- Keep it under two short sentences. No greetings, no preamble.`;

const DEMO_ACK_PROMPT = `You are Howdy, an AI freelancer-matching agent, talking to a visitor who is trying you out on the website. They've now given you enough info to find a match.

In the live product, you'd schedule a real match for later today. For this demo, write ONE short reply (2-3 short sentences) that:
- Acknowledges what they're looking for in 1 sentence (reference one specific detail from their brief).
- Tells them this is the moment in the real product where you'd quietly go find a vetted match and email it back later today.
- Invites them to email howdyai@agentmail.to to use the real thing.
- Sounds like a friendly text, not a form letter.
- No greetings or signoffs.`;

export async function POST(request: Request) {
  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Howdy is offline (missing GOOGLE_API_KEY)." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request shape." },
      { status: 400 },
    );
  }

  const lcMessages: BaseMessage[] = parsed.data.messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  try {
    const brief = await extractBrief(lcMessages, EMPTY_BRIEF, "");
    const llm = getChatModel();

    if (briefIsActionable(brief)) {
      const reply = await llm.invoke([
        new SystemMessage(DEMO_ACK_PROMPT),
        new HumanMessage(
          `Brief:\n${JSON.stringify(brief, null, 2)}\n\nWrite the demo ack.`,
        ),
      ]);
      const text =
        typeof reply.content === "string"
          ? reply.content.trim()
          : JSON.stringify(reply.content);
      return NextResponse.json({ reply: text, done: true });
    }

    const { missing, filled, total } = briefCompleteness(brief);
    const reply = await llm.invoke([
      new SystemMessage(CLARIFY_DEMO_PROMPT),
      new HumanMessage(
        `Conversation so far:
${lcMessages
  .map(
    (m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`,
  )
  .join("\n")}

Current brief (extracted):
${JSON.stringify(brief, null, 2)}

Brief is ${filled}/${total} fields filled. Still missing: ${missing.join(", ") || "none"}.

Pick the single highest-priority unanswered topic and ask one focused question.`,
      ),
    ]);
    const text =
      typeof reply.content === "string"
        ? reply.content.trim()
        : JSON.stringify(reply.content);
    return NextResponse.json({ reply: text, done: false });
  } catch (err) {
    console.error("[howdy/chat] error", err);
    return NextResponse.json(
      { error: "Howdy hit a snag. Try again in a sec." },
      { status: 500 },
    );
  }
}
