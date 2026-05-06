-- Howdy schema: freelancers (with pgvector), conversation threads, messages, long-term memories.
-- Run this in the Supabase SQL editor or via `supabase db push`.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ============================================================================
-- freelancers
-- ============================================================================
create table if not exists freelancers (
  id text primary key,
  name text not null,
  email text not null,
  role text not null,
  skills text[] not null default '{}',
  specialties text[] not null default '{}',
  rate_usd_per_hour numeric not null,
  timezone text not null,
  timezone_overlap_hours text[] not null default '{}',
  availability_hours_per_week int not null,
  bio text not null,
  portfolio_summary text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists freelancers_embedding_idx
  on freelancers using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists freelancers_rate_idx on freelancers (rate_usd_per_hour);

-- ============================================================================
-- threads — one per Gmail email thread
-- ============================================================================
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  gmail_thread_id text unique,
  user_email text not null,
  subject text,
  brief jsonb not null default '{}'::jsonb,
  last_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists threads_user_email_idx on threads (user_email);
create index if not exists threads_gmail_thread_idx on threads (gmail_thread_id);

-- ============================================================================
-- messages — every email in/out, in order
-- ============================================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  role text not null check (role in ('human', 'ai')),
  content text not null,
  gmail_message_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists messages_thread_idx on messages (thread_id, created_at);

-- ============================================================================
-- memories — per-user long-term notes (taste, prior matches, preferences)
-- ============================================================================
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  fact text not null,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists memories_user_idx on memories (user_email);
create index if not exists memories_embedding_idx
  on memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- ============================================================================
-- pending_matches — briefs queued for later matching at a randomized time.
-- ============================================================================
create table if not exists pending_matches (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  user_email text not null,
  subject text,
  brief jsonb not null,
  scheduled_at timestamptz not null,
  processed_at timestamptz,
  matched_freelancer_id text references freelancers(id) on delete set null,
  reply_message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pending_matches_due_idx
  on pending_matches (scheduled_at)
  where processed_at is null;

create index if not exists pending_matches_thread_idx
  on pending_matches (thread_id);

-- ============================================================================
-- match_freelancers RPC — vector search with optional rate / timezone filters.
-- ============================================================================
create or replace function match_freelancers(
  query_embedding vector(768),
  match_count int default 5,
  budget_max numeric default null,
  tz_filter text default null
) returns table (
  id text,
  name text,
  email text,
  role text,
  skills text[],
  specialties text[],
  rate_usd_per_hour numeric,
  timezone text,
  timezone_overlap_hours text[],
  availability_hours_per_week int,
  bio text,
  portfolio_summary text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    f.id, f.name, f.email, f.role, f.skills, f.specialties,
    f.rate_usd_per_hour, f.timezone, f.timezone_overlap_hours,
    f.availability_hours_per_week, f.bio, f.portfolio_summary,
    1 - (f.embedding <=> query_embedding) as similarity
  from freelancers f
  where
    (budget_max is null or f.rate_usd_per_hour <= budget_max)
    and (
      tz_filter is null
      or f.timezone ilike '%' || tz_filter || '%'
      or exists (
        select 1 from unnest(f.timezone_overlap_hours) tz
        where tz ilike '%' || tz_filter || '%'
      )
    )
  order by f.embedding <=> query_embedding
  limit match_count;
end;
$$;
