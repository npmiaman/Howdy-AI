import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Freelancer } from "./types";

let cache: Freelancer[] | null = null;

export function loadFreelancers(): Freelancer[] {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "freelancers.json");
  const raw = readFileSync(path, "utf-8");
  cache = JSON.parse(raw) as Freelancer[];
  return cache;
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
