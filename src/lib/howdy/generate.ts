import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";

/** One plain-text LLM turn: system prompt + user prompt → trimmed text. */
export async function generateText(system: string, user: string): Promise<string> {
  const reply = await getChatModel().invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);
  return (
    typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)
  ).trim();
}
