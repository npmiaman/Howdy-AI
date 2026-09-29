/**
 * Per-user long-term memory. Facts saved here persist across email threads, so
 * Howdy remembers who you are and what you've hired for over time.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type { Brief } from "./types";

export async function saveMemory(args: {
  userEmail: string;
  fact: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("memories").insert({
    user_email: args.userEmail,
    fact: args.fact,
  });
  if (error) {
    console.warn("[memories] insert failed:", error.message);
  }
}

export async function saveMemories(args: {
  userEmail: string;
  facts: string[];
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const cleaned = args.facts.map((f) => f.trim()).filter(Boolean);
  if (!cleaned.length) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("memories").insert(
    cleaned.map((fact) => ({
      user_email: args.userEmail,
      fact,
    })),
  );
  if (error) {
    console.warn("[memories] bulk insert failed:", error.message);
  }
}

export async function loadMemories(
  userEmail: string,
  limit = 30,
): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("memories")
    .select("fact")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[memories] load failed:", error.message);
    return [];
  }
  return (data ?? []).map(
    (row: { fact: string }) => row.fact,
  );
}

/** Save facts this person doesn't already have on file (exact-match dedupe). */
export async function remember(userEmail: string, facts: string[]): Promise<void> {
  const known = new Set(await loadMemories(userEmail, 200));
  const fresh = [...new Set(facts.map((f) => f.trim()).filter(Boolean))].filter((f) => !known.has(f));
  if (fresh.length) await saveMemories({ userEmail, facts: fresh });
}

/**
 * Durable facts from a completed brief, so the next search starts smarter
 * (the brief itself belongs to one project; these carry across projects).
 */
export function briefFacts(brief: Brief): string[] {
  const role = brief.role ?? "a creative";
  return [
    brief.role ? `Has hired for: ${brief.role}.` : "",
    brief.budget_usd_per_hour_max ? `Budget for ${role}: up to $${brief.budget_usd_per_hour_max}/hr.` : "",
    brief.domain ? `Industry: ${brief.domain}.` : "",
    brief.references?.length ? `Style references they like: ${brief.references.join(", ")}.` : "",
    brief.red_flags?.length ? `Wants to avoid: ${brief.red_flags.join(", ")}.` : "",
    brief.collaboration_style ? `Likes freelancers who are: ${brief.collaboration_style}.` : "",
  ];
}

export function memoriesAsContext(memories: string[]): string {
  if (!memories.length) return "";
  return [
    "Things you already know about this person from prior conversations:",
    ...memories.map((m) => `- ${m}`),
  ].join("\n");
}
