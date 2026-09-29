/**
 * First look at every inbound email, before any routing or LLM work. Decides
 * whether Howdy should engage at all. The failures this exists for are real:
 * Howdy auto-replied (asking for a budget, twice) on an agency thread it was
 * only CC'd on, and fed attachment-only emails to the agent as empty text.
 */
import type { AgentMailIncomingMessage } from "@/lib/agentmail/client";
import { envList } from "@/lib/utils";

export type InboundVerdict =
  | "process"
  | "ignored_automated" // bounces, auto-replies, no-reply senders
  | "ignored_self" // our own outbound echoing back
  | "team_sender" // the Bridge Creatives team — never answer them as a client
  | "cc_only" // Howdy is CC'd on someone else's conversation
  | "empty_body"; // nothing readable (e.g. attachments only)

const AUTOMATED_SENDER =
  /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?)@/i;
const AUTOMATED_SUBJECT =
  /^(delivery status notification|undeliver(able|ed)|mail delivery (failed|subsystem)|returned mail|auto(matic)?[- ]?reply|out of (the )?office)/i;

/**
 * Every address that means "this email is to Howdy". (Deliberately not the
 * legacy HOWDY_INBOX_EMAIL from the removed Gmail integration — a stale value
 * there would make Howdy ignore a real person's mail as its own.)
 */
export function howdyAddresses(): string[] {
  return [...envList(process.env.AGENTMAIL_INBOX_ID), "howdyai@agentmail.to"].filter(
    (a) => a.includes("@"),
  );
}

export function isTeamSender(email: string): boolean {
  const e = email.toLowerCase();
  const domains = envList(
    process.env.HOWDY_TEAM_DOMAINS,
    "bridgecreativesagency.com,bridgecreatives.co",
  );
  const emails = envList(process.env.HOWDY_TEAM_EMAILS);
  return emails.includes(e) || domains.some((d) => e.endsWith(`@${d}`));
}

export function classifyInbound(email: AgentMailIncomingMessage): InboundVerdict {
  const from = email.fromEmail.toLowerCase();
  const howdy = howdyAddresses();
  if (howdy.includes(from)) return "ignored_self";
  if (AUTOMATED_SENDER.test(from) || AUTOMATED_SUBJECT.test(email.subject.trim()))
    return "ignored_automated";
  if (isTeamSender(from)) return "team_sender";
  // Only engage when Howdy is a direct recipient. (An empty To list means the
  // payload didn't say — don't block on missing data.)
  if (email.to.length > 0 && !email.to.some((a) => howdy.includes(a)))
    return "cc_only";
  if (!email.body.trim()) return "empty_body";
  return "process";
}

/** The subject our "Request an Invite" mailto uses, and close variants. */
export function isJoinRequest(subject: string): boolean {
  return /\b(request to )?join\b.*\broster\b/i.test(subject);
}
