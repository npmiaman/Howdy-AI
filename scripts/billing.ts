#!/usr/bin/env tsx
/**
 * Billable intros (the "$50 per match"). Requires migration 0007 and Supabase
 * env in .env.local.
 *
 * Usage:
 *   npm run billing list                 # intros not yet invoiced, grouped by client
 *   npm run billing invoiced <id> [...]  # mark intros as invoiced
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal, quiet: true });

async function main() {
  const { listUninvoiced, markInvoiced } = await import("../src/lib/howdy/billing");
  const [cmd, ...ids] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await listUninvoiced();
    if (rows.length === 0) return console.log("Nothing to invoice.");
    const byClient = new Map<string, typeof rows>();
    for (const r of rows) byClient.set(r.client_email, [...(byClient.get(r.client_email) ?? []), r]);
    for (const [client, list] of byClient) {
      const total = list.reduce((sum, r) => sum + Number(r.fee_usd), 0);
      console.log(`${client} — ${list.length} intro(s), $${total}`);
      for (const r of list)
        console.log(`  ${r.id}  ${r.created_at.slice(0, 10)}  ${r.freelancer_id ?? "?"}  $${r.fee_usd}`);
    }
    return;
  }
  if (cmd === "invoiced" && ids.length > 0) {
    console.log(`Marked ${await markInvoiced(ids)} intro(s) invoiced.`);
    return;
  }
  console.log("Usage:\n  npm run billing list\n  npm run billing invoiced <id> [...]");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
