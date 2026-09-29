/**
 * In-memory AgentMail. Records everything Howdy sends, and builds inbound
 * webhook payloads (the real `message.received` shape) for people replying.
 * Threading mirrors email: a reply stays on the thread of the message it
 * answers — unless `splitThreads` is on, which simulates a provider that
 * assigns a fresh thread id to replies (so routing can't rely on thread ids).
 */
export const HOWDY_INBOX = "howdyai@agentmail.to";

export type Sent = {
  kind: "send" | "reply";
  messageId: string;
  threadId: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  /** AgentMail labels: our code's sends carry "howdy-auto"; a person's don't. */
  labels: string[];
  at: number;
};

const AUTO = ["sent", "howdy-auto"];

type Known = {
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  /** The References chain a reply to this message would carry. */
  refs: string[];
};

export class FakeAgentMail {
  sent: Sent[] = [];
  splitThreads = false;
  private known = new Map<string, Known>();
  private n = 0;

  private id(prefix: string) {
    this.n += 1;
    return `${prefix}_${this.n}`;
  }

  async sendFreshEmail(args: {
    to: string;
    subject: string;
    text: string;
    cc?: string[];
  }) {
    const messageId = this.id("msg");
    const threadId = this.id("thd");
    const rec: Sent = {
      kind: "send",
      messageId,
      threadId,
      to: [args.to],
      cc: args.cc ?? [],
      subject: args.subject,
      text: args.text,
      inReplyTo: null,
      labels: AUTO,
      at: Date.now(),
    };
    this.sent.push(rec);
    this.known.set(messageId, {
      threadId,
      subject: args.subject,
      from: HOWDY_INBOX,
      to: rec.to,
      cc: rec.cc,
      refs: [messageId],
    });
    return { messageId, threadId };
  }

  async replyToMessage(args: { messageId: string; text: string }) {
    const orig = this.known.get(args.messageId);
    if (!orig) throw new Error(`fake agentmail: unknown message ${args.messageId}`);
    const messageId = this.id("msg");
    // Replying to our own message goes back to its recipients; replying to an
    // inbound message goes to its sender.
    const to = orig.from === HOWDY_INBOX ? orig.to : [orig.from];
    const cc =
      orig.from === HOWDY_INBOX
        ? orig.cc
        : [...orig.to, ...orig.cc].filter(
            (a) => a.toLowerCase() !== HOWDY_INBOX,
          );
    const subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
    const rec: Sent = {
      kind: "reply",
      messageId,
      threadId: orig.threadId,
      to,
      cc,
      subject,
      text: args.text,
      inReplyTo: args.messageId,
      labels: AUTO,
      at: Date.now(),
    };
    this.sent.push(rec);
    this.known.set(messageId, {
      threadId: orig.threadId,
      subject,
      from: HOWDY_INBOX,
      to,
      cc,
      refs: [...orig.refs, messageId],
    });
    return { messageId, threadId: orig.threadId };
  }

  /**
   * Build the webhook payload for a person emailing Howdy. Pass `replyTo` (a
   * Sent record) to reply within an existing conversation.
   */
  inbound(args: {
    from: string;
    text: string;
    subject?: string;
    replyTo?: Sent;
    to?: string[];
    cc?: string[];
    fromName?: string;
    extractedText?: string | null;
    html?: string;
    attachments?: Array<{ filename: string; inline?: boolean }>;
  }) {
    const messageId = this.id("in");
    const threadId =
      args.replyTo && !this.splitThreads ? args.replyTo.threadId : this.id("thd");
    const subject =
      args.subject ??
      (args.replyTo
        ? /^re:/i.test(args.replyTo.subject)
          ? args.replyTo.subject
          : `Re: ${args.replyTo.subject}`
        : "Hello");
    const to = args.to ?? [HOWDY_INBOX];
    const cc = args.cc ?? [];
    const parentRefs = args.replyTo ? (this.known.get(args.replyTo.messageId)?.refs ?? []) : [];
    this.known.set(messageId, {
      threadId,
      subject,
      from: args.from,
      to,
      cc,
      refs: [...parentRefs, messageId],
    });
    return {
      event_type: "message.received",
      event_id: `evt_${messageId}`,
      message: {
        from: args.fromName ? `${args.fromName} <${args.from}>` : args.from,
        to,
        cc,
        inbox_id: HOWDY_INBOX,
        thread_id: threadId,
        message_id: messageId,
        subject,
        ...(args.replyTo
          ? { in_reply_to: args.replyTo.messageId, references: parentRefs }
          : {}),
        text: args.text,
        extracted_text: args.extractedText === undefined ? args.text : args.extractedText,
        ...(args.html ? { html: args.html } : {}),
        ...(args.attachments ? { attachments: args.attachments } : {}),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /** Someone on the team replies by hand (Momo / AgentMail console) on a thread. */
  humanReply(args: { threadId: string; to: string; text: string; subject?: string }) {
    this.sent.push({
      kind: "reply",
      messageId: this.id("msg"),
      threadId: args.threadId,
      to: [args.to],
      cc: [],
      subject: args.subject ?? "Re: (manual)",
      text: args.text,
      inReplyTo: null,
      labels: ["sent"],
      at: Date.now(),
    });
  }

  async threadHasHumanReply(threadId: string, since: Date): Promise<boolean> {
    return this.sent.some(
      (s) => s.threadId === threadId && !s.labels.includes("howdy-auto") && s.at >= since.getTime(),
    );
  }

  /** Everything sent to (or cc'd to) an address, oldest first. */
  to(email: string): Sent[] {
    const e = email.toLowerCase();
    return this.sent.filter(
      (s) => s.to.some((t) => t.toLowerCase() === e) || s.cc.some((c) => c.toLowerCase() === e),
    );
  }

  last(email: string): Sent | undefined {
    const list = this.to(email);
    return list[list.length - 1];
  }

  reset() {
    this.sent = [];
    this.splitThreads = false;
    this.known.clear();
    this.n = 0;
  }
}

export const fakeMail = new FakeAgentMail();
