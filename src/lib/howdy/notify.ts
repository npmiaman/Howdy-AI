/**
 * Ops notifications. When a new message lands from a client or a freelancer,
 * ping a human inbox so someone knows to look. Sent directly via AgentMail
 * (NOT through the dry-run-gated saga dispatcher) — these are internal alerts
 * that should always go out, regardless of HOWDY_OUTREACH_DRYRUN.
 */
import { sendFreshEmail } from "@/lib/agentmail/client";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

const NOTIFY_TO = process.env.HOWDY_NOTIFY_EMAIL || "amanpandit124421@gmail.com";

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

    await sendFreshEmail({ to: NOTIFY_TO, subject, text });
  } catch (err) {
    console.error("[notify] inbound notification failed:", err);
  }
}
