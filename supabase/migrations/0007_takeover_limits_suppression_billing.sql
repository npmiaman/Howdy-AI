-- 0007: human takeover, rate limits, email opt-outs, billable intros.
-- Run in the Supabase SQL editor (after 0006) BEFORE deploying code that uses it.

-- ─── Human takeover ─────────────────────────────────────────────────────────
-- When a person replies from the Howdy inbox (Momo, the AgentMail console),
-- the conversation is paused: Howdy stops auto-replying and holds any
-- client-facing saga email for the team instead. ai_mode_changed_at marks the
-- last pause/hand-back: only human replies after it count, so handing a
-- conversation back isn't undone by the team's earlier replies.
alter table threads
  add column if not exists ai_paused boolean not null default false,
  add column if not exists ai_mode_changed_at timestamptz;

-- Every conversation that exists today is being handled by hand.
update threads
   set ai_paused = true, ai_mode_changed_at = now()
 where ai_paused = false;

-- ─── Rate limits ────────────────────────────────────────────────────────────
-- Fixed-window counters (per IP, per session, per sender, daily budgets).
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- Atomically count one hit against `p_key` and say whether it's allowed:
-- a new window starts once the current one is older than p_window_seconds.
create or replace function hit_rate_limit(
  p_key text,
  p_window_seconds int,
  p_max int
) returns boolean
language plpgsql
as $$
declare
  v_count int;
begin
  insert into rate_limits as r (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then 1
          else r.count + 1
        end,
        window_start = case
          when r.window_start < now() - make_interval(secs => p_window_seconds) then now()
          else r.window_start
        end
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

-- ─── Email opt-outs ─────────────────────────────────────────────────────────
-- Anyone who replied STOP / unsubscribe. The saga mailer never emails them.
create table if not exists email_suppressions (
  email text primary key,          -- lowercased
  reason text,
  created_at timestamptz not null default now()
);

-- ─── Billable intros ────────────────────────────────────────────────────────
-- One row per creative introduced to a client (the "$50 per match" on the
-- pricing page). Invoicing is manual for now: the daily ops digest lists rows
-- with invoiced_at null.
create table if not exists billable_intros (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references pending_matches(id) on delete set null,
  candidate_id uuid unique references match_candidates(id) on delete set null,
  client_email text not null,
  freelancer_id text,
  fee_usd numeric not null default 50,
  created_at timestamptz not null default now(),
  invoiced_at timestamptz
);
