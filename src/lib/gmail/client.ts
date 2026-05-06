import { google, gmail_v1 } from "googleapis";

let gmailClient: gmail_v1.Gmail | null = null;

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Gmail OAuth env missing: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.",
    );
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export function getGmail(): gmail_v1.Gmail {
  if (gmailClient) return gmailClient;
  gmailClient = google.gmail({ version: "v1", auth: getOAuth2Client() });
  return gmailClient;
}

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

export type IncomingEmail = {
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  body: string;
  receivedAt: Date;
};

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8",
  );
}

function extractBodyFromPayload(payload: gmail_v1.Schema$MessagePart): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    // Prefer text/plain over text/html.
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) {
      const raw = decodeBase64Url(html.body.data);
      // Crude HTML strip; good enough for "what did they say".
      return raw
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
    }
    for (const part of payload.parts) {
      const nested = extractBodyFromPayload(part);
      if (nested) return nested;
    }
  }
  return "";
}

function parseFromHeader(value: string): { name: string; email: string } {
  const match = value.match(/^(.*?)<(.+?)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: "", email: value.trim() };
}

function stripQuoted(body: string): string {
  // Strip Gmail quote tails: "On <date>, <name> <email> wrote:" and after
  const idx = body.search(/On .+? wrote:/);
  if (idx > -1) return body.slice(0, idx).trim();
  return body.trim();
}

export async function listInboxSince(
  sinceUnixSeconds: number,
  maxResults = 20,
): Promise<IncomingEmail[]> {
  const gmail = getGmail();
  const query = `in:inbox -from:me after:${sinceUnixSeconds}`;
  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  if (!list.data.messages) return [];

  const out: IncomingEmail[] = [];
  for (const m of list.data.messages) {
    if (!m.id) continue;
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "full",
    });
    const msg = detail.data;
    const headers = msg.payload?.headers ?? [];
    const headerMap = Object.fromEntries(
      headers.map((h) => [h.name?.toLowerCase() ?? "", h.value ?? ""]),
    );
    const from = parseFromHeader(headerMap.from ?? "");
    const subject = headerMap.subject ?? "";
    const to = headerMap.to ?? "";
    const body = stripQuoted(
      extractBodyFromPayload(msg.payload ?? {}),
    );
    out.push({
      messageId: msg.id ?? "",
      threadId: msg.threadId ?? "",
      fromEmail: from.email,
      fromName: from.name,
      toEmail: to,
      subject,
      body,
      receivedAt: new Date(Number(msg.internalDate ?? 0)),
    });
  }
  return out;
}

export async function sendReply(args: {
  to: string;
  subject: string;
  body: string;
  threadId: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = getGmail();
  const subject = args.subject.startsWith("Re:") ? args.subject : `Re: ${args.subject}`;
  const lines = [
    `To: ${args.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`);
  if (args.references) lines.push(`References: ${args.references}`);
  lines.push("");
  lines.push(args.body);
  const raw = Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sent = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: args.threadId },
  });
  return {
    messageId: sent.data.id ?? "",
    threadId: sent.data.threadId ?? "",
  };
}

export async function getMessageIdHeader(messageId: string): Promise<string> {
  const gmail = getGmail();
  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Message-Id", "Message-ID"],
  });
  const headers = detail.data.payload?.headers ?? [];
  const id = headers.find(
    (h) => h.name?.toLowerCase() === "message-id",
  )?.value;
  return id ?? "";
}
