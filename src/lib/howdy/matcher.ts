import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { rateLabel } from "./data";
import { getChatModel, getEmbeddingModel } from "./llm";
import type {
  Brief,
  Freelancer,
  MatchResult,
  RankedMatch,
} from "./types";

function briefToEmbeddingText(brief: Brief): string {
  const parts: string[] = [];
  if (brief.role) parts.push(brief.role);
  if (brief.description) parts.push(`Project: ${brief.description}`);
  if (brief.stack_or_tools?.length)
    parts.push(`Stack: ${brief.stack_or_tools.join(", ")}.`);
  if (brief.references?.length)
    parts.push(`Style references: ${brief.references.join(", ")}.`);
  if (brief.must_haves?.length)
    parts.push(`Must-haves: ${brief.must_haves.join(", ")}.`);
  if (brief.domain) parts.push(`Domain: ${brief.domain}.`);
  if (brief.experience_level)
    parts.push(`Experience level: ${brief.experience_level}.`);
  if (brief.collaboration_style)
    parts.push(`Working style wanted: ${brief.collaboration_style}.`);
  if (brief.red_flags?.length)
    parts.push(`Avoid: ${brief.red_flags.join(", ")}.`);
  return parts.join(" ");
}

type Candidate = { freelancer: Freelancer; score: number };

async function shortlistViaSupabase(
  brief: Brief,
  briefVec: number[],
  limit = 5,
): Promise<Candidate[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_freelancers", {
    query_embedding: briefVec,
    match_count: limit,
    budget_max: brief.budget_usd_per_hour_max,
    tz_filter: brief.timezone_preference,
  });
  if (error) throw error;
  if (!data) return [];
  return (data as Array<Freelancer & { similarity: number | null }>).map(
    (row) => {
      const { similarity, ...freelancer } = row;
      // A null similarity means the row had no embedding to compare against.
      // Coerce to 0 so ranking degrades gracefully instead of crashing on
      // `.toFixed` — the self-healing backfill fills real values shortly after.
      return {
        freelancer,
        score: typeof similarity === "number" ? similarity : 0,
      };
    },
  );
}

/** Vector shortlist from the live roster (budget / timezone filtered in SQL). */
async function shortlist(
  brief: Brief,
  briefVec: number[],
  limit: number,
): Promise<Candidate[]> {
  return isSupabaseConfigured() ? shortlistViaSupabase(brief, briefVec, limit) : [];
}

