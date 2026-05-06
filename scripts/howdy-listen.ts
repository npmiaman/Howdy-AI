#!/usr/bin/env tsx
/**
 * Live-test the agent end-to-end against your real AgentMail inbox using
 * AgentMail's WebSocket. No public URL, no Supabase, no Vercel needed.
 *
 *   npm run howdy:listen
 *
 * Then email howdyai@agentmail.to from any address. Watch this terminal as the
 * agent reads, decides (clarify vs schedule), and replies. When a brief is
 * scheduled for later, you can fast-forward by hitting Enter — the listener
 * drains the pending queue immediately and sends the match reply too.
 */
import "dotenv/config";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { AgentMailClient } from "agentmail";
import WebSocket from "ws";

import { runHowdyTurn, runScheduledMatch } from "../src/lib/howdy/agent";
import {
  listAllPending,
  listDuePendingMatches,
  markPendingProcessed,
} from "../src/lib/howdy/scheduler";
import { type Brief, EMPTY_BRIEF } from "../src/lib/howdy/types";

const envLocal = join(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadDotenv({ path: envLocal });

if (!process.env.GOOGLE_API_KEY) {
  console.error("GOOGLE_API_KEY missing in .env.local.");
  process.exit(1);
}
if (!process.env.AGENTMAIL_API_KEY) {
  console.error("AGENTMAIL_API_KEY missing in .env.local.");
  process.exit(1);
}

const apiKey = process.env.AGENTMAIL_API_KEY;
const client = new AgentMailClient({ apiKey });

type ThreadState = {
  messages: BaseMessage[];
  brief: Brief;
  lastInboundMessageId: string | null;
  fromEmail: string;
  subject: string;
};
const threads = new Map<string, ThreadState>();

async function pickInboxId(): Promise<string> {
  if (process.env.AGENTMAIL_INBOX_ID) return process.env.AGENTMAIL_INBOX_ID;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (await client.inboxes.list()) as any;
  const items = list?.inboxes ?? list?.items ?? list?.data ?? [];
  if (!items.length) throw new Error("No inboxes available for this API key.");
  return items[0].inboxId ?? items[0].inbox_id ?? items[0].id;
}

function fromAddressToEmail(from: unknown): string {
  if (typeof from === "string") {
    const match = from.match(/<(.+?)>$/);
    return match ? match[1].trim() : from.trim();
  }
  if (Array.isArray(from)) return fromAddressToEmail(from[0]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = from as any;
  return obj?.email ?? obj?.address ?? "";
}

async function handleInbound(message: {
  messageId?: string;
  message_id?: string;
  threadId?: string;
  thread_id?: string;
  from?: unknown;
  subject?: string;
  text?: string;
  extractedText?: string;
  extracted_text?: string;
}) {
  const messageId = String(message.messageId ?? message.message_id ?? "");
  const threadId = String(message.threadId ?? message.thread_id ?? messageId);
  const fromEmail = fromAddressToEmail(message.from);
  const body = (
    message.extractedText ??
    message.extracted_text ??
    message.text ??
    ""
  ).trim();
  if (!body || !messageId) {
    console.log(
      `[skip] empty body or no message id for inbound from ${fromEmail}`,
    );
    return;
  }
  const subject = message.subject ?? "(no subject)";

  const existing = threads.get(threadId);
  const state: ThreadState = existing ?? {
    messages: [],
    brief: EMPTY_BRIEF,
    lastInboundMessageId: null,
    fromEmail,
    subject,
  };
  state.messages.push(new HumanMessage(body));
  state.lastInboundMessageId = messageId;

  console.log(`\n─── inbound from ${fromEmail} ───`);
  console.log(`  subject: ${subject}`);
  console.log(`  body:    ${body.slice(0, 200)}${body.length > 200 ? "…" : ""}`);

  const out = await runHowdyTurn({
    messages: state.messages,
    brief: state.brief,
    threadId,
    userEmail: fromEmail,
    subject,
  });
  state.brief = out.brief;
  state.messages.push(new AIMessage(out.reply));
  threads.set(threadId, state);

  console.log(
    `\n  agent → ${out.scheduled ? "SCHEDULED" : "CLARIFY"}: ${out.reply}`,
  );
  if (out.scheduled) {
    console.log(
      `           queued match for ${out.scheduled.scheduledAt.toLocaleString()} (id ${out.scheduled.id})`,
    );
  }

  const inboxId = await pickInboxId();
  await client.inboxes.messages.reply(inboxId, messageId, {
    text: out.reply,
  });
  console.log(`  → replied via AgentMail`);
}

/**
 * Drain pending matches whose scheduled_at has arrived. By default only fires
 * for "due" matches. Pass `forceAll=true` to drain everything (manual Enter).
 */
async function drainPending(forceAll = false) {
  const pending = forceAll
    ? await listAllPending()
    : await listDuePendingMatches();
  if (pending.length === 0) {
    if (forceAll) console.log("\n(no pending matches in queue)\n");
    return;
  }
  if (forceAll) {
    console.log(`\n— draining ${pending.length} pending match(es) now —`);
  } else {
    console.log(`\n[auto] firing ${pending.length} match(es) whose time has come`);
  }
  const inboxId = await pickInboxId();
  for (const pm of pending) {
    const state = threads.get(pm.threadId);
    const { match, reply } = await runScheduledMatch(pm.brief);
    console.log(`\n  match for queue ${pm.id}:`);
    console.log(`  ${reply.split("\n").join("\n  ")}`);
    if (match) {
      console.log(
        `  selected ${match.freelancer.name} (${match.confidence} confidence)`,
      );
    }
    if (state?.lastInboundMessageId) {
      await client.inboxes.messages.reply(
        inboxId,
        state.lastInboundMessageId,
        { text: reply },
      );
      console.log(`  → sent match reply via AgentMail`);
      state.messages.push(new AIMessage(reply));
    }
    await markPendingProcessed({
      id: pm.id,
      matchedFreelancerId: match?.freelancer.id ?? null,
    });
  }
}

async function main() {
  const inboxId = await pickInboxId();
  console.log(`\nListening on inbox: ${inboxId}`);
  console.log(`Send an email to that address to test.`);
  console.log(`Press Enter to fast-forward any scheduled matches NOW.`);
  console.log(`Auto-drain: every 30s, fires matches whose scheduled time has arrived.`);
  console.log(`Ctrl+C to quit.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", () => {
    void drainPending(true);
  });

  // Auto-drain due matches every 30 seconds. Lets the random 9-16 schedule
  // fire on its own without manual intervention while the listener is up.
  setInterval(() => {
    drainPending(false).catch((err) => console.error("[auto-drain]", err));
  }, 30_000);

  const url = `wss://ws.agentmail.to/v0?api_key=${apiKey}`;
  const ws = new WebSocket(url, { handshakeTimeout: 15000 });
  ws.on("open", () => {
    console.log("[ws] connected, subscribing…");
    ws.send(
      JSON.stringify({
        type: "subscribe",
        eventTypes: ["message.received"],
        inboxIds: [inboxId],
      }),
    );
  });
  ws.on("message", async (raw) => {
    let event: unknown;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any;
    if (ev?.type === "subscribed") {
      console.log("[ws] subscribed.");
      return;
    }
    if (ev?.eventType === "message.received" || ev?.event_type === "message.received") {
      try {
        await handleInbound(ev.message ?? ev.data?.message ?? ev);
      } catch (err) {
        console.error("[handler error]", err);
      }
    } else {
      console.log("[ws] event:", JSON.stringify(ev).slice(0, 200));
    }
  });
  ws.on("error", (err) => console.error("[ws] error", err.message ?? err));
  ws.on("close", (code) => {
    console.log(`[ws] closed (${code})`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
