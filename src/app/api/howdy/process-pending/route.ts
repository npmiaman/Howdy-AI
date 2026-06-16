import { NextResponse } from "next/server";

import {
  sendDueConnects,
  startOutreach,
  sweepTimeouts,
} from "@/lib/howdy/outreach";
import {
  listDueConnects,
  listDuePendingMatches,
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

  // ---- 1. New requests whose deferred time is due → start outreach. ----
  const due = await listDuePendingMatches();
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

  // ---- 3. Connect intros whose short delay has elapsed. ----
  for (const request of await listDueConnects()) {
    try {
      const { connected } = await sendDueConnects(request);
      if (connected > 0)
        results.push({
          step: "sent_connects",
          id: request.id,
          detail: `${connected} intro(s)`,
        });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending] sendDueConnects ${request.id}:`, detail);
      results.push({ step: "error_connect", id: request.id, detail });
    }
  }

  return NextResponse.json({ ok: true, steps: results.length, results });
}
