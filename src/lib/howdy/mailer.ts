/**
 * Single choke point for all of Howdy's saga email (outreach, shortlists,
 * intros, check-ins, and every reply that talks about a request's progress).
 * Honours HOWDY_OUTREACH_DRYRUN (default ON): in dry-run, intended emails are
 * logged and given synthetic ids, never actually sent — except to addresses on
 * HOWDY_DRYRUN_ALLOWLIST, so the team can run the real flow on themselves
 * without emailing real freelancers or clients. See DECISIONS.md.
 */
import { replyToMessage, sendFreshEmail } from "@/lib/agentmail/client";
import { envList } from "@/lib/utils";

import { appendMessage } from "./threads";

export function isDryRun(): boolean {
  // Default ON — real email only when explicitly set to "false".
  return process.env.HOWDY_OUTREACH_DRYRUN !== "false";
}

function allowlist(): Set<string> {
  return new Set(envList(process.env.HOWDY_DRYRUN_ALLOWLIST));
}

/** Would an email to these recipients really go out right now? */
export function wouldSend(recipients: string[]): boolean {
  if (!isDryRun()) return true;
  const allowed = allowlist();
  return (
    recipients.length > 0 &&
    recipients.every((r) => allowed.has(r.trim().toLowerCase()))
  );
}

export type SendResult = {
  messageId: string;
  threadId: string;
  /** False when dry-run swallowed it (logged only). */
  delivered: boolean;
};

export async function dispatch(args: {
  kind: string; // for logs: "freelancer_invite", "checkin_company", etc.
  to: string;
  subject: string;
  text: string;
  replyToMessageId?: string | null;
  cc?: string[];
  /** Record the email on this conversation once it has really gone out. */
  threadId?: string | null;
}): Promise<SendResult> {
  if (!wouldSend([args.to, ...(args.cc ?? [])])) {
    const id = `dry_${Math.random().toString(36).slice(2, 10)}`;
    console.log(
      `[saga:DRYRUN] ${args.kind} → ${args.to}${args.cc?.length ? ` (cc ${args.cc.join(", ")})` : ""}\n  subject: ${args.subject}\n  ${args.text.replace(/\n/g, "\n  ")}`,
    );
    return { messageId: `${id}_msg`, threadId: `${id}_thread`, delivered: false };
  }
  const sent = args.replyToMessageId
    ? await replyToMessage({ messageId: args.replyToMessageId, text: args.text })
    : await sendFreshEmail({
        to: args.to,
        subject: args.subject,
        text: args.text,
        cc: args.cc,
      });
  if (args.threadId)
    await appendMessage({
      threadId: args.threadId,
      role: "ai",
      content: args.text,
      gmailMessageId: sent.messageId,
    });
  return { ...sent, delivered: true };
}
