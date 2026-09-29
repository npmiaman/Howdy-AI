/**
 * Website chat → email handoff. Once the brief is ready and the visitor gives
 * a name + email, Howdy emails them the brief, moves the chat onto that email
 * thread (so the email agent picks up with full context), and schedules the
 * match saga — the same pipeline an emailed brief goes through.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { isAgentMailConfigured, sendFreshEmail } from "@/lib/agentmail/client";
import { requestMeta, upsertLead } from "@/lib/howdy/leads";
import { saveMemories } from "@/lib/howdy/memories";
import { notifyOps } from "@/lib/howdy/notify";
import { schedulePendingMatch } from "@/lib/howdy/scheduler";
import {
  appendMessage,
  appendMessageDeduped,
  findOrCreateEmailThread,
  loadMessages,
  saveBrief,
  type ThreadRow,
} from "@/lib/howdy/threads";
import { type Brief, PROMISE_HOURS } from "@/lib/howdy/types";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import { errorMessage, firstName as firstNameOf } from "@/lib/utils";

import { withRetry } from "./retry";

/** The thread every chat turn for a session is cached on. */
export function webThreadKey(sessionKey: string): string {
  return `web:${sessionKey}`;
}

const NameSchema = z.string().trim().min(1).max(120);
const EmailSchema = z.string().trim().email().max(200);

const ALREADY_SENT_REPLY = `You're all set — your brief is already in your inbox, and your shortlist lands in that thread within ${PROMISE_HOURS} hours.`;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Dated, so a returning client's new brief starts its own conversation: email
 * threads are resolved by sender + subject, and an undated subject would land
 * a second video-editor brief on the first one's thread.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function handoffSubject(brief: Brief, now = new Date()): string {
  const date = `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]}`;
  return `Your Howdy brief: ${brief.role ?? "your project"} (${date})`;
}

function clip(s: string, max = 220): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** One bullet per field the visitor actually gave us. */
function briefBullets(brief: Brief): string[] {
  const list = (v: string[] | null | undefined) => (v?.length ? v.join(", ") : null);
  const rows: Array<[string, string | null | undefined]> = [
    ["Role", brief.role],
    ["Project", brief.description ? clip(brief.description) : null],
    ["Deadline", brief.deadline],
    [
      "Budget",
      brief.budget_usd_per_hour_max != null
        ? `up to $${brief.budget_usd_per_hour_max}/hr`
        : null,
    ],
    ["Level", brief.experience_level],
    ["Industry", brief.domain],
    ["Tools", list(brief.stack_or_tools)],
    ["References", list(brief.references)],
    ["Must-haves", list(brief.must_haves)],
    ["Avoid", list(brief.red_flags)],
    ["Working style", brief.collaboration_style],
    ["Timezone", brief.timezone_preference],
  ];
  return rows
    .filter((r): r is [string, string] => !!r[1]?.trim())
    .map(([label, value]) => `- ${label}: ${value}`);
}

export function handoffEmail(firstName: string, brief: Brief): string {
  return [
    `Hey ${firstName},`,
    "",
    "Great chatting. Here's the brief I'm running with:",
    "",
    ...briefBullets(brief),
    "",
    `I'm on it — your shortlist lands in this thread within ${PROMISE_HOURS} hours. Reply here anytime to add details.`,
    "",
    "Howdy",
  ].join("\n");
}

async function findWebThread(sessionKey: string): Promise<ThreadRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("threads")
    .select("*")
    .eq("gmail_thread_id", webThreadKey(sessionKey))
    .maybeSingle();
  if (error) throw error;
  return (data as ThreadRow | null) ?? null;
}

/**
 * Idempotency guard: atomically flip the web thread's last_processed_at from
 * null. Postgres row locking means exactly one request per session wins, so a
 * double-submit or retry can't send a second email or schedule a second match.
 * Not retried — a retry after a committed claim would read as "already done".
 */
