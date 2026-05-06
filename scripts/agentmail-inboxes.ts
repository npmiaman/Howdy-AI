#!/usr/bin/env tsx
/**
 * List all inboxes the AGENTMAIL_API_KEY can see.
 * Use the printed inbox_id as AGENTMAIL_INBOX_ID in .env.local if you want to
 * pin a specific one (otherwise the integration auto-picks the first).
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { listInboxes } from "../src/lib/agentmail/client";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

async function main() {
  if (!process.env.AGENTMAIL_API_KEY) {
    console.error("AGENTMAIL_API_KEY missing in .env.local.");
    process.exit(1);
  }
  const inboxes = await listInboxes();
  if (inboxes.length === 0) {
    console.log("No inboxes found. Create one in the AgentMail console.");
    return;
  }
  console.log(`Found ${inboxes.length} inbox(es):\n`);
  for (const ib of inboxes) {
    console.log(JSON.stringify(ib, null, 2));
    console.log("---");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
