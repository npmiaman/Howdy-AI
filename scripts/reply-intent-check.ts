/**
 * Live check of the client-reply classifier against real Gemini (uses your
 * GOOGLE_API_KEY quota — ~12 calls). The test suite fakes the model, so this
 * is the only check of the actual prompt. One run, not a benchmark.
 *   npm run howdy:reply-check
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const { classifyClientReply } = await import("../src/lib/howdy/client-replies");
  const f = (id: string, name: string) => ({
    id, name, email: `${id}@x.co`, role: "Video Editor", skills: ["Premiere Pro"], specialties: [],
    rate_usd_per_hour: 55, timezone: "Asia/Singapore", timezone_overlap_hours: [], availability_hours_per_week: 20,
    bio: "Editor", portfolio_summary: "Launch films",
  });
  const people = [f("fl-a", "Maya Chen"), f("fl-b", "Omar Haddad"), f("fl-c", "Priya Nair")];
  const profiles = people.map((p) => `ID: ${p.id} — ${p.name} (${p.role})\nRate: $${p.rate_usd_per_hour}/hr · Timezone: ${p.timezone}\nBio: ${p.bio}`);
  const cases: Array<[string, string]> = [
    ["Let's go with Maya", "pick"],
    ["The second one looks perfect, please connect us", "pick"],
    ["Can we meet Omar and Priya?", "pick"],
    ["Hmm none of these feel right, anyone else?", "more_options"],
    ["These are a bit too junior for us, can you find more senior people?", "more_options"],
    ["What's Priya's day rate roughly?", "question"],
    ["Has Maya done fintech work before?", "question"],
    ["Also we need a photographer for a separate shoot next month", "new_project"],
    ["Thanks so much!", "other"],
    ["Great, will review with my team and get back to you", "other"],
    ["Maya please — and does she do color grading?", "pick"],
    ["not keen on any of them tbh", "more_options"],
  ];
  let right = 0;
  const times: number[] = [];
  for (const [text, want] of cases) {
    const t0 = Date.now();
    const got = await classifyClientReply({ text, profiles, phase: "shortlist_sent" });
    const ms = Date.now() - t0;
    times.push(ms);
    const ok = got.intent === want;
    if (ok) right += 1;
    console.log(`${ok ? "✓" : "✗"} ${String(ms).padStart(5)}ms ${want.padEnd(12)} got=${got.intent.padEnd(12)} ids=${JSON.stringify(got.chosen_freelancer_ids)}  "${text}"${got.reply ? `  → ${got.reply}` : ""}`);
  }
  times.sort((a, b) => a - b);
  console.log(
    `\n${process.env.GEMINI_CHAT_MODEL ?? "gemini-flash-latest"}: ${right}/${cases.length} as expected · median ${times[Math.floor(times.length / 2)]}ms · max ${times[times.length - 1]}ms (one run, temperature 0.2)`,
  );
}
main().catch((e) => { console.error(e); process.exit(1); });
