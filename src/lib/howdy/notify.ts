/**
 * Ops notifications. When a new message lands from a client or a freelancer,
 * ping a human inbox so someone knows to look. Sent directly via AgentMail
 * (NOT through the dry-run-gated saga dispatcher) — these are internal alerts
 * that should always go out, regardless of HOWDY_OUTREACH_DRYRUN.
 */
import { sendFreshEmail } from "@/lib/agentmail/client";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

// Ops inbox(es) to alert. Override with a comma-separated HOWDY_NOTIFY_EMAIL.
const NOTIFY_LIST = (
  process.env.HOWDY_NOTIFY_EMAIL ||
  "amanpandit124421@gmail.com,tanashley37@gmail.com,limbernice@bridgecreativesagency.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
 * Fire a "1 new client / 1 new freelancer" alert for an inbound message.
 * Self-contained and never throws — a notification failure must never break
 * message processing. Deduped on gmail_message_id so a re-delivered webhook
 * doesn't double-notify.
 */
export async function maybeNotifyInbound(args: {
  messageId: string;
  fromEmail: string;
  subject?: string | null;
  body: string;
  // The message arrived on a thread we used to recruit a freelancer.
  isFreelancerThread: boolean;
}): Promise<void> {
  try {
    if (!isSupabaseConfigured()) return;
    const sb = getSupabaseAdmin();

    // Webhooks can be re-delivered — only alert for a message we haven't
    // already stored (this runs before the message is appended).
    if (args.messageId) {
      const { data: seen } = await sb
        .from("messages")
        .select("id")
        .eq("gmail_message_id", args.messageId)
        .maybeSingle();
      if (seen) return;
    }

    let senderType: "client" | "freelancer" = args.isFreelancerThread
      ? "freelancer"
      : "client";
    // A known freelancer emailing outside an outreach thread (e.g. a post-match
    // check-in reply) still counts as a freelancer.
    if (senderType === "client" && args.fromEmail) {
      const { data: f } = await sb
        .from("freelancers")
        .select("id")
        .ilike("email", args.fromEmail)
        .maybeSingle();
      if (f) senderType = "freelancer";
    }

    const preview = args.body.replace(/\s+/g, " ").trim();
    const clipped = preview.slice(0, 240);
    const subject = `🔔 1 new ${senderType} message on Howdy`;
    const text = [
      `Hey — we got 1 new ${senderType}!`,
      ``,
      `From: ${args.fromEmail}`,
      `Re: ${args.subject?.trim() || "(no subject)"}`,
      ``,
      clipped
        ? `"${clipped}${preview.length > 240 ? "…" : ""}"`
        : "(no preview)",
      ``,
      `— Howdy`,
    ].join("\n");

    await notifyOps({ subject, text });
  } catch (err) {
    console.error("[notify] inbound notification failed:", err);
  }
}
