#!/usr/bin/env tsx
/**
 * Local CLI to chat with the Howdy agent.
 * Usage: npm run howdy
 *
 * Requires GOOGLE_API_KEY in .env.local.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { HumanMessage } from "@langchain/core/messages";

import { runHowdyTurn } from "../src/lib/howdy/agent";
import { EMPTY_BRIEF, type Brief } from "../src/lib/howdy/types";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

if (!process.env.GOOGLE_API_KEY) {
  console.error(
    "\nGOOGLE_API_KEY missing. Add it to .env.local at the repo root and re-run.\n",
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  console.log("\nHowdy CLI — type your brief, hit enter, ctrl+c to quit.\n");
  const messages: HumanMessage[] = [];
  let brief: Brief = EMPTY_BRIEF;

  while (true) {
    const userInput = (await rl.question("you ▶ ")).trim();
    if (!userInput) continue;
    messages.push(new HumanMessage(userInput));
    const out = await runHowdyTurn({ messages, brief });
    brief = out.brief;
    console.log(`\nhowdy ▶ ${out.reply}\n`);
    if (out.scheduled) {
      console.log(
        `       (scheduled match for ${out.scheduled.scheduledAt.toLocaleString()})\n`,
      );
    } else {
      const filledFields = Object.entries(brief)
        .filter(([, v]) => v !== null && (!Array.isArray(v) || v.length > 0))
        .map(([k]) => k);
      console.log(`       (brief filled: ${filledFields.join(", ") || "—"})\n`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
