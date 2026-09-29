#!/usr/bin/env tsx
/**
 * Review freelancer applications from the /freelancers "Request an Invite"
 * form. Requires migration 0006 and Supabase env in .env.local.
 *
 * Usage:
 *   npm run applications list [pending|approved|rejected]
 *   npm run applications approve <id> [--rate <usd>] [--timezone <tz>]
 *   npm run applications reject <id>
 *
 * Approving adds the applicant to `freelancers`. Their embedding is written
 * right away when GOOGLE_API_KEY is set, otherwise by the daily cron.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  type ApplicationStatus,
  approveApplication,
  listApplications,
  rejectApplication,
} from "../src/lib/howdy/applications";
import { ensureFreelancerEmbeddings } from "../src/lib/howdy/data";
import { isSupabaseConfigured } from "../src/lib/supabase/client";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const STATUSES: ApplicationStatus[] = ["pending", "approved", "rejected"];

const USAGE = `Usage:
  npm run applications list [${STATUSES.join("|")}]
  npm run applications approve <id> [--rate <usd>] [--timezone <tz>]
  npm run applications reject <id>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function list(status?: ApplicationStatus) {
  const apps = await listApplications(status);
  if (apps.length === 0) {
    console.log(status ? `No ${status} applications.` : "No applications.");
    return;
  }
  for (const a of apps) {
    console.log(
      [
        `${a.id}  [${a.status}]  ${a.created_at.slice(0, 10)}`,
        `  ${a.full_name} <${a.email}> — ${a.role}`,
        `  ${a.portfolio_url}`,
        `  rate: ${a.rate_usd_per_hour != null ? `$${a.rate_usd_per_hour}/hr` : "—"}` +
          `  tz: ${a.timezone ?? "—"}` +
          `  skills: ${a.skills?.length ? a.skills.join(", ") : "—"}`,
        a.bio ? `  bio: ${a.bio}` : null,
        a.freelancer_id ? `  freelancer: ${a.freelancer_id}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    console.log();
  }
  console.log(`${apps.length} application(s).`);
}

async function approve(id: string, args: string[]) {
  const rateArg = flag(args, "rate");
  const rate = rateArg !== undefined ? Number(rateArg) : undefined;
  if (rate !== undefined && !(rate > 0)) {
    console.error(`--rate must be a positive number, got "${rateArg}".`);
    process.exit(1);
  }
  const f = await approveApplication(id, {
    rateUsdPerHour: rate,
    timezone: flag(args, "timezone"),
  });
  console.log(`✓ Approved. ${f.name} is on the roster as ${f.id}.`);

  if (!process.env.GOOGLE_API_KEY) {
    console.log("  GOOGLE_API_KEY not set; the daily cron will embed them.");
    return;
  }
  try {
    const res = await ensureFreelancerEmbeddings();
    console.log(`  Embedded ${res.embedded} freelancer(s) (${res.failed} failed).`);
  } catch (err) {
    console.warn("  Embedding failed; the daily cron will retry:", err);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const arg = rest[0];
  if (!command || !["list", "approve", "reject"].includes(command)) {
    console.error(USAGE);
    process.exit(1);
  }
  if (command === "list" && arg && !STATUSES.includes(arg as ApplicationStatus)) {
    console.error(`Unknown status "${arg}".\n\n${USAGE}`);
    process.exit(1);
  }
  if (command !== "list" && (!arg || arg.startsWith("--"))) {
    console.error(`Missing application id.\n\n${USAGE}`);
    process.exit(1);
  }
  if (!isSupabaseConfigured()) {
    console.error(
      "Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exit(1);
  }

  if (command === "list") return list(arg as ApplicationStatus | undefined);
  if (command === "approve") return approve(arg, rest);

  await rejectApplication(arg);
  console.log(`✓ Rejected application ${arg}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
