import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isAgentMailConfigured,
  sendFreshEmail,
} from "@/lib/agentmail/client";
import { saveMemories } from "@/lib/howdy/memories";
import {
  appendMessage,
  findOrCreateThread,
} from "@/lib/howdy/threads";
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

  // Capture the lead first, even if downstream email fails.
  let leadId: string | null = null;
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdmin();
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const userAgent = request.headers.get("user-agent") ?? null;
      const { data, error } = await supabase
        .from("leads")
        .insert({
          full_name: fullName,
          company: company || null,
          position: position || null,
          email,
          source: "hire-form",
          ip_address: ip,
          user_agent: userAgent,
        })
        .select("id")
        .single();
      if (error) {
        console.warn("[/api/lead] lead insert failed:", error.message);
      } else {
        leadId = data?.id ?? null;
      }
    } catch (err) {
      console.warn("[/api/lead] lead insert threw:", err);
    }
  }

  if (!isAgentMailConfigured()) {
    return NextResponse.json(
      {
        ok: true,
        leadCaptured: !!leadId,
        warning:
          "Lead saved, but AGENTMAIL_API_KEY isn't set so the welcome email didn't go out.",
      },
      { status: 200 },
    );
  }

  try {
    const subject = `Welcome to Howdy, ${fullName.split(" ")[0]}`;
    const body = welcomeBody({ fullName, company, position });
    const sent = await sendFreshEmail({ to: email, subject, text: body });

    // Register the thread + welcome message in Supabase so when they reply,
    // the webhook continues the existing conversation instead of starting fresh.
    if (isSupabaseConfigured() && sent.threadId) {
      try {
        const thread = await findOrCreateThread({
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
        // Seed long-term memory: who is this person, where do they work.
        const facts: string[] = [`Name: ${fullName}.`];
        if (company) facts.push(`Company: ${company}.`);
        if (position) facts.push(`Position: ${position}.`);
        await saveMemories({ userEmail: email, facts });
      } catch (persistErr) {
        // Don't fail the user-facing request if logging falls over.
        console.warn(
          "[/api/lead] thread/memory persistence failed:",
          persistErr,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      leadId,
      messageId: sent.messageId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[/api/lead] AgentMail send failed:", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 502 });
  }
}
