/**
 * AgentMail delivers webhooks through Svix. Verify the signature so nobody who
 * finds the URL can inject fake inbound email. Signature = base64
 * HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${raw body}`, keyed with the
 * base64 part of the endpoint's `whsec_…` secret (AGENTMAIL_WEBHOOK_SECRET).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export type WebhookAuth =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function verifyWebhook(rawBody: string, headers: Headers): WebhookAuth {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret) {
    // Never run unauthenticated in production; local dev and previews are fine.
    return process.env.VERCEL_ENV === "production"
      ? { ok: false, status: 503, error: "webhook_secret_not_configured" }
      : { ok: true };
  }

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures)
    return { ok: false, status: 401, error: "missing_signature" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > TOLERANCE_SECONDS)
    return { ok: false, status: 401, error: "stale_signature" };

  const expected = signPayload(secret, id, timestamp, rawBody);
  const valid = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return valid ? { ok: true } : { ok: false, status: 401, error: "bad_signature" };
}

export function signPayload(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): Buffer {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
}
