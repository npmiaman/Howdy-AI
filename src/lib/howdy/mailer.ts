/**
 * Single choke point for all of Howdy's saga email (outreach + post-match).
 * Honours HOWDY_OUTREACH_DRYRUN (default ON): in dry-run, intended emails are
 * logged and given synthetic ids, never actually sent. See DECISIONS.md.
 */
import { replyToMessage, sendFreshEmail } from "@/lib/agentmail/client";

export function isDryRun(): boolean {
  // Default ON — real email only when explicitly set to "false".
  return process.env.HOWDY_OUTREACH_DRYRUN !== "false";
}

export type SendResult = { messageId: string; threadId: string };

export async function dispatch(args: {
  kind: string; // for logs: "freelancer_invite", "checkin_company", etc.
  to: string;
  subject: string;
  text: string;
  replyToMessageId?: string | null;
  cc?: string[];
}): Promise<SendResult> {
  if (isDryRun()) {
    const id = `dry_${Math.random().toString(36).slice(2, 10)}`;
    console.log(
      `[saga:DRYRUN] ${args.kind} → ${args.to}${args.cc?.length ? ` (cc ${args.cc.join(", ")})` : ""}\n  subject: ${args.subject}\n  ${args.text.replace(/\n/g, "\n  ")}`,
    );
    return { messageId: `${id}_msg`, threadId: `${id}_thread` };
  }
  if (args.replyToMessageId) {
    return replyToMessage({ messageId: args.replyToMessageId, text: args.text });
  }
  return sendFreshEmail({
    to: args.to,
    subject: args.subject,
    text: args.text,
    cc: args.cc,
  });
}
