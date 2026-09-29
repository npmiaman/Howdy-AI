import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import { sameEmail } from "@/lib/utils";

import { getEmbeddingModel } from "./llm";
import type { Freelancer } from "./types";

const FREELANCER_COLS =
  "id,name,email,role,skills,specialties,rate_usd_per_hour,timezone,timezone_overlap_hours,availability_hours_per_week,bio,portfolio_summary";

/**
 * Rehydrate full freelancer records by id from the live roster — the only
 * source of freelancers. (There's deliberately no local fallback: a made-up
 * seed profile once reached a real client that way.)
 */
export async function getFreelancersByIds(
  ids: string[],
): Promise<Freelancer[]> {
  if (ids.length === 0 || !isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("freelancers")
    .select(FREELANCER_COLS)
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as unknown as Freelancer[];
}

/**
 * A freelancer's rate for emails and prompts. The roster has rows with no
 * rate recorded (stored as 0) — never show a client "$0/hr".
 */
export function rateLabel(rate: number | null | undefined): string {
  return rate && rate > 0 ? `$${rate}/hr` : "rate on request";
}

/** Freelancers by id, keyed for lookup. */
export async function getFreelancerMap(
  ids: string[],
): Promise<Map<string, Freelancer>> {
  const list = await getFreelancersByIds([...new Set(ids)]);
  return new Map(list.map((f) => [f.id, f]));
}

/** Roster ids for an email address (exact, case-insensitive). */
export async function findFreelancerIdsByEmail(email: string): Promise<string[]> {
  if (!isSupabaseConfigured() || !email) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("freelancers")
    .select("id,email")
    .ilike("email", email);
  if (error) return [];
  return (data ?? [])
    .filter((f: { email: string }) => sameEmail(f.email, email))
    .map((f: { id: string }) => f.id);
}

export function freelancerToEmbeddingText(f: Freelancer): string {
  return [
    f.role,
    `Skills: ${(f.skills ?? []).join(", ")}.`,
    `Specialties: ${(f.specialties ?? []).join(", ")}.`,
    f.bio,
    f.portfolio_summary,
  ]
    .filter(Boolean)
    .join(" ");
}

// pgvector accepts its text input as "[1,2,3]".
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Self-healing embeddings. Finds every freelancer missing an `embedding` and
 * writes one (Gemini). Idempotent and cheap when nothing is missing — this is
 * the guard that keeps a freelancer imported without an embedding (e.g. from a
 * CSV upload) from silently breaking matching. Run on a schedule via the cron.
 */
export async function ensureFreelancerEmbeddings(
  batchLimit = 500,
): Promise<{ embedded: number; failed: number; missing: number }> {
  if (!isSupabaseConfigured()) return { embedded: 0, failed: 0, missing: 0 };
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("freelancers")
    .select(FREELANCER_COLS)
    .is("embedding", null)
    .limit(batchLimit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Freelancer[];
  if (rows.length === 0) return { embedded: 0, failed: 0, missing: 0 };

  const vectors = await getEmbeddingModel().embedDocuments(
    rows.map(freelancerToEmbeddingText),
  );

  let embedded = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const { error: upErr } = await sb
      .from("freelancers")
      .update({ embedding: toVectorLiteral(vectors[i]) })
      .eq("id", rows[i].id);
    if (upErr) {
      failed += 1;
      console.error(
        `[embeddings] failed for ${rows[i].id}:`,
        upErr.message,
      );
    } else {
      embedded += 1;
    }
  }
  return { embedded, failed, missing: rows.length };
}
