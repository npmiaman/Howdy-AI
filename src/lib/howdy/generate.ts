import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";
import { HOWDY_VOICE, polish } from "./voice";

/**
 * One message a person will read: the prompt plus Howdy's voice guide, then
 * polished so it doesn't read as AI (see voice.ts).
 */
export async function generateText(system: string, user: string): Promise<string> {
  // HOWDY_VOICE=off is the kill switch (and the "before" in voice-check).
  const voiced = process.env.HOWDY_VOICE !== "off";
  const reply = await getChatModel().invoke([
    new SystemMessage(voiced ? `${system}\n\n${HOWDY_VOICE}` : system),
    new HumanMessage(user),
  ]);
  const text = (
    typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)
  ).trim();
  return voiced ? polish(text) : text;
}
