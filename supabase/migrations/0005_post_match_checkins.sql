-- Post-match experience: after Howdy connects a client + freelancer, it checks
-- in with BOTH (separately) a few days later, classifies the call as good/bad,
-- digs into why over a short conversation, then offers a rematch (bad) or asks
-- about a follow-up call (good). Two rounds max. See DECISIONS.md (2026-06-16).

create table if not exists post_match_checkins (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references pending_matches(id) on delete cascade,
  candidate_id uuid references match_candidates(id) on delete set null,
  party text not null check (party in ('company', 'freelancer')),
  round int not null default 1,
  status text not null default 'scheduled'
    check (status in (
      'scheduled',         -- created, check-in not yet sent
      'awaiting_reply',    -- "how was the call?" sent, awaiting first reply
      'digging',           -- mid dig-in conversation
      'offered_rematch',   -- (bad) asked if they want someone else
      'awaiting_followup', -- (good) asked if they'll do a follow-up call
      'done'
    )),
  sentiment text check (sentiment in ('good', 'bad')),
  feedback text,                       -- accumulated dig-in notes
  to_email text not null,              -- who we're checking in with
  checkin_thread_id text,              -- provider thread id, for reply correlation
  checkin_message_id text,             -- last message we sent
  turns int not null default 0,        -- dig-in exchanges so far (turn cap)
  scheduled_at timestamptz not null,   -- when to send the check-in
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists post_match_checkins_unique_idx
  on post_match_checkins (request_id, candidate_id, party, round);
create index if not exists post_match_checkins_due_idx
  on post_match_checkins (scheduled_at)
  where status = 'scheduled';
create index if not exists post_match_checkins_status_idx
  on post_match_checkins (status);
create index if not exists post_match_checkins_thread_idx
  on post_match_checkins (checkin_thread_id)
  where checkin_thread_id is not null;
