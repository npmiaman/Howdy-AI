/**
 * Fixed-window rate limits and the daily AI budget, counted atomically in
 * Postgres (hit_rate_limit, migration 0007). Public endpoints — the chat, the
 * forms, the inbound email webhook — all end in Gemini calls or outbound
 * email, so without limits anyone could drain the quota or spam addresses.
 *
 * Limits are env-tunable. A limiter failure never blocks a real person: it
 * fails open and logs.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

import { notifyOps } from "./notify";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export const LIMITS = {
  chatPerSession: () => ({ max: num("HOWDY_CHAT_PER_SESSION", 20), window: DAY }),
  chatPerIp: () => ({ max: num("HOWDY_CHAT_PER_IP_HOUR", 60), window: HOUR }),
  formPerIp: () => ({ max: num("HOWDY_FORM_PER_IP_HOUR", 5), window: HOUR }),
  inboundPerSender: () => ({ max: num("HOWDY_INBOUND_PER_SENDER_HOUR", 20), window: HOUR }),
  aiTurnsPerDay: () => ({ max: num("HOWDY_DAILY_AI_TURNS", 500), window: DAY }),
};

/** Count one hit against `key`; false once it's over `max` in the window. */
export async function hitRateLimit(
  key: string,
  limit: { max: number; window: number },
): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  const { data, error } = await getSupabaseAdmin().rpc("hit_rate_limit", {
    p_key: key,
    p_window_seconds: limit.window,
    p_max: limit.max,
  });
  if (error) {
    console.warn(`[rate-limit] ${key}: ${error.message} — allowing`);
    return true;
  }
  return data !== false;
}

/**
 * Spend one AI turn from today's budget. When the budget runs out the team
 * hears about it once that day, and callers fall back to a no-AI path.
 */
export async function spendAiTurn(): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const allowed = await hitRateLimit(`ai-turns:${day}`, LIMITS.aiTurnsPerDay());
  if (!allowed && (await hitRateLimit(`alert:ai-budget:${day}`, { max: 1, window: DAY }))) {
    await notifyOps({
      subject: "⛽ Howdy hit today's AI budget",
      text: `Howdy has used today's ${LIMITS.aiTurnsPerDay().max} AI turns (HOWDY_DAILY_AI_TURNS). Until midnight UTC, the website chat says it's busy and inbound emails are passed to you instead of answered.\n\nIf this is real demand, raise the budget; if not, someone may be abusing the chat.\n\n— Howdy`,
    });
  }
  return allowed;
}
