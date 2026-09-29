import type { BaseMessage } from "@langchain/core/messages";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getChatModel } from "./llm";
import { HOWDY_VOICE } from "./voice";
import {
  type Brief,
  type BriefAssessment,
  FIELD_PRIORITY,
  type FieldStatus,
  REQUIRED_FIELDS,
} from "./types";

// After this many of Howdy's clarifying turns, stop interrogating and proceed
// with whatever we have — a backstop against looping forever.
export const MAX_CLARIFY_TURNS = 6;

const FIELD_KEYS = FIELD_PRIORITY.map((f) => f.key) as [string, ...string[]];

const AssessmentResponseSchema = z.object({
  fields: z
    .array(
      z.object({
        field: z.enum(FIELD_KEYS),
        status: z.enum(["clear", "vague", "missing", "not_applicable"]),
        reason: z
          .string()
          .describe("One short clause on why — for debugging, not shown to the user."),
      }),
    )
    .describe("One entry per field in the priority list."),
  next_field: z
    .enum(FIELD_KEYS)
    .nullable()
    .describe(
      "The single highest-priority field that is still 'vague' or 'missing'. null only if every field is clear or not_applicable.",
    ),
  next_question: z
    .string()
    .nullable()
    .describe(
      "ONE sharp, friendly question for next_field. If the field is vague, reference what the hirer already said and push for the specific missing piece. null when nothing is left to ask.",
    ),
});

function fieldGuide(): string {
  return FIELD_PRIORITY.map(
    (f, i) => `${i + 1}. ${f.key} (${f.label}) — clear when ${f.clearWhen}`,
  ).join("\n");
}

const ASSESS_SYSTEM_PROMPT = `You are Howdy, an AI freelancer-matching agent. Your job in this step is to AUDIT how well you understand the hirer's brief, field by field, and decide the single best next question.

Audit every field below. The first four (description, role, deadline, budget) must be clear before a match can be made; the rest improve the match when the hirer offers them. For EACH field, assign one status:
- "clear": the hirer gave a concrete, specific answer good enough to match on.
- "vague": the hirer touched on it but the answer is too thin, generic, or ambiguous to match on (e.g. budget "reasonable", references "something modern", deadline "soon"). This needs a sharper follow-up.
- "missing": the hirer hasn't addressed it at all yet.
- "not_applicable": the hirer has explicitly signalled this doesn't apply or they have no preference (e.g. "timezone doesn't matter", "no dealbreakers", "any tools are fine"), OR you have already asked about it about twice and they keep not engaging — treat it as resolved, don't keep asking.

The fields, in priority order, with what a CLEAR answer looks like:
${fieldGuide()}

Then:
- Set next_field to the HIGHEST-priority field whose status is "vague" or "missing". If none, set it to null.
- Write next_question: ONE sharp, friendly question (like a smart human matchmaker texting, not a form). Under two sentences, no greeting or preamble.
  - If next_field is "vague": explicitly reference what the hirer already said and push for the specific missing piece. Example — they said budget is "reasonable" → "When you say reasonable, are we talking closer to $30/hr or $80/hr? Ballpark is fine."
  - If next_field is "missing": ask it fresh, grounded in their project.
- Never re-ask a topic they've already answered clearly. Never ask about anything in the memory context.

Return strict JSON matching the schema.

For next_question: ${HOWDY_VOICE}`;

export async function assessBrief(
  messages: BaseMessage[],
  brief: Brief,
  memoryContext: string = "",
  clarifyTurns: number = 0,
): Promise<BriefAssessment> {
  const llm = getChatModel().withStructuredOutput(AssessmentResponseSchema, {
    name: "assessment",
  });

  const conversation = messages
    .map((m) => `${m.getType() === "human" ? "Hirer" : "Howdy"}: ${m.content}`)
    .join("\n");
  const memoryBlock = memoryContext.trim() ? `${memoryContext}\n\n` : "";

  const result = await llm.invoke([
    new SystemMessage(ASSESS_SYSTEM_PROMPT),
    new HumanMessage(
      `${memoryBlock}Brief extracted so far:\n${JSON.stringify(brief, null, 2)}\n\nConversation so far:\n${conversation}\n\nAudit every field and choose the next question.`,
    ),
  ]);

  // Index the model's per-field statuses, then rebuild against the full field
  // list in code so a field the model forgot defaults to "missing" — we never
  // trust the model to enumerate completeness.
  const byField = new Map<string, FieldStatus>();
  const reasons = new Map<string, string>();
  for (const f of result.fields) {
    byField.set(f.field, f.status);
    reasons.set(f.field, f.reason);
  }

  const fields = FIELD_PRIORITY.map((spec) => ({
    field: spec.key,
    status: (byField.get(spec.key) ?? "missing") as FieldStatus,
    reason: reasons.get(spec.key) ?? "not assessed",
  }));

  const unresolved = fields.filter(
    (f) => f.status === "vague" || f.status === "missing",
  );

  // Ready to match once the required core is clear (or explicitly N/A). Hard
  // backstop: after enough clarifying turns, proceed with what we have rather
  // than interrogate the hirer indefinitely.
  const requiredOpen = unresolved.filter((f) => REQUIRED_FIELDS.includes(f.field));
  const hitTurnCap = clarifyTurns >= MAX_CLARIFY_TURNS;
  const allResolved = requiredOpen.length === 0 || hitTurnCap;

  // Pick the next question by our own priority order, not the model's, but use
  // the model's phrasing for it (it has the context to make it sharp).
  let nextField: BriefAssessment["nextField"] = null;
  let nextQuestion: string | null = null;
  if (!allResolved) {
    const top = FIELD_PRIORITY.find((spec) =>
      unresolved.some((u) => u.field === spec.key),
    );
    nextField = top?.key ?? null;
    nextQuestion =
      result.next_field === nextField && result.next_question
        ? result.next_question
        : (result.next_question ?? null);
  }

  return { fields, allResolved, nextField, nextQuestion };
}
