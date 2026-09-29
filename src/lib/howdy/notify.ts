/**
 * Ops notifications. When a new message lands from a client or a freelancer,
 * ping a human inbox so someone knows to look. Sent directly via AgentMail
 * (NOT through the dry-run-gated saga dispatcher) — these are internal alerts
 * that should always go out, regardless of HOWDY_OUTREACH_DRYRUN.
 */
import { sendFreshEmail } from "@/lib/agentmail/client";
import { envList } from "@/lib/utils";

// Ops inbox(es) to alert. Override with a comma-separated HOWDY_NOTIFY_EMAIL.
const NOTIFY_LIST = envList(
  process.env.HOWDY_NOTIFY_EMAIL || undefined,
  "amanpandit124421@gmail.com,tanashley37@gmail.com,limbernice@bridgecreativesagency.com",
);

/**
 * Send an internal alert to the ops inbox(es). Never throws — an alert failure
 * must never break the request that triggered it.
 */
export async function notifyOps(args: {
  subject: string;
  text: string;
}): Promise<void> {
  try {
    if (NOTIFY_LIST.length === 0) return;
    await sendFreshEmail({
      to: NOTIFY_LIST[0],
      cc: NOTIFY_LIST.slice(1),
      subject: args.subject,
      text: args.text,
    });
  } catch (err) {
    console.error("[notify] ops alert failed:", err);
  }
}

/**
 * Fire a "1 new client / 1 new freelancer" alert for an inbound message. The
 * webhook has already dropped duplicate deliveries and worked out who the
 * sender is. Never throws.
 */
export async function maybeNotifyInbound(args: {
  fromEmail: string;
  subject?: string | null;
  body: string;
  senderType: "client" | "freelancer";
  /** Appended to the alert, e.g. a link to take the conversation over. */
  note?: string;
}): Promise<void> {
  const preview = args.body.replace(/\s+/g, " ").trim();
  const clipped = preview.slice(0, 240);
  await notifyOps({
    subject: `🔔 1 new ${args.senderType} message on Howdy`,
    text: [
      `Hey — we got 1 new ${args.senderType}!`,
      ``,
      `From: ${args.fromEmail}`,
      `Re: ${args.subject?.trim() || "(no subject)"}`,
      ``,
      clipped ? `"${clipped}${preview.length > 240 ? "…" : ""}"` : "(no preview)",
      ``,
      ...(args.note ? [args.note, ``] : []),
      `— Howdy`,
    ].join("\n"),
  });
}
