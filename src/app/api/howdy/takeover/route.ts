import { NextResponse } from "next/server";

import { setPaused, verifyTakeoverLink } from "@/lib/howdy/takeover";

export const runtime = "nodejs";

function page(status: number, message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Howdy</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${message}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** The signed link from an ops alert: hand a conversation back to Howdy, or take it over. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const thread = url.searchParams.get("thread") ?? "";
  const mode = url.searchParams.get("mode") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  if (!thread || !["auto", "human"].includes(mode) || !verifyTakeoverLink(thread, mode, sig))
    return page(401, "That link isn't valid.");
  await setPaused(thread, mode === "human");
  return page(
    200,
    mode === "auto"
      ? "Done — Howdy is back on this conversation and will answer the next reply."
      : "Done — Howdy is paused on this conversation. Reply from Momo as usual.",
  );
}
