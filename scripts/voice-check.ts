#!/usr/bin/env tsx
/**
 * Live before/after for Howdy's voice layer: runs the real writing functions
 * against real Gemini with the voice layer off, then on, and scores every
 * message with the humanizer scanner (lower = more human) plus Howdy's hard
 * rules. ~15-25 Gemini calls, paced for the free tier. One run, not a benchmark.
 *
 *   npm run howdy:voice-check
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal, quiet: true });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const content = await import("../src/lib/howdy/outreach-content");
  const post = await import("../src/lib/howdy/post-match-content");
  const { checkVoice } = await import("../src/lib/howdy/voice");

  const freelancer = {
    id: "fl", name: "Maya Chen", email: "maya@x.co", role: "Video Editor",
    skills: ["Premiere Pro", "After Effects"], specialties: ["product launch films"],
    rate_usd_per_hour: 55, timezone: "Asia/Singapore", timezone_overlap_hours: [],
    availability_hours_per_week: 20, bio: "Edits launch films and social cuts for consumer brands.",
    portfolio_summary: "Launch films for two fintech apps; 30+ social cuts.",
  };
  const brief = {
    role: "Video Editor", description: "A 60-second launch film for our fintech app", stack_or_tools: null,
    budget_usd_per_hour_max: 60, timezone_preference: null, deadline: "2 weeks", must_haves: null,
    references: ["Linear launch video"], domain: "fintech", experience_level: "senior" as const,
    red_flags: null, collaboration_style: "proactive",
  };
  const cases: Array<[string, () => Promise<string>]> = [
    ["freelancer pitch", () => content.freelancerPitch({ freelancer, brief })],
    ["shortlist note", () => content.clientShortlistNote({ freelancer, brief, rationale: "Has cut two fintech launch films." })],
    ["intro email", () => content.connectIntro({ freelancer, clientName: "Dana", brief, rationale: "Has cut two fintech launch films." })],
    ["check-in", () => post.checkinEmail({ party: "company", counterpartName: "Maya", round: 1 })],
    ["dig-in question", () => post.digInQuestion({ party: "company", sentiment: "bad", conversation: "It went badly, not a fit." })],
  ];

  const totals = { off: 0, on: 0, offHard: 0, onHard: 0 };
  for (const [label, run] of cases) {
    const row: Record<string, string> = {};
    for (const mode of ["off", "on"] as const) {
      process.env.HOWDY_VOICE = mode;
      const text = await run();
      const v = checkVoice(text);
      const hard = v.problems.filter((p) => /dashes|markdown|stock/.test(p)).length;
      totals[mode] += v.score;
      totals[mode === "off" ? "offHard" : "onHard"] += hard;
      row[mode] = `score ${String(v.score).padStart(2)} · hard-rule hits ${hard} · "${text.replace(/\s+/g, " ").slice(0, 110)}"`;
      await pause(7000);
    }
    console.log(`\n${label}\n  before: ${row.off}\n  after:  ${row.on}`);
  }
  const n = cases.length;
  console.log(
    `\nAverage humanizer score (lower = more human): before ${(totals.off / n).toFixed(1)} → after ${(totals.on / n).toFixed(1)}` +
      `\nHard-rule hits (dashes, markdown, stock phrases): before ${totals.offHard} → after ${totals.onHard}` +
      `\nModel: ${process.env.GEMINI_CHAT_MODEL ?? "gemini-flash-latest"} · ${n} messages · one run, not a benchmark`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
