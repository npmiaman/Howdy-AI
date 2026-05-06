#!/usr/bin/env tsx
/**
 * Multi-turn smoketest. Starts vague so the agent asks clarifying questions,
 * drips in info until the brief is actionable, then SCHEDULES a match.
 * Mimics a real "Flutter dev" intro to validate the question-asking depth.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { type BaseMessage, AIMessage, HumanMessage } from "@langchain/core/messages";

import { runHowdyTurn, runScheduledMatch } from "../src/lib/howdy/agent";
import {
  listAllPending,
  markPendingProcessed,
} from "../src/lib/howdy/scheduler";
import { EMPTY_BRIEF, type Brief } from "../src/lib/howdy/types";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const USER_TURNS = [
  "hey howdy, need a flutter developer",
  "for a fitness tracking app — counting reps, charts, social leaderboards",
  "want to ship to App Store and Play Store in 6 weeks",
  "budget around $50/hr, ~120 hours total",
  "needs to feel like Strava — clean, fast, fluid animations",
  "must have shipped a published app before, ideally on App Store",
];

async function main() {
  const messages: BaseMessage[] = [];
  let brief: Brief = EMPTY_BRIEF;

  for (let i = 0; i < USER_TURNS.length; i++) {
    const userText = USER_TURNS[i];
    console.log(`\n[turn ${i + 1}] [user] ${userText}`);
    messages.push(new HumanMessage(userText));

    const out = await runHowdyTurn({ messages, brief });
    brief = out.brief;
    console.log(`[turn ${i + 1}] [howdy] ${out.reply}`);
    messages.push(new AIMessage(out.reply));

    if (out.scheduled) {
      console.log(
        `\n⏱  scheduled match at ${out.scheduled.scheduledAt.toLocaleString()} (queue id: ${out.scheduled.id})`,
      );
      break;
    }
  }

  console.log(`\nFinal brief:\n${JSON.stringify(brief, null, 2)}`);

  console.log("\n— pretending the scheduled time arrived; running worker now —");
  const pending = await listAllPending();
  for (const pm of pending) {
    const { match, reply } = await runScheduledMatch(pm.brief);
    console.log(`\n[worker] match for queue ${pm.id}:`);
    console.log(reply);
    if (match) {
      console.log(
        `\n[worker] selected ${match.freelancer.name} (${match.confidence} confidence)`,
      );
    }
    await markPendingProcessed({
      id: pm.id,
      matchedFreelancerId: match?.freelancer.id ?? null,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
