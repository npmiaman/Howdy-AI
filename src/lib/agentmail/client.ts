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
  /** e.g. "message.received"; null when the payload didn't say. */
  eventType: string | null;
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  /** Every address on To / Cc (lowercased), for "was Howdy addressed?" checks. */
  to: string[];
  cc: string[];
  /** In-Reply-To + References: the ids of the messages this one answers. */
  replyToIds: string[];
  /** Attachment filenames (inline signature images like image001.png left out). */
  attachments: string[];
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

  const to = addressList(m.to ?? m.to_address ?? m.toAddress);
  const cc = addressList(m.cc);

  // extracted_text is the new content with quoted history stripped — but it
  // can come through empty (e.g. bottom-posted replies), so fall back to the
  // full text with quoted history removed ourselves, then to HTML.
  const body = firstNonEmpty([
    m.extracted_text ?? m.extractedText,
    typeof m.text === "string" ? stripQuotedHistory(m.text) : null,
    stripHtml(m.extracted_html ?? m.extractedHtml ?? ""),
    stripHtml(m.html ?? ""),
  ]);

  const receivedAtRaw = m.timestamp ?? m.created_at ?? m.createdAt ?? Date.now();
  const receivedAt =
    typeof receivedAtRaw === "string" || typeof receivedAtRaw === "number"
      ? new Date(receivedAtRaw)
      : new Date();

  return {
    eventType: typeof raw?.event_type === "string" ? raw.event_type : null,
    messageId: String(
      m.message_id ?? m.messageId ?? m.id ?? `am_${Date.now()}`,
    ),
    threadId: String(m.thread_id ?? m.threadId ?? m.id ?? ""),
    fromEmail,
    fromName,
    to,
    cc,
    attachments: (Array.isArray(m.attachments) ? m.attachments : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a: any) => a?.filename && !(a.inline && /^image\d*\.(png|jpe?g|gif)$/i.test(a.filename)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((a: any) => String(a.filename)),
    replyToIds: [
      m.in_reply_to ?? m.inReplyTo,
      ...(Array.isArray(m.references) ? m.references : []),
    ].filter((id): id is string => typeof id === "string" && id.length > 0),
    subject: m.subject ?? "",
    body,
    receivedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addressList(value: any): string[] {
  if (!value) return [];
  const items: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [value];
  return items
    .map((v) =>
      typeof v === "string"
        ? extractEmail(v)
        : String((v as { email?: string })?.email ?? ""),
    )
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The message as Howdy stores and reads it: the text plus what was attached. */
export function messageText(email: AgentMailIncomingMessage): string {
  return email.attachments.length
    ? `${email.body}\n\n[Attached: ${email.attachments.join(", ")}]`.trim()
    : email.body;
}

function firstNonEmpty(values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Drop quoted history from a plain-text reply: everything from the first
 * "On <date>, <person> wrote:" (Gmail wraps it over two lines sometimes) or
 * Outlook "Original Message" / "From: … Sent:" header, plus any "> " lines.
 */
export function stripQuotedHistory(text: string): string {
  const cut = text.search(
    /(^|\n)[ \t]*(On\s[^\n]*(\n[^\n]*)?\swrote:|-{2,}\s*Original Message\s*-{2,}|From:\s[^\n]+\n[ \t]*(Sent|Date):)/i,
  );
  const head = cut >= 0 ? text.slice(0, cut) : text;
  return head
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
}

function extractEmail(s: string): string {
  const match = s.trim().match(/<(.+?)>$/);
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
 * Label on every email Howdy's code sends. AgentMail marks all outbound mail
 * `sent`, so an outbound message *without* this label was sent by a person
 * (from Momo or the AgentMail console) — that's how takeover is detected.
 */
export const HOWDY_AUTO_LABEL = "howdy-auto";

/**
 * Has a person — not Howdy's code — sent a message on this provider thread
 * since `since`? (Mail from before the label existed can't be told apart, so
 * it's ignored; conversations from then were paused by migration 0007.)
 */
export async function threadHasHumanReply(threadId: string, since: Date): Promise<boolean> {
  const am = getClient();
  const inboxId = await getInboxId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thread = (await am.inboxes.threads.get(inboxId, threadId)) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((thread?.messages ?? []) as any[]).some((m) => {
    const labels: string[] = m.labels ?? [];
    const at = new Date(m.timestamp ?? m.createdAt ?? m.created_at ?? 0);
    return labels.includes("sent") && !labels.includes(HOWDY_AUTO_LABEL) && at >= since;
  });
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
    { text: args.text, labels: [HOWDY_AUTO_LABEL] },
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
  cc?: string[];
}): Promise<{ messageId: string; threadId: string }> {
  const am = getClient();
  const inboxId = await getInboxId();
  const result = await am.inboxes.messages.send(inboxId, {
    to: [args.to],
    ...(args.cc && args.cc.length ? { cc: args.cc } : {}),
    subject: args.subject,
    text: args.text,
    labels: [HOWDY_AUTO_LABEL],
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
