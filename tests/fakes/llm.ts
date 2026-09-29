/**
 * Deterministic stand-in for Gemini. Structured calls are answered by handlers
 * keyed on the schema `name` (e.g. "brief", "assessment", "decision"); text
 * calls return a tagged placeholder. Every structured answer is validated
 * against the real zod schema, so a handler can't return a shape the
 * production model couldn't.
 *
 * Default handlers are simple keyword heuristics over the prompt — enough to
 * drive realistic conversations through the whole flow. Tests override any
 * handler with `fakeLLM.on(name, fn)` for a specific scenario.
 */
import type { BaseMessage } from "@langchain/core/messages";
import type { ZodType } from "zod";

import { FIELD_PRIORITY } from "@/lib/howdy/types";

export type LlmCall = { name: string; system: string; human: string };
type Handler = (call: LlmCall) => unknown;

function textOf(m: BaseMessage): string {
  return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
}

function split(messages: BaseMessage[]): { system: string; human: string } {
  const system = messages
    .filter((m) => m.getType() === "system")
    .map(textOf)
    .join("\n");
  const human = messages
    .filter((m) => m.getType() !== "system")
    .map(textOf)
    .join("\n");
  return { system, human };
}

/** Lines the hirer wrote, pulled out of a "Hirer: …" transcript. */
function hirerLines(human: string): string[] {
  return human
    .split("\n")
    .filter((l) => l.startsWith("Hirer:"))
    .map((l) => l.slice("Hirer:".length).trim());
}

function jsonAfter(label: string, text: string): Record<string, unknown> | null {
  const i = text.indexOf(label);
  if (i < 0) return null;
  const start = text.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === "{") depth++;
    if (text[j] === "}") depth--;
    if (depth === 0) return JSON.parse(text.slice(start, j + 1));
  }
  return null;
}

const ROLES = [
  "video editor",
  "motion designer",
  "brand designer",
  "graphic designer",
  "photographer",
  "illustrator",
  "copywriter",
];

export function heuristicBrief(human: string): Record<string, unknown> {
  const lines = hirerLines(human);
  const all = lines.join(" \n ");
  const role = ROLES.find((r) => all.toLowerCase().includes(r)) ?? null;
  const budget = all.match(/\$\s?(\d+)\s*(?:\/|per\s*)\s*h(?:ou)?r/i);
  const deadline = all.match(/\b(?:in|within)\s+(\d+\s*(?:days?|weeks?|months?))/i);
  const level = all.match(/\b(junior|mid|senior|lead)\b/i);
  const domain = all.match(/\b(fintech|fashion|gaming|saas|f&b|food|beauty|music)\b/i);
  const description = [...lines].sort((a, b) => b.length - a.length)[0] ?? null;
  return {
    role: role ? role.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    description: description && description.length >= 20 ? description : null,
    stack_or_tools: null,
    budget_usd_per_hour_max: budget ? Number(budget[1]) : null,
    timezone_preference: null,
    deadline: deadline ? deadline[1] : null,
    must_haves: null,
    references: null,
    domain: domain ? domain[1].toLowerCase() : null,
    experience_level: level ? level[1].toLowerCase() : null,
    red_flags: null,
    collaboration_style: null,
  };
}

const FIELD_ORDER = FIELD_PRIORITY.map((f) => f.key as string);

function heuristicAssessment(human: string) {
  const brief = jsonAfter("Brief extracted so far:", human) ?? {};
  const fields = FIELD_ORDER.map((field) => {
    const v = brief[field];
    const filled = v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
    return { field, status: filled ? "clear" : "missing", reason: "fake" };
  });
  const next = fields.find((f) => f.status !== "clear");
  return {
    fields,
    next_field: next?.field ?? null,
    next_question: next ? `Q:${next.field}?` : null,
    needs_human: false,
    human_reason: null,
  };
}

