#!/usr/bin/env tsx
/**
 * One-shot smoketest of the Howdy agent.
 * Sends a single brief, prints the agent's reply + scheduled match time,
 * then runs the worker once so you can see the proposal.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { HumanMessage } from "@langchain/core/messages";

import { runHowdyTurn, runScheduledMatch } from "../src/lib/howdy/agent";
import {
  listAllPending,
  markPendingProcessed,
} from "../src/lib/howdy/scheduler";
import { EMPTY_BRIEF } from "../src/lib/howdy/types";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const TEST_BRIEF =
  "Hey Howdy, need a video editor for our launch film. Linear/Apple style, 2-week deadline, ~30 min raw footage. Got someone good?";

async function main() {
  console.log(`\n[user] ${TEST_BRIEF}\n`);
  const out = await runHowdyTurn({
    messages: [new HumanMessage(TEST_BRIEF)],
    brief: EMPTY_BRIEF,
  });
  console.log(`[howdy] ${out.reply}\n`);
  if (out.scheduled) {
    console.log(
      `[scheduler] queued match for ${out.scheduled.scheduledAt.toLocaleString()} (id ${out.scheduled.id})\n`,
    );
  }

  console.log("— pretending scheduled time arrived; running worker now —\n");
  const pending = await listAllPending();
  for (const pm of pending) {
    const { match, reply } = await runScheduledMatch(pm.brief);
    console.log(`[worker → user]\n${reply}\n`);
    if (match) {
      console.log(
        `[worker] picked: ${match.freelancer.name} (${match.confidence})\n`,
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
