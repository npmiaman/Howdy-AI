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
  return [
    `Hey ${firstName},`,
    "",
    "So what are you hiring for? Drop a few lines about the role, the project, and your timeline, and I'll come back with someone vetted by tomorrow.",
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
