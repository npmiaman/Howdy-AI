/**
 * Human takeover. When someone on the team replies to a conversation by hand,
 * Howdy steps back: it stops auto-replying there and holds any client-facing
 * saga email for the team instead (see dispatch in mailer.ts). The team gets a
 * signed one-click link to hand the conversation back.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { threadHasHumanReply } from "@/lib/agentmail/client";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";
import { SITE_URL } from "@/lib/utils";

/** Outbound mail before this can't be attributed (it predates the auto label). */
function autoLabelSince(): Date {
  return new Date(process.env.HOWDY_AUTO_LABEL_SINCE ?? "2026-09-29T00:00:00Z");
}

async function mode(threadId: string): Promise<{ paused: boolean; changedAt: Date | null }> {
  if (!isSupabaseConfigured()) return { paused: false, changedAt: null };
  const { data } = await getSupabaseAdmin()
    .from("threads")
    .select("ai_paused,ai_mode_changed_at")
    .eq("id", threadId)
    .maybeSingle();
  return {
    paused: data?.ai_paused === true,
    changedAt: data?.ai_mode_changed_at ? new Date(data.ai_mode_changed_at) : null,
  };
}

export async function isPaused(threadId: string): Promise<boolean> {
  return (await mode(threadId)).paused;
}

export async function setPaused(threadId: string, paused: boolean): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("threads")
    .update({ ai_paused: paused, ai_mode_changed_at: new Date().toISOString() })
    .eq("id", threadId);
  if (error) throw error;
}

/**
 * Is a human handling this conversation? True if it's already paused, or if a
 * person has replied on its provider thread since the last hand-back (and
 * since the auto label existed) — in which case it's paused from now on. A
 * failed provider lookup doesn't block.
 */
export async function humanIsHandling(args: {
  threadId: string;
  providerThreadId: string;
}): Promise<boolean> {
  const current = await mode(args.threadId);
  if (current.paused) return true;
  const since = new Date(
    Math.max(autoLabelSince().getTime(), current.changedAt?.getTime() ?? 0),
  );
  const human = await threadHasHumanReply(args.providerThreadId, since).catch(
    (err) => {
      console.warn("[takeover] provider thread lookup failed:", err);
      return false;
    },
  );
  if (human) await setPaused(args.threadId, true);
  return human;
}

function sign(threadId: string, mode: string): string {
  return createHmac("sha256", process.env.CRON_SECRET ?? "")
    .update(`${threadId}:${mode}`)
    .digest("hex");
}

/** One-click link for the team: "auto" hands back to Howdy, "human" takes over. */
export function takeoverLink(threadId: string, mode: "auto" | "human"): string {
  const q = new URLSearchParams({ thread: threadId, mode, sig: sign(threadId, mode) });
  return `${SITE_URL}/api/howdy/takeover?${q}`;
}

export function verifyTakeoverLink(threadId: string, mode: string, sig: string): boolean {
  if (!process.env.CRON_SECRET) return false;
  const expected = Buffer.from(sign(threadId, mode), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
