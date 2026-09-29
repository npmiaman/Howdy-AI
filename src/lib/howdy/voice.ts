/**
 * Howdy's voice: every message a person receives should read like a sharp,
 * friendly human wrote it.
 *
 * - Prevention: HOWDY_VOICE is appended to every writing prompt. Its rules
 *   adapt the 26 patterns of blader/humanizer (MIT,
 *   github.com/blader/humanizer), built on Wikipedia's "Signs of AI writing",
 *   to short business email.
 * - Detection: checkVoice() scores text with brandonwise/humanizer (MIT,
 *   github.com/brandonwise/humanizer — 30 patterns, 500+ tell words) plus
 *   Howdy's own hard rules (dashes, markdown, stock openers and closers).
 * - Repair: polish() applies the scanner's mechanical fixes, and only when a
 *   message still reads as AI does it spend one rewrite. A rewrite that drops
 *   a number or link is thrown away.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { analyze } from "humanizer";
import { autoFix } from "humanizer/src/humanizer.js";

import { getChatModel } from "./llm";

export const HOWDY_VOICE = `How Howdy writes (every message):
- You are Howdy, a talent scout emailing a real person. Write like a sharp, friendly human typing a quick email: plain words, short sentences, contractions.
- Reply in the language the other person wrote in.
- Get to the point in the first line. No warm-ups ("I hope this email finds you well", "Great question", "Thanks for reaching out") and no chatbot closers ("Let me know if you have any other questions", "Hope this helps", "Feel free to reach out").
- No em dashes or en dashes. Use a period, comma, or colon.
- Plain text only: no markdown, no bold, no bullet symbols, no emojis, no headings.
- Say things plainly. No hype or AI words: thrilled, excited, amazing, seamless, vibrant, delve, tapestry, testament, journey, unlock, elevate, pivotal, landscape, showcase, crucial.
- No "not just X, but Y". No lists of three just for rhythm. No dramatic one-line closer, and don't restate what you just said.
- Don't stack qualifiers ("could potentially"). Use simple verbs ("is", not "serves as").
- Use their first name at most once, and don't add a sign-off unless asked.`;

const REWRITE_THRESHOLD = Number(process.env.HOWDY_VOICE_THRESHOLD ?? 20);

const HARD_RULES: Array<[string, RegExp]> = [
  ["em/en dashes", /[—–]/],
  ["markdown formatting", /\*\*|__|^#{1,6}\s|^\s*[•▪]/m],
  [
    "stock opener or closer",
    /(hope (this|the) (email|message|note) finds you|i hope you('| a)re (doing )?well|great question|thanks for reaching out|let me know if you have any (other |more )?questions|hope this helps|feel free to (reach out|let me know)|don'?t hesitate to)/i,
  ],
];

export type VoiceCheck = { score: number; problems: string[]; needsRewrite: boolean };

export function checkVoice(text: string): VoiceCheck {
  const { score, findings } = analyze(text);
  const problems = findings.map(
    (f) => `${f.patternName}: ${f.matches.slice(0, 3).map((m) => `"${m.match}"`).join(", ")}`,
  );
  const hard = HARD_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
  return {
    score,
    problems: [...hard, ...problems],
    needsRewrite: hard.length > 0 || score >= REWRITE_THRESHOLD,
  };
}

/** Numbers, prices and links a rewrite must keep. */
function facts(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/\S+|\$?\d[\d,.]*(?:\/hr|%|k)?/gi) ?? [])];
}

const REWRITE_SYSTEM = `You edit short emails so they read like a person wrote them. Keep every fact, name, number, price, date, link and question exactly as given, and keep the same meaning and roughly the same length. Change only what the listed problems call for. Return only the rewritten message, nothing else.

${HOWDY_VOICE}`;

/**
 * Make an AI-written message read human. Mechanical fixes always; one rewrite
 * only when the message still reads as AI, kept only if it scores better and
 * drops no facts. Never throws — the original is the fallback.
 */
export async function polish(text: string): Promise<string> {
  const fixed = autoFix(text).text;
  const before = checkVoice(fixed);
  if (!before.needsRewrite) return fixed;
  try {
    const reply = await getChatModel().invoke([
      new SystemMessage(REWRITE_SYSTEM),
      new HumanMessage(`Problems to fix:\n- ${before.problems.join("\n- ")}\n\nEmail:\n${fixed}`),
    ]);
    const rewritten = autoFix(
      (typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content)).trim(),
    ).text;
    const kept = facts(fixed).every((f) => rewritten.includes(f));
    const after = checkVoice(rewritten);
    const better =
      after.score < before.score || (after.score === before.score && after.problems.length < before.problems.length);
    return rewritten && kept && better ? rewritten : fixed;
  } catch (err) {
    console.warn("[voice] rewrite failed, sending as written:", err);
    return fixed;
  }
}
