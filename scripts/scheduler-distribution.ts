#!/usr/bin/env tsx
/**
 * Sanity test: draws N random match times, prints them, and shows a per-hour
 * histogram so you can verify the distribution is uniform across 9–16.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { pickRandomMatchTime } from "../src/lib/howdy/scheduler";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const N = 200;

function bar(count: number, max: number): string {
  const len = Math.round((count / max) * 40);
  return "█".repeat(len);
}

async function main() {
  const samples: Date[] = [];
  for (let i = 0; i < N; i++) samples.push(pickRandomMatchTime());

  console.log(`\nFirst 10 of ${N} samples:`);
  for (const s of samples.slice(0, 10)) {
    console.log(`  ${s.toLocaleString()}`);
  }

  // Hour histogram (local hour).
  const counts = new Array(24).fill(0);
  for (const s of samples) counts[s.getHours()] += 1;
  const max = Math.max(...counts);

  console.log(`\nHistogram (local hour) over ${N} draws:`);
  for (let h = 0; h < 24; h++) {
    if (counts[h] === 0 && (h < 8 || h > 17)) continue;
    console.log(
      `  ${h.toString().padStart(2, "0")}:00  ${counts[h].toString().padStart(4)}  ${bar(counts[h], max)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