const RerankSchema = z.object({
  picks: z
    .array(
      z.object({
        freelancer_id: z.string(),
        rationale: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(1)
    .min(1),
});

const RERANK_SYSTEM_PROMPT = `You are Howdy, picking the single best freelancer match for a given brief.

You will receive a brief and a shortlist of candidate freelancers. Choose ONE freelancer who best fits the brief, and explain why in two short sentences.

Rules:
- Confidence is "high" only when the brief is specific and the freelancer's portfolio shows comparable past work.
- Confidence is "medium" when most of the brief matches but one or two attributes (e.g. references, must-haves) are uncertain.
- Confidence is "low" when the brief is vague or no candidate is a strong match. Pick the closest one anyway.
- The rationale should reference specific details (skills, portfolio, rate, timezone) rather than generic praise.
- Return JSON matching the schema.`;

const RankSchema = z.object({
  ranking: z
    .array(
      z.object({
        freelancer_id: z.string(),
        rationale: z
          .string()
          .describe(
            "Two short sentences on why this freelancer fits THIS project and THIS client — specific to skills, portfolio, rate, timezone.",
          ),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .describe("Candidates ordered best-first."),
});

const RANK_SYSTEM_PROMPT = `You are Howdy, ranking freelancers for a brief.

You will receive a brief and a shortlist of candidate freelancers. Order ALL of them from best fit to worst fit for this specific brief, and for each write a two-sentence rationale grounded in concrete details (skills, portfolio, rate, timezone) — not generic praise.

Confidence per freelancer:
- "high": brief is specific and their portfolio shows comparable past work.
- "medium": most of the brief matches but one or two attributes are uncertain.
- "low": weak fit; included only to fill out the ranking.

Return JSON matching the schema, every candidate included exactly once, best first.`;

/**
 * Rank the top freelancers for a brief, best-first. This is the seam where a
 * trajectory-predictive model will eventually replace the embedding + rerank
 * pipeline — callers only depend on the RankedMatch[] shape.
 */
export async function rankMatches(
  brief: Brief,
  limit = 12,
): Promise<RankedMatch[]> {
  const briefText = briefToEmbeddingText(brief);
  if (!briefText.trim()) return [];
  const briefVec = await getEmbeddingModel().embedQuery(briefText);

  const candidates = await shortlist(brief, briefVec, limit);
  if (candidates.length === 0) return [];

  const llm = getChatModel().withStructuredOutput(RankSchema, { name: "rank" });
  const candidatesBlock = candidates
    .map(
      ({ freelancer: f, score }) => `
ID: ${f.id}
Name: ${f.name}
Role: ${f.role}
Skills: ${f.skills.join(", ")}
Specialties: ${f.specialties.join(", ")}
Rate: ${rateLabel(f.rate_usd_per_hour)}
Timezone: ${f.timezone}
Availability: ${f.availability_hours_per_week} hrs/week
Bio: ${f.bio}
Portfolio: ${f.portfolio_summary}
Vector score: ${score.toFixed(3)}`,
    )
    .join("\n---");

  const result = await llm.invoke([
    new SystemMessage(RANK_SYSTEM_PROMPT),
    new HumanMessage(`Brief:
${JSON.stringify(brief, null, 2)}

Candidates (by vector similarity):
${candidatesBlock}

Rank every candidate best-first.`),
  ]);

  const byId = new Map(candidates.map((c) => [c.freelancer.id, c]));
  const ranked: RankedMatch[] = [];
  for (const pick of result.ranking) {
    const cand = byId.get(pick.freelancer_id);
    if (!cand) continue;
    ranked.push({
      freelancer: cand.freelancer,
      rank: ranked.length,
      score: cand.score,
      rationale: pick.rationale,
      confidence: pick.confidence,
    });
  }
  // Backstop: if the model dropped anyone, append them by vector score so the
  // pool is never smaller than what we filtered to.
  for (const c of candidates) {
    if (!ranked.some((r) => r.freelancer.id === c.freelancer.id)) {
      ranked.push({
        freelancer: c.freelancer,
        rank: ranked.length,
        score: c.score,
        rationale: "Close vector match on the brief.",
        confidence: "low",
      });
    }
  }
  return ranked;
}

export async function findBestMatch(brief: Brief): Promise<MatchResult | null> {
  const briefText = briefToEmbeddingText(brief);
  if (!briefText.trim()) return null;
  const briefVec = await getEmbeddingModel().embedQuery(briefText);

  const shortlistResult = await shortlist(brief, briefVec, 5);

  if (shortlistResult.length === 0) return null;

  const llm = getChatModel().withStructuredOutput(RerankSchema, {
    name: "rerank",
  });
  const candidatesBlock = shortlistResult
    .map(
      ({ freelancer: f, score }) => `
ID: ${f.id}
Name: ${f.name}
Role: ${f.role}
Skills: ${f.skills.join(", ")}
Specialties: ${f.specialties.join(", ")}
Rate: ${rateLabel(f.rate_usd_per_hour)}
Timezone: ${f.timezone}
Bio: ${f.bio}
Portfolio: ${f.portfolio_summary}
Vector score: ${score.toFixed(3)}`,
    )
    .join("\n---");

  const result = await llm.invoke([
    new SystemMessage(RERANK_SYSTEM_PROMPT),
    new HumanMessage(`Brief:
${JSON.stringify(brief, null, 2)}

Candidates (ranked by vector similarity):
${candidatesBlock}

Pick the single best freelancer.`),
  ]);

  const pick = result.picks[0];
  const matched = shortlistResult.find(
    (s) => s.freelancer.id === pick.freelancer_id,
  );
  if (!matched) return null;
  return {
    freelancer: matched.freelancer,
    rationale: pick.rationale,
    confidence: pick.confidence,
  };
}
