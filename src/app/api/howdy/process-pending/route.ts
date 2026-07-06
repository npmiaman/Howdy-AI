import { NextResponse } from "next/server";

import {
  deliverFallbackShortlist,
  sendDueConnects,
  startOutreach,
  sweepTimeouts,
} from "@/lib/howdy/outreach";
import {
  schedulePostMatchCheckins,
  sendDueCheckins,
} from "@/lib/howdy/post-match";
import {
  listDueConnects,
  listDuePendingMatches,
  listFallbackDue,
  listRequestsInPhase,
  markPendingProcessed,
} from "@/lib/howdy/scheduler";
import type { PendingMatch } from "@/lib/howdy/scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const results: Array<{ step: string; id?: string; detail?: string }> = [];

  // ---- 0. Hard 24h fallback FIRST. Any request nearing 24h without a
  //         delivered shortlist gets DB-ranked matches sent now, and is marked
  //         processed so step 1 won't also kick off (duplicate) outreach. ----
  const fallbackDue = await listFallbackDue();
  for (const request of fallbackDue) {
    try {
      const { delivered, count, provisional } =
        await deliverFallbackShortlist(request);
      // Mark processed regardless: delivered → done; not delivered (e.g. no
      // freelancers matched) → don't keep retrying every run.
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
    try {
      const { invited, poolSize } = await startOutreach(request);
      // Mark processed so we don't re-start outreach; `phase` drives the rest.
      await markPendingProcessed({
        id: request.id,
        matchedFreelancerId: null,
        replyMessageId: null,
      });
      results.push({
        step: "started_outreach",
        id: request.id,
        detail: `invited ${invited} of ${poolSize} ranked`,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] startOutreach ${request.id}:`, detail);
      results.push({ step: "error_start", id: request.id, detail });
    }
  }

  // ---- 2. Timeout sweep: invited freelancers past 24h → pass to next-ranked. ----
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

  return NextResponse.json({ ok: true, steps: results.length, results });
}
