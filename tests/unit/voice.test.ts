/** Howdy's voice layer: detect AI tells, repair them once, never lose facts. */
import { describe, expect, it } from "vitest";

import { generateText } from "@/lib/howdy/generate";
import { checkVoice, HOWDY_VOICE, polish } from "@/lib/howdy/voice";

import { fakeLLM } from "../fakes/llm";

const AI =
  "I hope this email finds you well! I'm thrilled to delve into your exciting project — it's not just a video, but a testament to your brand's vibrant journey. Let me know if you have any other questions.";
const HUMAN = "Hey Dana, got it. A 60-second launch film for the fintech app, two weeks out. What budget are you working with? Ballpark is fine.";

describe("voice", () => {
  it("flags AI-sounding email and passes a plain one", () => {
    const ai = checkVoice(AI);
    expect(ai.needsRewrite).toBe(true);
    expect(ai.problems.join(" ")).toMatch(/dashes/);
    expect(ai.problems.join(" ")).toMatch(/stock opener/);
    const human = checkVoice(HUMAN);
    expect(human.needsRewrite).toBe(false);
    expect(human.score).toBeLessThan(ai.score);
  });

  it("catches markdown bold in a plain-text email", () => {
    expect(checkVoice("Got your match. **Yuki Tanaka** is a great fit.").problems).toContain("markdown formatting");
  });

  it("leaves clean text alone without spending a rewrite", async () => {
    const calls = fakeLLM.calls.length;
    expect(await polish(HUMAN)).toBe(HUMAN);
    expect(fakeLLM.calls.length).toBe(calls);
  });

  it("rewrites AI-sounding text once, telling the model exactly what to fix", async () => {
    fakeLLM.on("text", () => "Got it. A short film for your brand. Want to talk budget?");
    const out = await polish(AI);
    expect(out).toBe("Got it. A short film for your brand. Want to talk budget?");
    const call = fakeLLM.calls.at(-1)!;
    expect(call.human).toMatch(/Problems to fix/);
    expect(call.human).toMatch(/dashes/);
  });

  it("throws away a rewrite that drops a price, number or link", async () => {
    const text = "Great question — Maya charges $55/hr and her reel is at https://maya.example/reel.";
    fakeLLM.on("text", () => "Maya is lovely and her reel is great.");
    const out = await polish(text);
    expect(out).toContain("$55/hr");
    expect(out).toContain("https://maya.example/reel");
  });

  it("keeps the original when the rewrite fails", async () => {
    fakeLLM.on("text", () => {
      throw new Error("model down");
    });
    expect(await polish(AI)).toContain("vibrant journey");
  });

  it("every generated message carries the voice guide and is polished", async () => {
    fakeLLM.on("text", ({ system }) =>
      system.includes("How Howdy writes") ? "Quick one: are you free next week?" : "— wrong prompt —",
    );
    expect(await generateText("Write a pitch.", "…")).toBe("Quick one: are you free next week?");
    expect(fakeLLM.calls.at(-1)!.system).toContain(HOWDY_VOICE);
  });
});
