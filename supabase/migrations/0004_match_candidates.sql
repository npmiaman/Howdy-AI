-- Freelancer outreach saga: each match request (a row in pending_matches)
-- fans out to a ranked list of candidate freelancers, each progressing through
-- its own outreach lifecycle. See DECISIONS.md (2026-06-16).

-- ---------------------------------------------------------------------------
-- Request-level phase on pending_matches.
-- ---------------------------------------------------------------------------
alter table pending_matches
  add column if not exists phase text not null default 'matching'
    check (phase in (
      'matching',        -- brief done, not yet ranked
      'outreach',        -- inviting freelancers, collecting yes/no
      'shortlist_sent',  -- 3 acceptors (or fewer + flagged) emailed to client
      'client_selected', -- client picked 1+
      'connecting',      -- notifying chosen freelancers
      'connected',       -- intro emails sent
      'failed'
    )),
  add column if not exists shortlist_sent_at timestamptz,
  add column if not exists connect_after timestamptz; -- when to fire intro emails

create index if not exists pending_matches_phase_idx
  on pending_matches (phase)
  where processed_at is not null;

-- ---------------------------------------------------------------------------
-- match_candidates — one row per (request, freelancer) in the outreach pool.
-- ---------------------------------------------------------------------------
create table if not exists match_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references pending_matches(id) on delete cascade,
  thread_id uuid references threads(id) on delete set null,
  freelancer_id text not null references freelancers(id),
  rank int not null,                       -- 0 = best, from the ranker
  status text not null default 'queued'
    check (status in (
      'queued',      -- ranked, not yet invited
      'invited',     -- outreach email sent, awaiting reply
      'accepted',    -- said yes; counts toward the shortlist of 3
      'declined',    -- said no
      'timed_out',   -- no reply within the timeout window
      'chosen',      -- client picked this one
      'connecting',  -- "we're connecting you" notice sent
      'connected'    -- intro email (CC client) sent
    )),
  rationale text,                          -- why this freelancer fits (for client note)
  confidence text check (confidence in ('high', 'medium', 'low')),
  -- correlation: freelancer replies arrive on their own email thread.
  outreach_thread_id text,                 -- provider thread id for their convo
  outreach_message_id text,                -- last message id we sent them
  invited_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists match_candidates_req_freelancer_idx
  on match_candidates (request_id, freelancer_id);
create index if not exists match_candidates_request_idx
  on match_candidates (request_id, rank);
create index if not exists match_candidates_status_idx
  on match_candidates (status);
-- Fast lookup when a freelancer's reply comes in: who is this, on which request?
create index if not exists match_candidates_outreach_thread_idx
  on match_candidates (outreach_thread_id)
  where outreach_thread_id is not null;
