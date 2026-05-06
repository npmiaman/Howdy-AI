import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";

import { getSupabaseAdmin } from "@/lib/supabase/client";

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
  if (existing) return existing as ThreadRow;

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
  if (insErr) throw insErr;
  return created as ThreadRow;
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
  const { error } = await supabase.from("messages").insert({
    thread_id: args.threadId,
    role: args.role,
    content: args.content,
    gmail_message_id: args.gmailMessageId ?? null,
  });
  if (error) throw error;
}

export async function saveBrief(threadId: string, brief: Brief): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("threads")
    .update({ brief, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw error;
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
