/**
 * Leads — everyone who has given us their name + email, from any intake (the
 * hire form, the website chat). One row per email: a returning person's row is
 * refreshed in place so created_at keeps their first touch.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export async function upsertLead(args: {
  fullName: string;
  company: string;
  position: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  /** Intake that produced the lead, e.g. "hire-form" or "web-chat". A
   *  returning lead is tagged `${source}-returning`. */
  source: string;
}): Promise<{ leadId: string | null; isReturning: boolean }> {
  if (!isSupabaseConfigured()) return { leadId: null, isReturning: false };
  const supabase = getSupabaseAdmin();
  try {
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", args.email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Returning user — refresh the row in-place. created_at stays original.
      const { error: updateErr } = await supabase
        .from("leads")
        .update({
          full_name: args.fullName,
          company: args.company || null,
          position: args.position || null,
          source: `${args.source}-returning`,
          ip_address: args.ip,
          user_agent: args.userAgent,
        })
        .eq("id", existing.id);
      if (updateErr) {
        console.warn("[leads] lead update failed:", updateErr.message);
      }
      return { leadId: existing.id as string, isReturning: true };
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("leads")
      .insert({
        full_name: args.fullName,
        company: args.company || null,
        position: args.position || null,
        email: args.email,
        source: args.source,
        ip_address: args.ip,
        user_agent: args.userAgent,
      })
      .select("id")
      .single();
    if (insertErr) {
      console.warn("[leads] lead insert failed:", insertErr.message);
      return { leadId: null, isReturning: false };
    }
    return {
      leadId: (inserted?.id as string | undefined) ?? null,
      isReturning: false,
    };
  } catch (err) {
    console.warn("[leads] upsertLead threw:", err);
    return { leadId: null, isReturning: false };
  }
}
