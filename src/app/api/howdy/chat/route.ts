import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { NextResponse } from "next/server";
import { z } from "zod";

import { assessBrief } from "@/lib/howdy/assessor";
import { extractBrief } from "@/lib/howdy/extractor";
import { getChatModel } from "@/lib/howdy/llm";
import {
  appendMessage,
  findOrCreateThread,
  saveBrief,
} from "@/lib/howdy/threads";
import { EMPTY_BRIEF, type Brief } from "@/lib/howdy/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";

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
  // Stable per-visitor id from the widget, so every turn lands on one thread.
  sessionId: z.string().min(1).max(100).optional(),
});

// Small deterministic hash → stable fallback session key when none is sent.
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Persist a website-chat turn so it shows up alongside email conversations.
 * Keyed by the widget's sessionId; appends only the newest visitor message and
 * this turn's reply (earlier turns were saved on their own requests).
 */
async function cacheChatTurn(args: {
  sessionId: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  reply: string;
  brief: Brief;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  // Always cache: if the widget didn't send a session id, derive a stable one
  // from the conversation's opening message so retries still map to one thread.
  const firstUser =
    args.messages.find((m) => m.role === "user")?.content ?? "anon";
  const sessionKey =
    args.sessionId ?? `auto-${simpleHash(firstUser)}`;
  try {
    const lastUser = [...args.messages]
      .reverse()
      .find((m) => m.role === "user");
    const thread = await findOrCreateThread({
      gmailThreadId: `web:${sessionKey}`,
      userEmail: `web-${sessionKey.slice(0, 12)}@howdy.chat`,
      subject:
        args.messages.find((m) => m.role === "user")?.content.slice(0, 80) ??
        "Website chat",
    });
    if (lastUser) {
      await appendMessage({
        threadId: thread.id,
        role: "human",
        content: lastUser.content,
      });
    }
    await appendMessage({ threadId: thread.id, role: "ai", content: args.reply });
    await saveBrief(thread.id, args.brief);
  } catch (e) {
    // Caching must never break the chat experience.
    console.warn("[howdy/chat] cache failed:", e);
  }
}

const CLARIFY_DEMO_PROMPT = `You are Howdy, an AI freelancer-matching agent, talking to a visitor who is trying you out on the website.

Your job in this turn is to ask ONE precise clarifying question that will most improve the eventual match. Then stop.

Rules:
- Look at the FULL conversation history. NEVER repeat a topic you've already asked about.
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
    const clarifyTurns = lcMessages.filter(
      (m) => m.getType() !== "human",
    ).length;
    const assessment = await assessBrief(lcMessages, brief, "", clarifyTurns);
    const llm = getChatModel();

    let text: string;
    let done: boolean;

    // Match only once every field is clear (or not-applicable).
    if (assessment.allResolved) {
      const reply = await llm.invoke([
        new SystemMessage(DEMO_ACK_PROMPT),
        new HumanMessage(
          `Brief:\n${JSON.stringify(brief, null, 2)}\n\nWrite the demo ack.`,
        ),
      ]);
      text =
        typeof reply.content === "string"
          ? reply.content.trim()
          : JSON.stringify(reply.content);
      done = true;
    } else if (assessment.nextQuestion?.trim()) {
      // The assessor already wrote the sharp, context-grounded next question
      // (re-asking sharper when the prior answer was vague).
      text = assessment.nextQuestion.trim();
      done = false;
    } else {
      // Fallback: ask from the raw priority prompt if the assessor returned none.
      const reply = await llm.invoke([
        new SystemMessage(CLARIFY_DEMO_PROMPT),
        new HumanMessage(
          `Conversation so far:
${lcMessages
  .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
  .join("\n")}

Current brief (extracted):
${JSON.stringify(brief, null, 2)}

Ask the single highest-priority unanswered question.`,
        ),
      ]);
      text =
        typeof reply.content === "string"
          ? reply.content.trim()
          : JSON.stringify(reply.content);
      done = false;
    }

    // Cache this turn (visitor message + reply) so it shows up in the
    // conversations view alongside email threads.
    await cacheChatTurn({
      sessionId: parsed.data.sessionId,
      messages: parsed.data.messages,
      reply: text,
      brief,
    });

    return NextResponse.json({ reply: text, done });
  } catch (err) {
    console.error("[howdy/chat] error", err);
    return NextResponse.json(
      { error: "Howdy hit a snag. Try again in a sec." },
      { status: 500 },
    );
  }
}
