import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";

import { getSupabaseAdmin } from "@/lib/supabase/client";

import { mirrorBrief, mirrorMessage, mirrorThread } from "./mirror";
import { type Brief, EMPTY_BRIEF } from "./types";

export type ThreadRow = {
  id: string;
  gmail_thread_id: string | null;
  user_email: string;
  subject: string | null;
  brief: Brief;
  last_processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  role: "human" | "ai";
  content: string;
  gmail_message_id: string | null;
  created_at: string;
};

export async function findOrCreateThread(args: {
  gmailThreadId: string;
  userEmail: string;
  subject?: string;
}): Promise<ThreadRow> {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: selErr } = await supabase
    .from("threads")
    .select("*")
    .eq("gmail_thread_id", args.gmailThreadId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    // Mirror on access too, so pre-existing threads get backfilled.
    await mirrorThread(existing as ThreadRow);
    return existing as ThreadRow;
  }

  const { data: created, error: insErr } = await supabase
    .from("threads")
    .insert({
      gmail_thread_id: args.gmailThreadId,
      user_email: args.userEmail,
      subject: args.subject ?? null,
      brief: EMPTY_BRIEF,
    })
    .select()
    .single();
  if (insErr) {
    // Concurrent first-turn requests can race to create the same thread. The
    // loser hits a unique-violation (23505) — re-select the winner's row
    // instead of failing, so neither visitor's message is lost.
    if ((insErr as { code?: string }).code === "23505") {
      const { data: raced } = await supabase
        .from("threads")
        .select("*")
        .eq("gmail_thread_id", args.gmailThreadId)
        .maybeSingle();
      if (raced) {
        await mirrorThread(raced as ThreadRow);
        return raced as ThreadRow;
      }
    }
    throw insErr;
  }
  await mirrorThread(created as ThreadRow);
  return created as ThreadRow;
}

/** Strip leading Re:/Fwd:/Fw: (possibly repeated) and normalize for matching. */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .replace(/^((re|fwd?|fw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Resolve an EMAIL conversation by (sender + normalized subject) instead of the
 * AgentMail thread id — which changes on every send/reply and fragments one
 * conversation into many threads. This keeps a person's welcome + all their
 * replies on a single thread. Falls back to the thread-id path / creation.
 */
export async function findOrCreateEmailThread(args: {
  gmailThreadId: string;
  userEmail: string;
  subject?: string;
}): Promise<ThreadRow> {
  const supabase = getSupabaseAdmin();
  const base = normalizeSubject(args.subject);
  if (base && args.userEmail) {
    // Earliest matching thread for this sender + subject = the canonical one.
    const { data: rows } = await supabase
      .from("threads")
      .select("*")
      .ilike("user_email", args.userEmail)
      .order("created_at", { ascending: true })
      .limit(50);
    const match = (rows ?? []).find(
      (r) => normalizeSubject((r as ThreadRow).subject) === base,
    );
    if (match) {
      await mirrorThread(match as ThreadRow);
      return match as ThreadRow;
    }
  }
  // No existing conversation — fall back to the thread-id path (creates one).
  return findOrCreateThread(args);
}

/**
 * Append a message unless the thread's most recent message is byte-identical
 * (same role + content) — which means this is a duplicate from a client retry.
 * Returns true if a row was written, false if it was a deduped no-op.
 */
export async function appendMessageDeduped(args: {
  threadId: string;
  role: "human" | "ai";
  content: string;
}): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("messages")
    .select("role, content")
    .eq("thread_id", args.threadId)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = data?.[0] as { role: string; content: string } | undefined;
  if (last && last.role === args.role && last.content === args.content) {
    return false;
  }
  await appendMessage(args);
  return true;
}

export async function loadMessages(threadId: string): Promise<BaseMessage[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: MessageRow) =>
    row.role === "human" ? new HumanMessage(row.content) : new AIMessage(row.content),
  );
}

export async function appendMessage(args: {
  threadId: string;
  role: "human" | "ai";
  content: string;
  gmailMessageId?: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      thread_id: args.threadId,
      role: args.role,
      content: args.content,
      gmail_message_id: args.gmailMessageId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  // Mirror to our own DB with the SAME id so the two stores line up 1:1.
  const row = data as MessageRow;
  await mirrorMessage({
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    gmail_message_id: row.gmail_message_id,
    created_at: row.created_at,
  });
}

export async function saveBrief(threadId: string, brief: Brief): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("threads")
    .update({ brief, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw error;
  await mirrorBrief(threadId, brief);
}

export async function markThreadProcessed(threadId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("threads")
    .update({
      last_processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", threadId);
  if (error) throw error;
}

/**
 * Find the most-recently-updated thread for a given user email, if any.
 * Used by the lead intake to detect returning users.
 */
export async function findMostRecentThreadByEmail(
  userEmail: string,
): Promise<ThreadRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("threads")
    .select("*")
    .eq("user_email", userEmail)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ThreadRow | null) ?? null;
}

/**
 * Find the latest message in a thread that has a Gmail message id we can
 * reply to. Prefers the most recent message regardless of role — replying to
 * Howdy's own outbound message still chains the email correctly.
 */
export async function getLatestGmailMessageId(
  threadId: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("messages")
    .select("gmail_message_id, created_at")
    .eq("thread_id", threadId)
    .not("gmail_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { gmail_message_id: string | null } | null)
    ?.gmail_message_id ?? null;
}
