#!/usr/bin/env tsx
/**
 * Import / refresh the freelancer roster from the vetted CSV into Supabase,
 * mapping EVERY available column — not just name/email. This is the canonical
 * importer: use it for future roster drops so profiles never land empty again
 * (an empty profile embeds to a useless vector and makes matching meaningless).
 *
 * CSV layout (no header row), columns:
 *   0 name, 1 email, 2 phone, 3 portfolio_url, 4 industries, 5 specialties,
 *   6 display_name, 7 roles, 8 (unused), 9 status, 10 timestamp
 *
 * Usage: npx tsx scripts/import-freelancers-csv.ts ["path/to/file.csv"]
 * Existing freelancers are matched by email and updated in place; the embedding
 * is cleared so the re-embed step (or the cron's self-heal) regenerates it from
 * the freshly-populated profile.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

import { createClient } from "@supabase/supabase-js";

import { ensureFreelancerEmbeddings } from "../src/lib/howdy/data";

const DEFAULT_CSV = join(
  process.cwd(),
  "supabase",
  "migrations",
  "Freelancer list  - Sheet1.csv",
);

// Minimal RFC-4180 line parser: handles quoted fields containing commas.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Profile = {
  name: string;
  email: string;
  role: string;
  skills: string[];
  specialties: string[];
  portfolio_summary: string;
  bio: string;
};

function rowToProfile(cols: string[]): Profile | null {
  const name = cols[0]?.trim();
  const email = cols[1]?.trim().toLowerCase();
  if (!name || !email) return null;

  const portfolioUrl = cols[3]?.trim() ?? "";
  const industries = splitList(cols[4]);
  const specialties = splitList(cols[5]);
  const roles = splitList(cols[7]);
  const status = cols[9]?.trim() || "Vetted";

  const role = roles[0] ?? "Creative";
  // Skills = every listed discipline; specialties = niche + industries so the
  // embedding text is rich enough to separate a photographer from a designer.
  const skills = roles.length ? roles : [];
  const allSpecialties = [...new Set([...specialties, ...industries])];

  const portfolio_summary = [
    portfolioUrl ? `Portfolio: ${portfolioUrl}.` : "",
    industries.length ? `Industries: ${industries.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const bio = [
    `${status} creative — ${roles.join(", ") || role}.`,
    allSpecialties.length ? `Focus: ${allSpecialties.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    name,
    email,
    role,
    skills,
    specialties: allSpecialties,
    portfolio_summary,
    bio,
  };
}

async function main() {
  const csvPath = process.argv[2] || DEFAULT_CSV;
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const lines = readFileSync(csvPath, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const profiles = lines
    .map((l) => rowToProfile(parseCsvLine(l)))
    .filter((p): p is Profile => p !== null);

  console.log(`Parsed ${profiles.length} profiles from ${csvPath}`);

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  for (const p of profiles) {
    const { data: existing } = await sb
      .from("freelancers")
      .select("id")
      .ilike("email", p.email)
      .maybeSingle();

    // Clear embedding so it's regenerated from the fresh profile text.
    const fields = {
      name: p.name,
      role: p.role,
      skills: p.skills,
      specialties: p.specialties,
      portfolio_summary: p.portfolio_summary,
      bio: p.bio,
      embedding: null,
    };

    if (existing?.id) {
      const { error } = await sb
        .from("freelancers")
        .update(fields)
        .eq("id", existing.id);
      if (error) {
        console.error(`  update failed for ${p.email}:`, error.message);
        skipped++;
      } else updated++;
    } else {
      const { error } = await sb
        .from("freelancers")
        .insert({ email: p.email, ...fields });
      if (error) {
        console.error(`  insert failed for ${p.email}:`, error.message);
        skipped++;
      } else inserted++;
    }
  }
  console.log(`Updated ${updated}, inserted ${inserted}, skipped ${skipped}`);

  console.log("Re-embedding refreshed profiles…");
  const res = await ensureFreelancerEmbeddings();
  console.log("  ", res);
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
