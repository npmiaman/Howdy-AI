import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isAgentMailConfigured,
  replyToMessage,
  sendFreshEmail,
} from "@/lib/agentmail/client";
import { saveMemories } from "@/lib/howdy/memories";
import {
  appendMessage,
  findMostRecentThreadByEmail,
  findOrCreateEmailThread,
  getLatestGmailMessageId,
} from "@/lib/howdy/threads";
import { composeWelcomeBack } from "@/lib/howdy/welcome";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 30;

const LeadSchema = z.object({
  fullName: z.string().min(1).max(120),
  company: z.string().max(120).optional().default(""),
  position: z.string().max(120).optional().default(""),
  email: z.string().email().max(200),
});

function welcomeBody(args: {
  fullName: string;
  company: string;
  position: string;
}) {
  const firstName = args.fullName.split(" ")[0] ?? args.fullName;
  return [
    `Hey ${firstName},`,
    "",
    "I'm Howdy. From now on, I'll be your personal talent scout. Just reply to this email with who you need to hire, and I'll take it from there.",
    "",
    "Howdy",
  ].join("\n");
}

async function upsertLead(args: {
  fullName: string;
  company: string;
  position: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ leadId: string | null; isReturning: boolean }> {
  if (!isSupabaseConfigured()) return { leadId: null, isReturning: false };
  const supabase = getSupabaseAdmin();
  try {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", args.email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Returning user — refresh the row in-place. created_at stays original.
      const { error: updateErr } = await supabase
        .from("leads")
        .update({
          full_name: args.fullName,
          company: args.company || null,
          position: args.position || null,
          source: "hire-form-returning",
          ip_address: args.ip,
          user_agent: args.userAgent,
        })
        .eq("id", existing.id);
      if (updateErr) {
        console.warn("[/api/lead] lead update failed:", updateErr.message);
      }
      return { leadId: existing.id as string, isReturning: true };
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("leads")
      .insert({
        full_name: args.fullName,
        company: args.company || null,
        position: args.position || null,
        email: args.email,
        source: "hire-form",
        ip_address: args.ip,
        user_agent: args.userAgent,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.warn("[/api/lead] lead insert failed:", insertErr.message);
      return { leadId: null, isReturning: false };
    }
    return {
      leadId: (inserted?.id as string | undefined) ?? null,
      isReturning: false,
    };
  } catch (err) {
    console.warn("[/api/lead] upsertLead threw:", err);
    return { leadId: null, isReturning: false };
  }
}

async function hasDeliveredMatch(threadId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from("pending_matches")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .not("processed_at", "is", null);
  return (count ?? 0) > 0;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = LeadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_input", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { fullName, company, position, email } = parsed.data;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent") ?? null;

  const { leadId, isReturning } = await upsertLead({
    fullName,
    company,
    position,
    email,
    ip,
    userAgent,
  });

  if (!isAgentMailConfigured()) {
    return NextResponse.json(
      {
        ok: true,
        leadId,
        isReturning,
        warning:
          "Lead saved, but AGENTMAIL_API_KEY isn't set so the email didn't go out.",
      },
      { status: 200 },
    );
  }

  // If they already have a thread on file, resume it instead of sending a
  // fresh welcome template.
  const existingThread = isSupabaseConfigured()
    ? await findMostRecentThreadByEmail(email).catch((e) => {
        console.warn("[/api/lead] thread lookup failed:", e);
        return null;
      })
    : null;

  if (existingThread) {
    try {
      const hadMatch = await hasDeliveredMatch(existingThread.id);
      const body = await composeWelcomeBack({
        fullName,
        threadId: existingThread.id,
        userEmail: email,
        brief: existingThread.brief,
        hadMatch,
      });

      const replyTo = await getLatestGmailMessageId(existingThread.id);
      const subject =
        existingThread.subject ?? `Welcome back, ${fullName.split(" ")[0]}`;
      const sent = replyTo
        ? await replyToMessage({ messageId: replyTo, text: body })
        : await sendFreshEmail({ to: email, subject, text: body });

      await appendMessage({
        threadId: existingThread.id,
        role: "ai",
        content: body,
        gmailMessageId: sent.messageId,
      });

      // Refresh long-term memory with whatever the form told us this time.
      const facts: string[] = [`Name: ${fullName}.`];
      if (company) facts.push(`Company: ${company}.`);
      if (position) facts.push(`Position: ${position}.`);
      facts.push(`Re-registered via hire form on ${new Date().toISOString().slice(0, 10)}.`);
      await saveMemories({ userEmail: email, facts });

      return NextResponse.json({
        ok: true,
        leadId,
        isReturning: true,
        resumed: true,
        threadId: existingThread.id,
        messageId: sent.messageId,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[/api/lead] resume flow failed:", detail);
      // Fall through to fresh-welcome below as a last resort so the user
      // never silently gets nothing.
    }
  }

  // First-time user (or resume failed) — original welcome flow.
  try {
    const subject = `Welcome to Howdy, ${fullName.split(" ")[0]}`;
    const body = welcomeBody({ fullName, company, position });
    const sent = await sendFreshEmail({ to: email, subject, text: body });

    if (isSupabaseConfigured() && sent.threadId) {
      try {
        const thread = await findOrCreateEmailThread({
          gmailThreadId: sent.threadId,
          userEmail: email,
          subject,
        });
        await appendMessage({
          threadId: thread.id,
          role: "ai",
          content: body,
          gmailMessageId: sent.messageId,
        });
        const facts: string[] = [`Name: ${fullName}.`];
        if (company) facts.push(`Company: ${company}.`);
        if (position) facts.push(`Position: ${position}.`);
        await saveMemories({ userEmail: email, facts });
      } catch (persistErr) {
        console.warn(
          "[/api/lead] thread/memory persistence failed:",
          persistErr,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      leadId,
      isReturning,
      resumed: false,
      messageId: sent.messageId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[/api/lead] AgentMail send failed:", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }
}
