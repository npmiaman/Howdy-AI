-- "Our own SQL DB" — a redundant mirror of Howdy conversation data.
-- Every thread/message/brief written to Supabase is also written here.
-- Faithful copy: same UUIDs, so rows line up 1:1 with the primary.

create table if not exists threads (
  id            uuid primary key,
  gmail_thread_id text unique,
  user_email    text not null,
  subject       text,
  brief         jsonb not null default '{}'::jsonb,
  last_processed_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  mirrored_at   timestamptz not null default now()
);

create table if not exists messages (
  id            uuid primary key,
  thread_id     uuid not null,  -- (no FK: a mirror must never block a message write)
  role          text not null check (role in ('human','ai')),
  content       text not null,
  gmail_message_id text,
  created_at    timestamptz not null default now(),
  mirrored_at   timestamptz not null default now()
);

create index if not exists messages_thread_idx on messages(thread_id);
create index if not exists messages_created_idx on messages(created_at);
