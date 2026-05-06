/**
 * Thin wrapper around the AgentMail SDK. We pick the inbox once (cached) so
 * the rest of the codebase can call `sendReply(...)` without ever knowing
 * what inbox id is in play.
 */
import { AgentMailClient } from "agentmail";

let client: AgentMailClient | null = null;
let resolvedInboxId: string | null = null;

export function isAgentMailConfigured(): boolean {
  return !!process.env.AGENTMAIL_API_KEY;
}

function getClient(): AgentMailClient {
  if (client) return client;
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is missing. Add it to .env.local before using the AgentMail integration.",
    );
  }
  client = new AgentMailClient({ apiKey });
  return client;
}

/**
 * Resolve which inbox to send/reply from. Order of precedence:
 *   1. Env var AGENTMAIL_INBOX_ID — pin a specific inbox.
 *   2. Auto-pick the first inbox returned by `inboxes.list()`.
 */
export async function getInboxId(): Promise<string> {
  if (resolvedInboxId) return resolvedInboxId;
  const fromEnv = process.env.AGENTMAIL_INBOX_ID;
  if (fromEnv) {
    resolvedInboxId = fromEnv;
    return resolvedInboxId;
  }
  const list = await getClient().inboxes.list();
  // The SDK paginates; `list()` returns a page object. Grab the first inbox.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list as any).inboxes ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list as any).items ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list as any).data ??
    [];
  if (items.length === 0) {
    throw new Error(
      "AgentMail returned 0 inboxes for this API key. Create one in the console first or set AGENTMAIL_INBOX_ID.",
    );
  }
  const first = items[0];
  resolvedInboxId =
    first.inbox_id ??
    first.inboxId ??
    first.id ??
    first.email_address ??
    null;
  if (!resolvedInboxId) {
    throw new Error(
      `Could not extract an inbox id from AgentMail response: ${JSON.stringify(first)}`,
    );
  }
  return resolvedInboxId;
}

export type AgentMailIncomingMessage = {
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  /** Body with quoted history removed if the platform provided it. */
  body: string;
  receivedAt: Date;
};

/**
 * Best-effort parser for AgentMail webhook payloads. Their schema may evolve;
 * we keep this loose and pull whichever field exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseInboundPayload(raw: any): AgentMailIncomingMessage {
  // The webhook event commonly looks like { type: "message.received", message: {...} }
  const m = raw?.message ?? raw?.data?.message ?? raw?.data ?? raw;
  if (!m) {
    throw new Error(
      `Unrecognized AgentMail payload shape: ${JSON.stringify(raw).slice(0, 400)}`,
    );
  }

  const fromValue = m.from ?? m.from_address ?? m.fromAddress ?? "";
  const fromEmail =
    typeof fromValue === "string"
      ? extractEmail(fromValue)
      : (fromValue.email ?? "");
  const fromName =
    typeof fromValue === "string"
      ? extractName(fromValue)
      : (fromValue.name ?? null);

  const toValue = m.to ?? m.to_address ?? m.toAddress ?? "";
  const toEmail = Array.isArray(toValue)
    ? typeof toValue[0] === "string"
      ? extractEmail(toValue[0])
      : (toValue[0]?.email ?? "")
    : typeof toValue === "string"
      ? extractEmail(toValue)
      : (toValue?.email ?? "");

  const body =
    m.extracted_text ??
    m.extractedText ??
    m.text ??
    stripHtml(m.html ?? m.extracted_html ?? "");

  const receivedAtRaw = m.timestamp ?? m.created_at ?? m.createdAt ?? Date.now();
  const receivedAt =
    typeof receivedAtRaw === "string" || typeof receivedAtRaw === "number"
      ? new Date(receivedAtRaw)
      : new Date();

  return {
    messageId: String(
      m.message_id ?? m.messageId ?? m.id ?? `am_${Date.now()}`,
    ),
    threadId: String(m.thread_id ?? m.threadId ?? m.id ?? ""),
    fromEmail,
    fromName,
    toEmail,
    subject: m.subject ?? "",
    body: typeof body === "string" ? body.trim() : "",
    receivedAt,
  };
}

function extractEmail(s: string): string {
  const match = s.match(/<(.+?)>$/);
  return match ? match[1].trim() : s.trim();
}

function extractName(s: string): string | null {
  const match = s.match(/^(.*?)<.+?>$/);
  if (!match) return null;
  return match[1].trim().replace(/^"|"$/g, "") || null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reply to a specific inbound message (preserves the thread).
 */
export async function replyToMessage(args: {
  messageId: string;
  text: string;
}): Promise<{ messageId: string; threadId: string }> {
  const am = getClient();
  const inboxId = await getInboxId();
  const result = await am.inboxes.messages.reply(
    inboxId,
    args.messageId,
    { text: args.text },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  return {
    messageId: String(r?.message_id ?? r?.messageId ?? r?.id ?? ""),
    threadId: String(r?.thread_id ?? r?.threadId ?? ""),
  };
}

/**
 * Send a fresh email (not a reply). Used when we have an email address but
 * no inbound message_id to reply to.
 */
export async function sendFreshEmail(args: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ messageId: string; threadId: string }> {
  const am = getClient();
  const inboxId = await getInboxId();
  const result = await am.inboxes.messages.send(inboxId, {
    to: [args.to],
    subject: args.subject,
    text: args.text,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  return {
    messageId: String(r?.message_id ?? r?.messageId ?? r?.id ?? ""),
    threadId: String(r?.thread_id ?? r?.threadId ?? ""),
  };
}

/** Quick sanity check — list inboxes. Used by scripts/agentmail-inboxes.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listInboxes(): Promise<any[]> {
  const am = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (await am.inboxes.list()) as any;
  return list?.inboxes ?? list?.items ?? list?.data ?? [];
}
