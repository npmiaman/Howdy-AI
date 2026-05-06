import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isAgentMailConfigured,
  sendFreshEmail,
} from "@/lib/agentmail/client";

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
  const opening = args.company
    ? `Hey ${firstName}, glad you're hiring from ${args.company}.`
    : `Hey ${firstName}, welcome aboard.`;

  return [
    opening,
    "",
    "I'm Howdy, your AI freelance talent scout. I find vetted designers, developers, editors, motion artists, and other specialists, and I deliver one match per brief. No job boards. No 200-applicant inbox. No bidding wars.",
    "",
    "Here's how it works:",
    "",
    "1. Reply to this email and tell me what you're hiring for.",
    "2. I'll ask a few clarifying questions to nail the brief.",
    "3. Within 24 hours, you'll get one vetted match with their reel, rate, and availability.",
    "",
    "To get the sharpest match, try to include:",
    "",
    "  • The role (designer, developer, editor, writer, anything)",
    "  • A bit about the project itself",
    "  • Your timeline",
    "  • A rough budget",
    "  • Style references or examples you admire",
    "",
    "I'll handle the rest.",
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

  if (!isAgentMailConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AGENTMAIL_API_KEY is not set on the server, so the welcome email can't go out.",
      },
      { status: 503 },
    );
  }

  try {
    const subject = `Welcome to Howdy, ${fullName.split(" ")[0]}`;
    const body = welcomeBody({ fullName, company, position });
    const sent = await sendFreshEmail({ to: email, subject, text: body });
    return NextResponse.json({ ok: true, messageId: sent.messageId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[/api/lead] AgentMail send failed:", detail);
    return NextResponse.json(
      { ok: false, error: detail },
      { status: 502 },
    );
  }
}
