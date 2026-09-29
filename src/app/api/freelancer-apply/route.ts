import { NextResponse } from "next/server";
import { z } from "zod";

import { sendFreshEmail } from "@/lib/agentmail/client";
import { type RecordResult, recordApplication } from "@/lib/howdy/applications";
import { notifyOps } from "@/lib/howdy/notify";
import { errorMessage, firstName } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 30;

function blankToUndefined(v: unknown): unknown {
  return v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;
}

/** Single-line text: collapse whitespace so names can't smuggle newlines. */
function oneLine(max: number, required?: string) {
  const inner = z.string().max(max);
  return z
    .string(required ? { error: required } : undefined)
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(required ? inner.min(1, required) : inner);
}

function normalizeUrl(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  // People paste "behance.net/maya" — assume https rather than bounce them.
  return s && !/^[a-z][a-z0-9+.-]*:/i.test(s) ? `https://${s}` : s;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function toRate(v: unknown): unknown {
  const b = blankToUndefined(v);
  return typeof b === "string" ? Number(b.replace(/[$,\s]/g, "")) : b;
}

/** "Figma, Webflow" or ["Figma", "Webflow"] → ["Figma", "Webflow"]. */
function toSkills(v: unknown): unknown {
  const b = blankToUndefined(v);
  const parts = typeof b === "string" ? b.split(",") : b;
  if (!Array.isArray(parts)) return parts;
  const cleaned = parts
    .map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : p))
    .filter((p) => p !== "");
  return [...new Set(cleaned)];
}

const PORTFOLIO_ERROR = "Add a link to your work (http or https)";

const ApplySchema = z.object({
  fullName: oneLine(120, "Tell us your name"),
  email: z.string().trim().email("Enter a valid email").max(200),
  role: oneLine(120, "Tell us what you do"),
  portfolioUrl: z.preprocess(
    normalizeUrl,
    z.string({ error: PORTFOLIO_ERROR }).max(500).refine(isHttpUrl, PORTFOLIO_ERROR),
  ),
  rateUsdPerHour: z.preprocess(
    toRate,
    z
      .number({ error: "Rate should be a number" })
      .positive("Rate should be more than 0")
      .max(10_000)
      .optional(),
  ),
  timezone: z.preprocess(blankToUndefined, oneLine(80).optional()),
  skills: z.preprocess(toSkills, z.array(z.string().max(60)).max(30).optional()),
  bio: z.preprocess(blankToUndefined, z.string().trim().max(600).optional()),
});

type Application = z.infer<typeof ApplySchema>;

function confirmationBody(firstName: string): string {
  return [
    `Hey ${firstName},`,
    "",
    "Thanks for applying to the Howdy roster. Your application is in.",
    "",
    "A real person on our team looks at every single one. We keep the roster small on purpose, so we can't say yes to everyone, but if your work fits the briefs coming through, we'll email you to set up a quick chat.",
    "",
    "No need to reply here. If you want to change anything, just submit the form again with the same email and it'll update your application.",
    "",
    "Howdy",
  ].join("\n");
}

function opsAlert(
  app: Application,
  record: RecordResult,
  confirmation: string,
): { subject: string; text: string } {
  const who = `${app.fullName} (${app.role})`;
  const subject = record.stored
    ? `🔔 ${record.updated ? "Updated" : "New"} freelancer application: ${who}`
    : `⚠️ Freelancer application NOT saved: ${who}`;

  const storage = record.stored
    ? [
        record.updated
          ? `Stored: updated their existing pending application ${record.id}.`
          : `Stored: pending application ${record.id}.`,
        `Review: npm run applications approve ${record.id}`,
        `        npm run applications reject ${record.id}`,
      ]
    : [
        `NOT STORED: the database write failed (${record.error}).`,
        "This email and the server logs are the only record of this application. Add it by hand once the DB is fixed (has migration 0006 been run?).",
      ];

  const text = [
    "New freelancer application from the Freelancers page.",
    "",
    `Name: ${app.fullName}`,
    `Email: ${app.email}`,
    `Role: ${app.role}`,
    `Portfolio: ${app.portfolioUrl}`,
    `Rate: ${app.rateUsdPerHour != null ? `$${app.rateUsdPerHour}/hr` : "(not given)"}`,
    `Timezone: ${app.timezone ?? "(not given)"}`,
    `Skills: ${app.skills?.length ? app.skills.join(", ") : "(none given)"}`,
    `Bio: ${app.bio ?? "(none given)"}`,
    "",
    ...storage,
    `Confirmation email to applicant: ${confirmation}.`,
    "",
    "— Howdy",
  ].join("\n");

  return { subject, text };
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

  // Honeypot: the hidden `website` field is invisible to people, so anything
  // in it is a bot. Pretend it worked and drop it.
  const trap = (payload as { website?: unknown } | null)?.website;
  if (typeof trap === "string" && trap.trim() !== "") {
    console.warn("[/api/freelancer-apply] honeypot filled; dropping submission");
    return NextResponse.json({ ok: true });
  }

  const parsed = ApplySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_input", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const app = parsed.data;

  // Never throws; on failure it logs the full payload and says so.
  const record = await recordApplication(app);

  const first = firstName(app.fullName, app.fullName);
  let confirmation = "sent";
  try {
    await sendFreshEmail({
      to: app.email,
      subject: `Got your application, ${first}`,
      text: confirmationBody(first),
    });
  } catch (err) {
    const detail = errorMessage(err);
    console.error("[/api/freelancer-apply] confirmation email failed:", detail);
    confirmation = `FAILED (${detail})`;
  }

  // Always alert — when the DB write failed, this is the durable copy.
  await notifyOps(opsAlert(app, record, confirmation));

  return NextResponse.json({ ok: true });
}
