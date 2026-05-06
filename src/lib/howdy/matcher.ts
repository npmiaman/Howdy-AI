import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { freelancerToEmbeddingText, loadFreelancers } from "./data";
import {
  cosineSimilarity,
  getChatModel,
  getEmbeddingModel,
} from "./llm";
import type { Brief, Freelancer, MatchResult } from "./types";

let inMemoryEmbeddings: Map<string, number[]> | null = null;

async function ensureInMemoryEmbeddings(): Promise<Map<string, number[]>> {
  if (inMemoryEmbeddings) return inMemoryEmbeddings;
  const embedModel = getEmbeddingModel();
  const freelancers = loadFreelancers();
  const texts = freelancers.map(freelancerToEmbeddingText);
  const vectors = await embedModel.embedDocuments(texts);
  inMemoryEmbeddings = new Map(
    freelancers.map((f, i) => [f.id, vectors[i]]),
  );
  return inMemoryEmbeddings;
}

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
  return parts.join(" ");
}

function applyHardFilters(
  brief: Brief,
  freelancers: Freelancer[],
): Freelancer[] {
  return freelancers.filter((f) => {
    if (
      brief.budget_usd_per_hour_max !== null &&
      f.rate_usd_per_hour > brief.budget_usd_per_hour_max
    ) {
      return false;
    }
    if (brief.timezone_preference) {
      const tzPref = brief.timezone_preference.toLowerCase();
      const overlapMatch =
        f.timezone_overlap_hours.some((tz) =>
          tz.toLowerCase().includes(tzPref),
        ) || f.timezone.toLowerCase().includes(tzPref);
      if (!overlapMatch) return false;
    }
    return true;
  });
}

type Candidate = { freelancer: Freelancer; score: number };

async function shortlistViaSupabase(
  brief: Brief,
  briefVec: number[],
): Promise<Candidate[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("match_freelancers", {
    query_embedding: briefVec,
    match_count: 5,
    budget_max: brief.budget_usd_per_hour_max,
    tz_filter: brief.timezone_preference,
  });
  if (error) throw error;
  if (!data) return [];
  return (data as Array<Freelancer & { similarity: number }>).map((row) => {
    const { similarity, ...freelancer } = row;
    return { freelancer, score: similarity };
  });
}

async function shortlistViaJson(
  brief: Brief,
  briefVec: number[],
): Promise<Candidate[]> {
  const all = loadFreelancers();
  const filtered = applyHardFilters(brief, all);
  if (filtered.length === 0) return [];
  const embeddings = await ensureInMemoryEmbeddings();
  return filtered
    .map((f) => {
      const vec = embeddings.get(f.id);
      if (!vec) return null;
      return { freelancer: f, score: cosineSimilarity(briefVec, vec) };
    })
    .filter((x): x is Candidate => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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

export async function findBestMatch(brief: Brief): Promise<MatchResult | null> {
  const briefText = briefToEmbeddingText(brief);
  if (!briefText.trim()) return null;
  const briefVec = await getEmbeddingModel().embedQuery(briefText);

  const shortlist = isSupabaseConfigured()
    ? await shortlistViaSupabase(brief, briefVec)
    : await shortlistViaJson(brief, briefVec);

  if (shortlist.length === 0) return null;

  const llm = getChatModel().withStructuredOutput(RerankSchema, {
    name: "rerank",
  });
  const candidatesBlock = shortlist
    .map(
      ({ freelancer: f, score }) => `
ID: ${f.id}
Name: ${f.name}
Role: ${f.role}
Skills: ${f.skills.join(", ")}
Specialties: ${f.specialties.join(", ")}
Rate: $${f.rate_usd_per_hour}/hr
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
  const matched = shortlist.find((s) => s.freelancer.id === pick.freelancer_id);
  if (!matched) return null;
  return {
    freelancer: matched.freelancer,
    rationale: pick.rationale,
    confidence: pick.confidence,
  };
}
