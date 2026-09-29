/**
 * Billing, phase 1: every creative Howdy introduces is recorded as a billable
 * intro (the "$50 per match" on the pricing page). Invoicing is manual for
 * now — the daily ops digest lists what hasn't been invoiced, and
 * `npm run billing` marks rows invoiced.
 */
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/client";

export const MATCH_FEE_USD = Number(process.env.HOWDY_MATCH_FEE_USD ?? 50);

/** The pricing line in the shortlist email — same terms as the website. */
export function pricingNote(): string {
  return `Pricing, same as on our site: a flat $${MATCH_FEE_USD} for each creative I introduce you to, plus a 10% service fee.`;
}

export type BillableIntro = {
  id: string;
  request_id: string | null;
  candidate_id: string | null;
  client_email: string;
  freelancer_id: string | null;
  fee_usd: number;
  created_at: string;
  invoiced_at: string | null;
};

/** Record one intro. Idempotent per candidate (a re-sent intro isn't billed twice). */
export async function recordBillableIntro(args: {
  requestId: string;
  candidateId: string;
  clientEmail: string;
  freelancerId: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabaseAdmin()
    .from("billable_intros")
    .upsert(
      {
        request_id: args.requestId,
        candidate_id: args.candidateId,
        client_email: args.clientEmail,
        freelancer_id: args.freelancerId,
        fee_usd: MATCH_FEE_USD,
      },
      { onConflict: "candidate_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function listUninvoiced(): Promise<BillableIntro[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("billable_intros")
    .select("*")
    .is("invoiced_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BillableIntro[];
}

export async function markInvoiced(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await getSupabaseAdmin()
    .from("billable_intros")
    .update({ invoiced_at: new Date().toISOString() })
    .in("id", ids)
    .is("invoiced_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}
