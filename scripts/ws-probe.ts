#!/usr/bin/env tsx
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

import WebSocket from "ws";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

const apiKey = process.env.AGENTMAIL_API_KEY!;
const inboxId = process.env.AGENTMAIL_INBOX_ID ?? "howdyai@agentmail.to";

const url = `wss://ws.agentmail.to/v0?api_key=${apiKey}`;
console.log("Connecting to:", url.replace(apiKey, "<key>"));

const ws = new WebSocket(url, { handshakeTimeout: 15000 });
ws.on("open", () => {
  console.log("✓ OPEN");
  const sub = {
    type: "subscribe",
    eventTypes: ["message.received"],
    inboxIds: [inboxId],
  };
  console.log("→", JSON.stringify(sub));
  ws.send(JSON.stringify(sub));
});
ws.on("message", (data) => console.log("←", data.toString().slice(0, 500)));
ws.on("error", (err) => console.error("ERR:", err.message));
ws.on("close", (code, reason) =>
  console.log("CLOSE:", code, reason.toString().slice(0, 300)),
);
setTimeout(() => {
  console.log("(probe timeout, exiting)");
  process.exit(0);
}, 15000);
