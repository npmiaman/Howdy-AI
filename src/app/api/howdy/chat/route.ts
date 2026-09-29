import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { NextResponse } from "next/server";
import { z } from "zod";

import { assessBrief } from "@/lib/howdy/assessor";
import { extractBrief } from "@/lib/howdy/extractor";
import { generateText } from "@/lib/howdy/generate";
import { requestMeta } from "@/lib/howdy/leads";
import { hitRateLimit, LIMITS, spendAiTurn } from "@/lib/howdy/rate-limit";
import {
  appendMessageDeduped,
  findOrCreateThread,
  saveBrief,
} from "@/lib/howdy/threads";
import { EMPTY_BRIEF, type Brief, PROMISE_HOURS } from "@/lib/howdy/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";

import { handOffToEmail, webThreadKey } from "./handoff";
import { withRetry } from "./retry";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CONTENT = 8000;

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Be forgiving: clamp over-long content instead of rejecting the whole
        // request, so an oversized message is still captured (never dropped).
        content: z
          .string()
          .min(1)
          .transform((s) => s.slice(0, MAX_CONTENT)),
      }),
    )
    .min(1)
    .max(60),
  // Stable per-visitor id from the widget, so every turn lands on one thread.
  sessionId: z.string().min(1).max(100).optional(),
  // Sent once the brief is ready: hands the conversation off to email. Shape
  // only here — handOffToEmail validates the values with friendly errors.
  contact: z
    .object({ name: z.string().max(500), email: z.string().max(500) })
    .optional(),
});

// Small deterministic hash → stable fallback session key when none is sent.
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function sessionKeyFor(
  sessionId: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  // Always have a stable key: fall back to a hash of the opening message so a
  // missing sessionId still maps every retry to the same thread.
  const firstUser = messages.find((m) => m.role === "user")?.content ?? "anon";
  return sessionId ?? `auto-${simpleHash(firstUser)}`;
}

/**
 * Capture the visitor's newest message FIRST — before any LLM work — so the
 * message is preserved even if the agent later errors, times out, or rate-
 * limits. Returns the thread id (for the reply) or null if caching is off.
 * On unrecoverable DB failure it logs the full message so it can be replayed
 * from logs rather than silently vanishing.
 */
async function cacheInbound(
  sessionKey: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string | null> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!isSupabaseConfigured()) {
    console.error("[howdy/chat] Supabase not configured — message NOT cached", {
      sessionKey,
      content: lastUser?.content,
    });
    return null;
  }
  try {
    const thread = await withRetry(
      () =>
        findOrCreateThread({
          gmailThreadId: webThreadKey(sessionKey),
          userEmail: `web-${sessionKey.slice(0, 12)}@howdy.chat`,
          subject:
            messages.find((m) => m.role === "user")?.content.slice(0, 80) ??
            "Website chat",
        }),
      "findOrCreateThread",
    );
    if (lastUser) {
      await withRetry(
        () =>
          appendMessageDeduped({
            threadId: thread.id,
            role: "human",
            content: lastUser.content,
          }),
        "appendInbound",
      );
    }
    return thread.id;
  } catch (e) {
    // Last resort: the message is in the logs even if the DB write failed.
    console.error("[howdy/chat] INBOUND LOST — could not persist visitor message", {
      sessionKey,
      content: lastUser?.content,
      error: e instanceof Error ? e.message : e,
    });
    return null;
  }
}

/** Persist this turn's reply + brief. Best-effort with retry; never throws. */
async function cacheReply(
  threadId: string | null,
  reply: string,
  brief: Brief,
): Promise<void> {
  if (!threadId) return;
  try {
    await withRetry(
      () => appendMessageDeduped({ threadId, role: "ai", content: reply }),
      "appendReply",
    );
    await withRetry(() => saveBrief(threadId, brief), "saveBrief");
  } catch {
    /* already logged in withRetry; reply caching is non-critical */
  }
}

