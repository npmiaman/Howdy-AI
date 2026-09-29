/**
 * Freelancer applications from the "Request an Invite" form. Every
 * application is reviewed by a human; approving one promotes it into the
 * `freelancers` roster (the cron's self-heal step embeds the new row), so
 * nobody joins the matching pool without a person saying yes.
 */
import { randomBytes } from "node:crypto";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import type { Freelancer } from "./types";

export type ApplicationStatus = "pending" | "approved" | "rejected";

export type ApplicationRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  portfolio_url: string;
  rate_usd_per_hour: number | null;
  timezone: string | null;
  skills: string[];
  bio: string | null;
  source: string;
  status: ApplicationStatus;
  freelancer_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type ApplicationInput = {
  fullName: string;
  email: string;
  role: string;
  portfolioUrl: string;
  rateUsdPerHour?: number | null;
  timezone?: string | null;
  skills?: string[];
  bio?: string | null;
  source?: string;
};

export type RecordResult =
  | { stored: true; id: string; updated: boolean }
  | { stored: false; error: string };

// Roster defaults for a freshly approved freelancer — tune per person later.
const DEFAULT_AVAILABILITY_HOURS = 20;

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : String(err);
}

/**
 * Case-insensitive exact email match. `ilike` alone isn't exact — `_` is a
 * LIKE wildcard and valid in emails — so confirm each hit in JS.
 */
function sameEmail(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function findPendingByEmail(email: string): Promise<ApplicationRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("freelancer_applications")
    .select("*")
    .eq("status", "pending")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as ApplicationRow[];
  return rows.find((r) => sameEmail(r.email, email)) ?? null;
}

/**
 * Store an application. A second submission from the same email (any case)
 * while the first is still pending updates it in place rather than queueing
 * a duplicate. Never throws: if the write fails (e.g. migration 0006 hasn't
 * been run), the full payload goes to the error log and the caller is told it
 * wasn't stored so it can alert ops — an application is never silently lost.
 */
export async function recordApplication(input: ApplicationInput): Promise<RecordResult> {
  const email = input.email.trim().toLowerCase();
  const fields = {
    full_name: input.fullName,
    email,
    role: input.role,
    portfolio_url: input.portfolioUrl,
    rate_usd_per_hour: input.rateUsdPerHour ?? null,
    timezone: input.timezone || null,
    skills: input.skills ?? [],
    bio: input.bio || null,
    source: input.source ?? "freelancers-page",
  };

  try {
    if (!isSupabaseConfigured()) throw new Error("Supabase is not configured");
    const sb = getSupabaseAdmin();

    // A failed lookup shouldn't cost us the application — worst case we
    // insert a duplicate pending row, which a reviewer can reject.
    const existing = await findPendingByEmail(email).catch((err) => {
      console.warn("[applications] pending lookup failed:", errMessage(err));
      return null;
    });

    if (existing) {
      const { error } = await sb
        .from("freelancer_applications")
        .update(fields)
        .eq("id", existing.id);
      if (error) throw error;
      return { stored: true, id: existing.id, updated: true };
    }

    const { data, error } = await sb
      .from("freelancer_applications")
      .insert(fields)
      .select("id")
      .single();
    if (error) throw error;
    return { stored: true, id: (data as { id: string }).id, updated: false };
  } catch (err) {
    const detail = errMessage(err);
    console.error(
      `[applications] could not store application (${detail}). Full payload:`,
      JSON.stringify(fields),
    );
    return { stored: false, error: detail };
  }
}

export async function listApplications(status?: ApplicationStatus): Promise<ApplicationRow[]> {
  let query = getSupabaseAdmin()
    .from("freelancer_applications")
    .select("*")
    .order("created_at", { ascending: true });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ApplicationRow[];
}

async function getPending(id: string): Promise<ApplicationRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("freelancer_applications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No application with id ${id}.`);
  const app = data as ApplicationRow;
  if (app.status !== "pending") {
    throw new Error(`Application ${id} is already ${app.status}; only pending applications can be reviewed.`);
  }
  return app;
}

/** Readable, stable roster id: "maya-liu-3f9a2c". */
function freelancerIdFor(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "freelancer"}-${randomBytes(3).toString("hex")}`;
}

/**
 * Promote a pending application into the `freelancers` roster. The freelancer
 * row needs a rate and a timezone (both NOT NULL, and both used by matching);
 * if the applicant left either blank, pass it via `overrides` rather than
 * inventing one. Refuses non-pending applications and emails already on the
 * roster. The embedding is left null for the cron's self-heal to fill in.
 */
export async function approveApplication(
  id: string,
  overrides: { rateUsdPerHour?: number; timezone?: string } = {},
): Promise<Freelancer> {
  const app = await getPending(id);
  const sb = getSupabaseAdmin();

  const rate = overrides.rateUsdPerHour ?? app.rate_usd_per_hour;
  const timezone = overrides.timezone ?? app.timezone;
  if (rate == null) {
    throw new Error(`Application ${id} has no hourly rate. Ask the applicant, then approve with --rate <usd>.`);
  }
  if (!timezone) {
    throw new Error(`Application ${id} has no timezone. Ask the applicant, then approve with --timezone <tz>.`);
  }

  const { data: onRoster, error: rosterErr } = await sb
    .from("freelancers")
    .select("id,email")
    .ilike("email", app.email);
  if (rosterErr) throw rosterErr;
  const dupe = ((onRoster ?? []) as Array<{ id: string; email: string }>).find((f) =>
    sameEmail(f.email, app.email),
  );
  if (dupe) {
    throw new Error(`${app.email} is already on the roster as ${dupe.id}. Reject this application or update that row instead.`);
  }

  const bio = app.bio ?? "";
  const freelancer: Freelancer = {
    id: freelancerIdFor(app.full_name),
    name: app.full_name,
    email: app.email,
    role: app.role,
    skills: app.skills ?? [],
    specialties: [],
    rate_usd_per_hour: Number(rate),
    timezone,
    timezone_overlap_hours: [],
    availability_hours_per_week: DEFAULT_AVAILABILITY_HOURS,
    bio,
    portfolio_summary: [`Portfolio: ${app.portfolio_url}.`, bio].filter(Boolean).join(" "),
  };

  const { error: insErr } = await sb.from("freelancers").insert(freelancer);
  if (insErr) throw insErr;

  // Guard on status so a concurrent approve can't double-promote.
  const { data: marked, error: updErr } = await sb
    .from("freelancer_applications")
    .update({
      status: "approved",
      freelancer_id: freelancer.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (updErr || !marked?.length) {
    throw new Error(
      `Added ${freelancer.id} to the roster, but couldn't mark application ${id} approved` +
        (updErr ? ` (${errMessage(updErr)})` : " (it was reviewed concurrently)") +
        ". Check both tables.",
    );
  }
  return freelancer;
}

export async function rejectApplication(id: string): Promise<void> {
  await getPending(id);
  const { error } = await getSupabaseAdmin()
    .from("freelancer_applications")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}
