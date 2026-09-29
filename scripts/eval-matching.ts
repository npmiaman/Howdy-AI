#!/usr/bin/env tsx
/**
 * Score the ranker against real hand-made shortlists (research/eval/answer-key.json).
 * Runs rankMatches against the live roster (read-only) with real Gemini calls
 * (~2 per brief). With a handful of briefs this is directional, not proof.
 *
 *   npm run eval:matching
 */
import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal, quiet: true });

type Pick = { name: string; freelancer_id: string | null; note?: string };
type Entry = { id: string; brief: Record<string, unknown>; human_picks: Pick[] };

async function main() {
  const { rankMatches } = await import("../src/lib/howdy/matcher");
  const key = JSON.parse(readFileSync(join(process.cwd(), "research/eval/answer-key.json"), "utf-8")) as {
    briefs: Entry[];
  };
  let onRoster = 0;
  let inTop3 = 0;
  let offRoster = 0;
  for (const entry of key.briefs) {
    const ranked = await rankMatches(entry.brief as never, 12);
    console.log(`\n${entry.id}`);
    console.log(`  ranker top 5: ${ranked.slice(0, 5).map((r) => r.freelancer.name).join(" · ") || "(nothing)"}`);
    for (const pick of entry.human_picks) {
      if (!pick.freelancer_id) {
        offRoster += 1;
        console.log(`  – ${pick.name}: ${pick.note ?? "not on the roster"}`);
        continue;
      }
      onRoster += 1;
      const pos = ranked.findIndex((r) => r.freelancer.id === pick.freelancer_id);
      if (pos >= 0 && pos < 3) inTop3 += 1;
      console.log(`  ${pos >= 0 && pos < 3 ? "✓" : "✗"} ${pick.name}: ${pos >= 0 ? `ranked #${pos + 1}` : "not in the top 12"}`);
    }
  }
  console.log(
    `\nHuman picks on the roster ranked in the top 3: ${inTop3}/${onRoster}. Picks not on the roster: ${offRoster}.` +
      `\n${key.briefs.length} brief(s) — directional only; add every new hand-made shortlist to the answer key.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
