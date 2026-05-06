-- Howdy: leads from the marketing site hire form.
-- Run this in the Supabase SQL editor (after 0001_init.sql).
-- Idempotent — safe to re-run.

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company text,
  position text,
  email text not null,
  source text not null default 'hire-form',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists leads_email_idx on leads (email);
create index if not exists leads_created_at_idx on leads (created_at desc);
create index if not exists leads_source_idx on leads (source);
