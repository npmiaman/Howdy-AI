-- 0006: saga correctness + freelancer applications.
-- Run in the Supabase SQL editor BEFORE deploying the code that uses it.

-- Which candidates were actually put in front of the client, and when. The
-- client's reply ("the second one", "Maya") is resolved against exactly this
-- set — including provisional (not-yet-confirmed) picks from the 24h fallback.
alter table match_candidates
  add column if not exists shown_to_client_at timestamptz;

-- Freelancers asking to join the roster. Reviewed by a human, then promoted
-- into `freelancers` (embeddings are filled in by the cron's self-heal step).
create table if not exists freelancer_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  role text not null,
  portfolio_url text not null,
  rate_usd_per_hour numeric,
  timezone text,
  skills text[] not null default '{}',
  bio text,
  source text not null default 'freelancers-page',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  freelancer_id text references freelancers(id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists freelancer_applications_status_idx
  on freelancer_applications (status, created_at);
create index if not exists freelancer_applications_email_idx
  on freelancer_applications (lower(email));
