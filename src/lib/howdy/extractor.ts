import type { BaseMessage } from "@langchain/core/messages";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { getChatModel } from "./llm";
import { type Brief, BriefSchema, EMPTY_BRIEF } from "./types";

const EXTRACT_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent. Your job here is to extract a structured BRIEF from a conversation between you and a hirer.

Rules:
- Read the entire conversation.
- Extract ONLY information that the hirer has actually stated or strongly implied. Never invent details.
- If a field has not been mentioned, return null for it.
- Merge with any existing brief data passed in. Do not overwrite a field with null if it was previously filled, unless the user explicitly contradicts it.
- Be conservative on numbers (e.g. budget). Only fill if a number was given.
- Return strict JSON matching the schema.`;

export async function extractBrief(
  messages: BaseMessage[],
  previousBrief: Brief = EMPTY_BRIEF,
): Promise<Brief> {
  const llm = getChatModel().withStructuredOutput(BriefSchema, {
    name: "brief",
  });

  const conversation = messages
    .map((m) => {
      const role = m.getType() === "human" ? "Hirer" : "Howdy";
      return `${role}: ${m.content}`;
    })
    .join("\n");

  const input = [
    new SystemMessage(EXTRACT_SYSTEM_PROMPT),
    new HumanMessage(
      `Previous brief (may be partial):\n${JSON.stringify(previousBrief, null, 2)}\n\nConversation so far:\n${conversation}\n\nReturn the merged brief.`,
    ),
  ];

  const result = await llm.invoke(input);
  return mergeBriefs(previousBrief, result);
}

function mergeBriefs(prev: Brief, next: Brief): Brief {
  const merged: Brief = { ...prev };
  for (const k of Object.keys(next) as (keyof Brief)[]) {
    const v = next[k];
    if (v !== null && v !== undefined) {
      // Only overwrite when extraction returned a non-null value.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[k] = v;
    }
  }
  return merged;
}

export function briefCompleteness(brief: Brief): {
  filled: number;
  total: number;
  missing: (keyof Brief)[];
} {
  const fields: (keyof Brief)[] = [
    "role",
    "description",
    "stack_or_tools",
    "budget_usd_per_hour_max",
    "timezone_preference",
    "deadline",
    "must_haves",
    "references",
  ];
  const missing = fields.filter((k) => {
    const v = brief[k];
    if (v === null || v === undefined) return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
  return { filled: fields.length - missing.length, total: fields.length, missing };
}

/**
 * A brief is "actionable" only when it's deep enough to make a confident match.
 * The bar is intentionally high so the agent keeps asking questions — a vague
 * brief like "I need a Flutter developer" should NOT pass. We require:
 *   1. role + description (the basic ask)
 *   2. at least one specificity signal (stack / references / must_haves)
 *   3. at least one constraint signal (deadline / budget)
 *   4. five total fields filled (out of eight)
 */
export function briefIsActionable(brief: Brief): boolean {
  if (!brief.role) return false;
  if (!brief.description || brief.description.trim().length < 30) return false;

  const hasSpecifics =
    (brief.stack_or_tools?.length ?? 0) > 0 ||
    (brief.references?.length ?? 0) > 0 ||
    (brief.must_haves?.length ?? 0) > 0;
  if (!hasSpecifics) return false;

  const hasConstraints =
    !!brief.deadline || brief.budget_usd_per_hour_max !== null;
  if (!hasConstraints) return false;

  const filled = [
    !!brief.role,
    !!brief.description && brief.description.trim().length >= 30,
    (brief.stack_or_tools?.length ?? 0) > 0,
    (brief.references?.length ?? 0) > 0,
    (brief.must_haves?.length ?? 0) > 0,
    !!brief.deadline,
    brief.budget_usd_per_hour_max !== null,
    !!brief.timezone_preference,
  ].filter(Boolean).length;

  return filled >= 6;
}
