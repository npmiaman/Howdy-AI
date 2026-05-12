import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";
import { loadMessages } from "./threads";
import { loadMemories, memoriesAsContext } from "./memories";
import type { Brief } from "./types";

const WELCOME_BACK_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent. The hirer has just re-registered on the website. They have talked to you before. Write a short, warm "welcome back" reply that lands in the SAME email thread you had with them.

Rules:
- Open with their first name on its own line, comma-style ("Hey Maya,"), then a blank line.
- Reference one specific thing from your prior conversation — the role they were hiring, the project, or the deadline. Pull this from the brief or recent messages I provide. Do NOT invent details.
- If a match was already sent in the thread, ask how it went. Otherwise, ask if they want to pick up where you left off or start something new.
- Sign off with "Howdy" on its own line.
- Keep the whole message to 4-5 short lines. Sound like a friendly, sharp human, not a chatbot.
- No emojis. No subject line. No quoted history.`;

export async function composeWelcomeBack(args: {
  fullName: string;
  threadId: string;
  userEmail: string;
  brief: Brief;
  hadMatch: boolean;
}): Promise<string> {
  const firstName = args.fullName.split(" ")[0] || args.fullName;

  const [history, memories] = await Promise.all([
    loadMessages(args.threadId),
    loadMemories(args.userEmail),
  ]);

  // Trim history for the prompt — last ~6 turns is plenty of context.
  const recent = history.slice(-6);
  const transcript = recent
    .map(
      (m) =>
        `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`,
    )
    .join("\n");

  const memoryBlock = memoriesAsContext(memories);

  const llm = getChatModel();
  const reply = await llm.invoke([
    new SystemMessage(WELCOME_BACK_SYSTEM_PROMPT),
    new HumanMessage(
      `Hirer's name: ${firstName} (full: ${args.fullName})

${memoryBlock ? memoryBlock + "\n\n" : ""}Brief from the previous conversation (may be partial):
${JSON.stringify(args.brief ?? {}, null, 2)}

Last few messages in the thread:
${transcript || "(none)"}

A match has already been delivered: ${args.hadMatch ? "yes" : "no"}.

Write the welcome-back reply.`,
    ),
  ]);

  const text =
    typeof reply.content === "string"
      ? reply.content.trim()
      : JSON.stringify(reply.content);
  return text;
}
