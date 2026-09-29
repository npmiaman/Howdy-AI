/**
 * Email opt-outs. Anyone who replies STOP (to a nudge, an invite, anything) is
 * suppressed: the saga mailer never emails them again. Writing in again with a
 * real message counts as opting back in.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

/** Appended to emails people didn't directly ask for (nudges, invites). */
export const OPT_OUT_LINE = "Not interested? Reply STOP and I won't email you again.";

const STOP = /^(stop|unsubscribe|remove me|opt[ -]?out|stop emailing me|please stop)[.!\s]*$/i;

/** A deliberate opt-out: the reply's first line is just "STOP" / "unsubscribe" etc. */
export function isStopRequest(text: string): boolean {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  return STOP.test(first);
}

/** Which of these addresses have opted out. */
export async function suppressedAmong(emails: string[]): Promise<string[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!isSupabaseConfigured() || list.length === 0) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("email_suppressions")
    .select("email")
    .in("email", list);
  if (error) {
    console.warn("[suppression] lookup failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: { email: string }) => r.email);
}

export async function suppress(email: string, reason: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("email_suppressions")
    .upsert({ email: email.trim().toLowerCase(), reason }, { onConflict: "email" });
  if (error) throw error;
}

export async function unsuppress(email: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("email_suppressions")
    .delete()
    .eq("email", email.trim().toLowerCase());
  if (error) throw error;
}
