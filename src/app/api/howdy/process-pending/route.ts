import { NextResponse } from "next/server";

import { ensureFreelancerEmbeddings } from "@/lib/howdy/data";
import { sendLeadNudges } from "@/lib/howdy/nudges";
import {
  deliverFallbackShortlist,
  failRequest,
  sendDueConnects,
  startOutreach,
  sweepTimeouts,
} from "@/lib/howdy/outreach";
import {
  schedulePostMatchCheckins,
  sendDueCheckins,
} from "@/lib/howdy/post-match";
import {
  claimConnect,
  claimPending,
  listDueConnects,
  listDuePendingMatches,
  listFallbackDue,
  listRequestsInPhase,
  markPendingProcessed,
  releaseConnect,
  releasePending,
} from "@/lib/howdy/scheduler";
import type { PendingMatch } from "@/lib/howdy/scheduler";
import { getSupabaseAdmin } from "@/lib/supabase/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The saga records which candidates the client was shown (migration 0006).
 * Without that column every shortlist step would claim a request, fail, and
 * release it again on every run — so stop loudly instead.
 */
async function schemaProblem(): Promise<string | null> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("match_candidates")
      .select("shown_to_client_at")
      .limit(1);
    return error ? error.message : null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function authorize(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");
  if (provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Gemini key missing" },
      { status: 503 },
    );
  }

  const problem = await schemaProblem();
  if (problem) {
    console.error("[process-pending] schema check failed:", problem);
    return NextResponse.json(
      {
        ok: false,
        error: `schema check failed — is supabase/migrations/0006 applied? (${problem})`,
      },
      { status: 500 },
    );
  }

  const results: Array<{ step: string; id?: string; detail?: string }> = [];

  // ---- 0a. Self-heal freelancer embeddings. Any freelancer imported without
  //          one (e.g. a CSV upload) gets embedded now, so matching can never
  //          silently break on a missing vector. Cheap no-op when all present.
  try {
    const { embedded, failed } = await ensureFreelancerEmbeddings();
    if (embedded > 0 || failed > 0)
      results.push({
        step: "embedded_freelancers",
        detail: `${embedded} embedded, ${failed} failed`,
      });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[process-pending] ensureFreelancerEmbeddings:", detail);
    results.push({ step: "error_embeddings", detail });
  }

  // ---- 0. Hard 24h fallback FIRST. Any request nearing 24h without a
  //         delivered shortlist gets DB-ranked matches sent now, and is marked
  //         processed so step 1 won't also kick off (duplicate) outreach.
  //         Each delivery is claimed, so overlapping runs send it once. ----
  const fallbackDue = await listFallbackDue();
  for (const request of fallbackDue) {
    try {
      const { delivered, skipped, count, provisional } =
        await deliverFallbackShortlist(request);
      if (skipped) continue; // another run is delivering it
      // Nobody fits at all → tell the client honestly and close the request.
      if (!delivered) await failRequest(request);
      await markPendingProcessed({
        id: request.id,
        matchedFreelancerId: null,
        replyMessageId: null,
      });
      results.push({
        step: delivered ? "fallback_delivered" : "fallback_no_matches",
        id: request.id,
        detail: delivered
          ? `${count} ${provisional ? "provisional" : "confirmed"} pick(s)`
          : "no freelancers matched the brief",
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] fallback ${request.id}:`, detail);
      results.push({ step: "error_fallback", id: request.id, detail });
    }
  }
  const fallbackIds = new Set(fallbackDue.map((r) => r.id));

  // ---- 1. New requests whose deferred time is due → start outreach. ----
  const due = (await listDuePendingMatches()).filter(
    (r) => !fallbackIds.has(r.id),
  );
  for (const request of due) {
    // Claim first (processed_at) so overlapping runs start outreach once;
    // `phase` drives the rest. A failed start releases the claim to retry.
    if (!(await claimPending(request.id))) continue;
    try {
      const { invited, poolSize } = await startOutreach(request);
      if (poolSize === 0) await failRequest(request);
      results.push({
        step: poolSize === 0 ? "no_matches" : "started_outreach",
        id: request.id,
        detail: `invited ${invited} of ${poolSize} ranked`,
      });
    } catch (err) {
      await releasePending(request.id);
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] startOutreach ${request.id}:`, detail);
      results.push({ step: "error_start", id: request.id, detail });
    }
  }

  // ---- 2. Timeout sweep: invited freelancers past the reply window → pass
  //         to next-ranked (requests still recruiting only). ----
  try {
    const outreaching = await listRequestsInPhase(["outreach"]);
    const byId = new Map<string, PendingMatch>(
      outreaching.map((r) => [r.id, r]),
    );
    const { timedOut } = await sweepTimeouts(byId);
    if (timedOut > 0)
      results.push({ step: "swept_timeouts", detail: `${timedOut} timed out` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[process-pending] sweepTimeouts:", detail);
    results.push({ step: "error_sweep", detail });
  }

  // ---- 3. Connect intros whose short delay has elapsed → then schedule
  //         the post-match check-ins for that newly-connected match. ----
  for (const request of await listDueConnects()) {
    if (!(await claimConnect(request.id))) continue;
    try {
      const { connected } = await sendDueConnects(request);
      if (connected > 0) {
        results.push({
          step: "sent_connects",
          id: request.id,
          detail: `${connected} intro(s)`,
        });
        const { scheduled } = await schedulePostMatchCheckins(request);
        if (scheduled > 0)
          results.push({
            step: "scheduled_checkins",
            id: request.id,
            detail: `${scheduled} check-in(s)`,
          });
      }
    } catch (err) {
      await releaseConnect(request.id);
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] sendDueConnects ${request.id}:`, detail);
      results.push({ step: "error_connect", id: request.id, detail });
    }
  }

  // ---- 4. Post-match check-ins whose 3-day delay has elapsed. ----
  try {
    const { sent } = await sendDueCheckins();
    if (sent > 0)
      results.push({ step: "sent_checkins", detail: `${sent} sent` });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[process-pending] sendDueCheckins:", detail);
    results.push({ step: "error_checkins", detail });
  }

  // ---- 5. Nudge recent sign-ups who never replied to the welcome email. ----
  try {
    const { sent, skippedDryRun } = await sendLeadNudges();
    if (sent > 0 || skippedDryRun > 0)
      results.push({
        step: "lead_nudges",
        detail: `${sent} sent${skippedDryRun ? `, ${skippedDryRun} held by dry-run` : ""}`,
      });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[process-pending] sendLeadNudges:", detail);
    results.push({ step: "error_nudges", detail });
  }

  return NextResponse.json({ ok: true, steps: results.length, results });
}
