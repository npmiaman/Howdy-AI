/**
 * The one mechanism behind every "only one caller may do this" step: a
 * conditional update that reports whether it changed a row. Overlapping cron
 * runs and retried webhooks race through these, and exactly one wins.
 *
 * Claims that stand in for work in progress hold a lease: a run killed
 * mid-step (Vercel's 60s limit, a crash) leaves its claim behind, and once
 * it's older than CLAIM_LEASE_MS the next run can take it over.
 */
import { getSupabaseAdmin } from "@/lib/supabase/client";

export const CLAIM_LEASE_MS = 10 * 60 * 1000;

export function leaseCutoff(): string {
  return new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
}

/** PostgREST `or()` filter: `column` is free (never claimed, or lease expired). */
export function leaseFree(column: string): string {
  return `${column}.is.null,${column}.lt.${leaseCutoff()}`;
}

// The filter builder's generics don't survive being passed around; the guard
// only chains filters (.eq/.in/.is/.or/...) onto it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Filters = any;

/** Apply `patch` to row `id` of `table` if `where` still holds. True = we won. */
export async function claimRow(
  table: string,
  id: string,
  patch: Record<string, unknown>,
  where: (q: Filters) => Filters = (q) => q,
): Promise<boolean> {
  const q = getSupabaseAdmin().from(table).update(patch).eq("id", id);
  const { data, error } = await where(q).select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Undo a claim unconditionally (its step failed and should be retried). */
export async function releaseClaim(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await getSupabaseAdmin().from(table).update(patch).eq("id", id);
  if (error) throw error;
}