async function claimHandoff(webThreadId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("threads")
    .update({ last_processed_at: now, updated_at: now })
    .eq("id", webThreadId)
    .is("last_processed_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Undo the claim when nothing went out, so the visitor can simply retry. */
async function releaseHandoff(webThreadId: string): Promise<void> {
  try {
    await withRetry(async () => {
      const { error } = await getSupabaseAdmin()
        .from("threads")
        .update({ last_processed_at: null })
        .eq("id", webThreadId);
      if (error) throw error;
    }, "releaseHandoff");
  } catch {
    console.error("[howdy/chat] handoff claim stuck — visitor can't retry", {
      webThreadId,
    });
  }
}

/**
 * Everything after the handoff email is out. Each step is isolated so one
 * failure can't block the rest (above all, scheduling the match), and any
 * failure alerts ops — by now the visitor has been promised a shortlist.
 */
async function persistHandoff(args: {
  webThreadId: string;
  name: string;
  email: string;
  subject: string;
  text: string;
  brief: Brief;
  sent: { messageId: string; threadId: string };
}): Promise<void> {
  const problems: string[] = [];

  let threadId: string | null = null;
  try {
    const thread = await withRetry(
      () =>
        findOrCreateEmailThread({
          gmailThreadId: args.sent.threadId,
          userEmail: args.email,
          subject: args.subject,
        }),
      "findOrCreateEmailThread",
    );
    threadId = thread.id;
  } catch (e) {
    problems.push(`email thread: ${errorMessage(e)}`);
  }

  if (threadId) {
    // Copy the chat onto the email thread, then the handoff email itself.
    try {
      const transcript = await withRetry(
        () => loadMessages(args.webThreadId),
        "loadTranscript",
      );
      for (const m of transcript) {
        const content =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        // Placeholder rows from failed agent turns aren't conversation.
        if (content.startsWith("[agent error")) continue;
        await appendMessage({
          threadId,
          role: m.getType() === "human" ? "human" : "ai",
          content,
        });
      }
      await appendMessage({
        threadId,
        role: "ai",
        content: args.text,
        gmailMessageId: args.sent.messageId,
      });
      await withRetry(() => saveBrief(threadId!, args.brief), "saveBrief");
    } catch (e) {
      problems.push(`transcript/brief: ${errorMessage(e)}`);
    }

    try {
      // Once, never retried: a retry after a committed insert would schedule
      // a second match.
      await schedulePendingMatch({
        threadId,
        userEmail: args.email,
        subject: args.subject,
        brief: args.brief,
      });
    } catch (e) {
      problems.push(`schedule match: ${errorMessage(e)}`);
    }
  } else {
    problems.push("schedule match: skipped (no email thread)");
  }

  await saveMemories({
    userEmail: args.email,
    facts: [
      `Name: ${args.name}.`,
      `Sent a brief via the website chat on ${new Date().toISOString().slice(0, 10)}.`,
    ],
  });

  if (problems.length) {
    console.error("[howdy/chat] HANDOFF INCOMPLETE", {
      email: args.email,
      webThreadId: args.webThreadId,
      problems,
    });
    await notifyOps({
      subject: `Web chat handoff incomplete: ${args.email}`,
      text: [
        `The handoff email reached ${args.email}, but these steps failed:`,
        ...problems.map((p) => `- ${p}`),
        "",
        `Web thread: ${args.webThreadId}`,
        `Email thread: ${threadId ?? "(none)"}`,
        "",
        `Brief:\n${JSON.stringify(args.brief, null, 2)}`,
        "",
        "— Howdy",
      ].join("\n"),
    });
  }
}

export async function handOffToEmail(args: {
  request: Request;
  sessionKey: string;
  contact: { name: string; email: string };
}): Promise<NextResponse> {
  const name = NameSchema.safeParse(args.contact.name);
  if (!name.success) {
    return fail(400, "What should I call you? Add your name and I'll send it over.");
  }
  const email = EmailSchema.safeParse(args.contact.email);
  if (!email.success) {
    return fail(400, "That email doesn't look quite right — mind double-checking it?");
  }

  if (!isSupabaseConfigured() || !isAgentMailConfigured()) {
    console.error("[howdy/chat] handoff unavailable — Supabase or AgentMail not configured");
    return fail(503, "I can't send email right this second. Try again in a few minutes?");
  }

  let web: ThreadRow;
  let claimed: boolean;
  try {
    const found = await withRetry(() => findWebThread(args.sessionKey), "findWebThread");
    // Nothing to hand off without a brief (e.g. a contact post on turn one).
    if (!found || !(found.brief?.role || found.brief?.description)) {
      return fail(409, "Tell me a bit about what you need first — then I'll grab your email.");
    }
    web = found;
    claimed = await claimHandoff(web.id);
  } catch (e) {
    console.error("[howdy/chat] handoff lookup/claim failed:", errorMessage(e));
    return fail(503, "I hit a snag saving that. Mind trying again?");
  }
  if (!claimed) {
    return NextResponse.json({ reply: ALREADY_SENT_REPLY, done: true });
  }

  const brief = web.brief;
  const firstName = firstNameOf(name.data);
  const subject = handoffSubject(brief);
  const text = handoffEmail(firstName, brief);

  await upsertLead({
    fullName: name.data,
    company: "",
    position: "",
    email: email.data,
    ...requestMeta(args.request),
    source: "web-chat",
  });

  let sent: { messageId: string; threadId: string };
  try {
    sent = await sendFreshEmail({ to: email.data, subject, text });
  } catch (e) {
    console.error("[howdy/chat] handoff email failed:", errorMessage(e));
    await releaseHandoff(web.id);
    return fail(502, "I couldn't send the email just now — mind hitting send again?");
  }

  // The email is out, so the claim is never released past this point.
  await persistHandoff({
    webThreadId: web.id,
    name: name.data,
    email: email.data,
    subject,
    text,
    brief,
    sent,
  });

  const reply = `You're all set, ${firstName}! I just emailed your brief to ${email.data} — check your inbox. Your shortlist lands in that thread within ${PROMISE_HOURS} hours.`;
  try {
    await withRetry(
      () => appendMessageDeduped({ threadId: web.id, role: "ai", content: reply }),
      "appendHandoffReply",
    );
  } catch {
    /* already logged in withRetry; the handoff itself succeeded */
  }
  return NextResponse.json({ reply, done: true });
}
