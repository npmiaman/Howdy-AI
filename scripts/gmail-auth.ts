#!/usr/bin/env tsx
/**
 * One-time Gmail OAuth flow to obtain a refresh token.
 *
 * Setup before running:
 * 1. Go to https://console.cloud.google.com → APIs & Services → OAuth consent screen.
 *    Set up an "External" app, add yourself as a test user.
 * 2. Credentials → Create credentials → OAuth client ID → "Desktop app".
 * 3. Copy the client ID and secret into .env.local as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
 * 4. Enable the Gmail API in APIs & Services → Library.
 *
 * Then run: npm run gmail:auth
 * Open the printed URL, sign in with the Howdy inbox account, paste the code back.
 * Copy the printed refresh token into .env.local as GOOGLE_REFRESH_TOKEN.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { google } from "googleapis";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET missing. Add them to .env.local first.",
    );
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob",
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n1. Open this URL in a browser, sign in as the Howdy inbox account:");
  console.log("\n   " + url + "\n");
  console.log("2. After approving, Google will show you a code. Copy and paste it here.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("code ▶ ")).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token in response. Re-run with prompt=consent or revoke prior consent at https://myaccount.google.com/permissions.",
    );
    process.exit(1);
  }

  console.log("\n✓ Got tokens. Add this to .env.local:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
