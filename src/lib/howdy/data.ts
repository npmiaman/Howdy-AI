import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type { Freelancer } from "./types";

let cache: Freelancer[] | null = null;

export function loadFreelancers(): Freelancer[] {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "freelancers.json");
  const raw = readFileSync(path, "utf-8");
  cache = JSON.parse(raw) as Freelancer[];
  return cache;
}

const FREELANCER_COLS =
  "id,name,email,role,skills,specialties,rate_usd_per_hour,timezone,timezone_overlap_hours,availability_hours_per_week,bio,portfolio_summary";

/** Rehydrate full freelancer records by id (Supabase in prod, JSON otherwise). */
export async function getFreelancersByIds(
  ids: string[],
): Promise<Freelancer[]> {
  if (ids.length === 0) return [];
  if (isSupabaseConfigured()) {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("freelancers")
      .select(FREELANCER_COLS)
      .in("id", ids);
    if (!error && data) return data as unknown as Freelancer[];
  }
  const byId = new Map(loadFreelancers().map((f) => [f.id, f]));
  return ids
    .map((id) => byId.get(id))
    .filter((f): f is Freelancer => f !== undefined);
}

export function freelancerToEmbeddingText(f: Freelancer): string {
  return [
    f.role,
    `Skills: ${f.skills.join(", ")}.`,
    `Specialties: ${f.specialties.join(", ")}.`,
    f.bio,
    f.portfolio_summary,
  ].join(" ");
}