const CLARIFY_PROMPT = `You are Howdy, an AI freelancer-matching agent, chatting with a hirer on the Howdy website.

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

// Asked once the brief is ready. Deterministic so the ask for contact details
// (which the widget answers with its inline form) is always there.
function contactAsk(brief: Brief): string {
  const role = brief.role?.trim();
  return `Love it — I've got what I need to start scouting${role ? ` your ${role}` : ""}. What's your name and the best email for your shortlist? It'll land within ${PROMISE_HOURS} hours.`;
}

export async function POST(request: Request) {
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

  const sessionKey = sessionKeyFor(parsed.data.sessionId, parsed.data.messages);

  // Contact details for a ready brief → hand the conversation off to email.
  // Every chat turn is already cached, so this skips the caching below.
  if (parsed.data.contact) {
    return handOffToEmail({
      request,
      sessionKey,
      contact: parsed.data.contact,
    });
  }

  // Capture the message up front — even before checking the LLM is online, so a
  // misconfigured/offline agent never costs us the visitor's message.
  const threadId = await cacheInbound(sessionKey, parsed.data.messages);

  // Limits before any AI work (the message above is already saved).
  const { ip } = requestMeta(request);
  const allowed =
    (await hitRateLimit(`chat:session:${sessionKey}`, LIMITS.chatPerSession())) &&
    (!ip || (await hitRateLimit(`chat:ip:${ip}`, LIMITS.chatPerIp())));
  if (!allowed) {
    return NextResponse.json(
      { error: "That's a lot of messages! Email howdyai@agentmail.to and I'll pick it up there." },
      { status: 429 },
    );
  }
  if (!(await spendAiTurn())) {
    return NextResponse.json(
      { error: "I'm swamped right now — email howdyai@agentmail.to and I'll get back to you." },
      { status: 429 },
    );
  }

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Howdy is offline (missing GOOGLE_API_KEY)." },
      { status: 503 },
    );
  }

  const lcMessages: BaseMessage[] = parsed.data.messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  // Run the agent. A failure here must not lose the message cached above.
  let text: string;
  let needsContact = false;
  let brief: Brief = EMPTY_BRIEF;
  try {
    brief = await extractBrief(lcMessages, EMPTY_BRIEF, "");
    const clarifyTurns = lcMessages.filter(
      (m) => m.getType() !== "human",
    ).length;
    const assessment = await assessBrief(lcMessages, brief, "", clarifyTurns);

    // Brief is ready → ask where to send the shortlist (the handoff happens
    // when the widget posts back the contact details).
    if (assessment.allResolved) {
      text = contactAsk(brief);
      needsContact = true;
    } else if (assessment.nextQuestion?.trim()) {
      // The assessor already wrote the sharp, context-grounded next question
      // (re-asking sharper when the prior answer was vague).
      text = assessment.nextQuestion.trim();
    } else {
      // Fallback: ask from the raw priority prompt if the assessor returned none.
      text = await generateText(
        CLARIFY_PROMPT,
        `Conversation so far:
${lcMessages
  .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
  .join("\n")}

Current brief (extracted):
${JSON.stringify(brief, null, 2)}

Ask the single highest-priority unanswered question.`,
      );
    }
  } catch (err) {
    // The agent failed, but the visitor's message is already cached (step 1).
    // Return a graceful reply instead of a hard error so the chat keeps going.
    console.error("[howdy/chat] agent error (message already cached)", err);
    await cacheReply(
      threadId,
      "[agent error — visitor message preserved]",
      brief,
    );
    return NextResponse.json(
      {
        reply:
          "Sorry — I hit a snag on my end. Your message is saved; mind sending that again?",
        done: false,
      },
      { status: 200 },
    );
  }

  // STEP 3 — persist this turn's reply + brief (best-effort, retried).
  await cacheReply(threadId, text, brief);

  return NextResponse.json(
    needsContact
      ? { reply: text, done: false, needsContact: true }
      : { reply: text, done: false },
  );
}