/** Roster lines like "ID: f1 — Maya Chen (Video Editor)" from a prompt. */
function roster(human: string): Array<{ id: string; name: string }> {
  return [...human.matchAll(/ID: (\S+) — ([^(\n]+?) \(/g)].map((m) => ({
    id: m[1],
    name: m[2].trim(),
  }));
}

/** The text after `label`, up to the prompt's next blank line. */
function lastReply(human: string, label: string): string {
  const i = human.lastIndexOf(label);
  const rest = (i >= 0 ? human.slice(i + label.length) : human).replace(/^\s+/, "");
  const end = rest.indexOf("\n\n");
  return end >= 0 ? rest.slice(0, end) : rest;
}

function picks(text: string, list: Array<{ id: string; name: string }>): string[] {
  const t = text.toLowerCase();
  const ordinals = ["first", "second", "third"];
  const out = new Set<string>();
  list.forEach((r, i) => {
    const first = r.name.split(" ")[0].toLowerCase();
    if (t.includes(first) || t.includes(ordinals[i]) || t.includes(`#${i + 1}`)) out.add(r.id);
  });
  if (/\b(all|all three|everyone)\b/.test(t)) list.forEach((r) => out.add(r.id));
  return [...out];
}

function yesNo(text: string): "yes" | "no" | "unclear" {
  if (/\b(no|nope|not available|can't|cannot|pass|busy|decline)\b/i.test(text)) return "no";
  if (/\b(yes|yep|yeah|sure|i'm in|im in|interested|available|definitely)\b/i.test(text))
    return "yes";
  return "unclear";
}

export const DEFAULT_HANDLERS: Record<string, Handler> = {
  brief: ({ human }) => heuristicBrief(human),
  assessment: ({ human }) => heuristicAssessment(human),
  decision: ({ human }) => ({ decision: yesNo(lastReply(human, "Freelancer reply:")) }),
  yesno: ({ human }) => ({ answer: yesNo(lastReply(human, "Their reply:")) }),
  sentiment: ({ human }) => {
    const t = lastReply(human, "Their message:");
    if (/\b(bad|awful|poor|not great|didn't|terrible|disappoint)/i.test(t))
      return { sentiment: "bad" };
    if (/\b(great|good|amazing|loved|went well|fantastic)/i.test(t))
      return { sentiment: "good" };
    return { sentiment: "unclear" };
  },
  selection: ({ human }) => ({
    chosen_freelancer_ids: picks(lastReply(human, "Client reply:"), roster(human)),
  }),
  rank: ({ human }) => ({
    ranking: [...human.matchAll(/^ID: (\S+)$/gm)].map((m) => ({
      freelancer_id: m[1],
      rationale: `fake rationale for ${m[1]}`,
      confidence: "medium",
    })),
  }),
  rerank: ({ human }) => {
    const first = human.match(/^ID: (\S+)$/m);
    return {
      picks: [{ freelancer_id: first?.[1] ?? "none", rationale: "fake", confidence: "medium" }],
    };
  },
  client_reply: ({ human }) => {
    const text = lastReply(human, "Client reply:");
    const list = roster(human);
    const t = text.toLowerCase();
    const none = { reason: null, reply: null };
    if (/\b(refund|lawyer|legal|contract|complain\w*|unacceptable|speak to (a )?(human|person|someone)|real person|pricing|fees?|invoice)\b/.test(t))
      return { ...none, intent: "needs_human", chosen_freelancer_ids: [], reason: "raised " + text.trim().slice(0, 40) };
    if (/\b(anyone else|someone else|other options|more options|none of (these|them)|not a fit)\b/.test(t))
      return { ...none, intent: "more_options", chosen_freelancer_ids: [], reason: text.trim() };
    if (/\b(new project|another project|different project|also need)\b/.test(t))
      return { ...none, intent: "new_project", chosen_freelancer_ids: [] };
    if (/\b(tell me more|what about|how much|portfolio|\?)/.test(t) && !/\b(let'?s go with|connect me|please)\b/.test(t))
      return { ...none, intent: "question", chosen_freelancer_ids: picks(text, list), reply: "[fake answer from profiles]" };
    const chosen = picks(text, list);
    if (chosen.length) return { ...none, intent: "pick", chosen_freelancer_ids: chosen };
    return { ...none, intent: "other", chosen_freelancer_ids: [], reply: "[fake small talk]" };
  },
};

export class FakeLLM {
  calls: LlmCall[] = [];
  private handlers = new Map<string, Handler>();

  on(name: string, fn: Handler) {
    this.handlers.set(name, fn);
  }

  callsTo(name: string): LlmCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  model() {
    return {
      invoke: async (messages: BaseMessage[]) => {
        const { system, human } = split(messages);
        const handler = this.handlers.get("text");
        this.calls.push({ name: "text", system, human });
        const content = handler
          ? String(handler({ name: "text", system, human }))
          : `[fake reply: ${system.split("\n")[0].slice(0, 60)}]`;
        return { content };
      },
      withStructuredOutput: (schema: ZodType, opts: { name: string }) => ({
        invoke: async (messages: BaseMessage[]) => {
          const { system, human } = split(messages);
          const call = { name: opts.name, system, human };
          this.calls.push(call);
          const handler = this.handlers.get(opts.name) ?? DEFAULT_HANDLERS[opts.name];
          if (!handler) throw new Error(`fake llm: no handler for "${opts.name}"`);
          return schema.parse(await handler(call));
        },
      }),
    };
  }

  reset() {
    this.calls = [];
    this.handlers.clear();
  }
}

export const fakeLLM = new FakeLLM();

/** Deterministic bag-of-words embedding so similar texts score closer. */
export function fakeEmbed(text: string, dims = 64): number[] {
  const v = new Array(dims).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % dims] += 1;
  }
  if (v.every((x) => x === 0)) v[0] = 1;
  return v;
}

export const fakeEmbedder = {
  embedQuery: async (t: string) => fakeEmbed(t),
  embedDocuments: async (ts: string[]) => ts.map((t) => fakeEmbed(t)),
};
