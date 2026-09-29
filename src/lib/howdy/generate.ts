import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";
import { HOWDY_VOICE, polish } from "./voice";

/**
 * One message a person will read: the prompt plus Howdy's voice guide, then
 * polished so it doesn't read as AI (see voice.ts).
 */
export async function generateText(system: string, user: string): Promise<string> {
  const reply = await getChatModel().invoke([
    new SystemMessage(`${system}\n\n${HOWDY_VOICE}`),
    new HumanMessage(user),
  ]);
  return polish(
    (typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)).trim(),
  );
}
