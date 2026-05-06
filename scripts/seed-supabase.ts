#!/usr/bin/env tsx
/**
 * One-time: push the JSON freelancers into Supabase with Gemini embeddings.
 * Run after applying supabase/migrations/0001_init.sql.
 *
 * Usage: npm run seed:supabase
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { freelancerToEmbeddingText, loadFreelancers } from "../src/lib/howdy/data";
import { getEmbeddingModel } from "../src/lib/howdy/llm";
import { getSupabaseAdmin, isSupabaseConfigured } from "../src/lib/supabase/client";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

async function main() {
  if (!process.env.GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY missing in .env.local.");
    process.exit(1);
  }
  if (!isSupabaseConfigured()) {
    console.error(
      "Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exit(1);
  }

  const freelancers = loadFreelancers();
  console.log(`Embedding ${freelancers.length} freelancers...`);

  const embedModel = getEmbeddingModel();
  const texts = freelancers.map(freelancerToEmbeddingText);
  const vectors = await embedModel.embedDocuments(texts);

  const rows = freelancers.map((f, i) => ({
    id: f.id,
    name: f.name,
    email: f.email,
    role: f.role,
    skills: f.skills,
    specialties: f.specialties,
    rate_usd_per_hour: f.rate_usd_per_hour,
    timezone: f.timezone,
    timezone_overlap_hours: f.timezone_overlap_hours,
    availability_hours_per_week: f.availability_hours_per_week,
    bio: f.bio,
    portfolio_summary: f.portfolio_summary,
    embedding: vectors[i],
  }));

  console.log("Upserting into Supabase...");
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("freelancers").upsert(rows);
  if (error) {
    console.error("Upsert failed:", error);
    process.exit(1);
  }
  console.log(`✓ ${rows.length} freelancers seeded with embeddings.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
