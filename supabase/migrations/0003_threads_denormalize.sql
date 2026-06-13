-- Denormalize message_count / last_message_at / last_message_snippet onto
-- threads so the /threads list page can render without scanning every row
-- in `messages`. A trigger on `messages` keeps them in sync.

alter table threads
  add column if not exists message_count int not null default 0,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_snippet text;

create index if not exists threads_last_message_at_idx
  on threads (last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Backfill from existing messages.
-- ---------------------------------------------------------------------------
with agg as (
  select
    thread_id,
    count(*)::int as cnt,
    max(created_at) as last_at
  from messages
  group by thread_id
),
latest as (
  select distinct on (thread_id)
    thread_id,
    left(content, 120) as snippet
  from messages
  order by thread_id, created_at desc
)
update threads t
set
  message_count = coalesce(agg.cnt, 0),
  last_message_at = agg.last_at,
  last_message_snippet = latest.snippet
from agg
left join latest using (thread_id)
where t.id = agg.thread_id;

-- ---------------------------------------------------------------------------
-- Trigger: recompute on insert / delete. Single-thread scope, uses the
-- existing (thread_id, created_at) index, so it is O(log n) per event.
-- ---------------------------------------------------------------------------
create or replace function threads_refresh_message_summary(p_thread_id uuid)
returns void
language plpgsql
as $$
declare
  v_count int;
  v_last_at timestamptz;
  v_snippet text;
begin
  select count(*)::int, max(created_at)
    into v_count, v_last_at
    from messages
   where thread_id = p_thread_id;

  select left(content, 120)
    into v_snippet
    from messages
   where thread_id = p_thread_id
   order by created_at desc
   limit 1;

  update threads
     set message_count = v_count,
         last_message_at = v_last_at,
         last_message_snippet = v_snippet,
         updated_at = now()
   where id = p_thread_id;
end;
$$;

create or replace function messages_after_change()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    perform threads_refresh_message_summary(new.thread_id);
    return new;
  elsif (tg_op = 'DELETE') then
    -- Skip if the parent thread is gone (ON DELETE CASCADE path).
    if exists (select 1 from threads where id = old.thread_id) then
      perform threads_refresh_message_summary(old.thread_id);
    end if;
    return old;
  elsif (tg_op = 'UPDATE') then
    if new.thread_id is distinct from old.thread_id then
      perform threads_refresh_message_summary(old.thread_id);
      perform threads_refresh_message_summary(new.thread_id);
    elsif new.content is distinct from old.content
       or new.created_at is distinct from old.created_at then
      perform threads_refresh_message_summary(new.thread_id);
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists messages_summary_trigger on messages;
create trigger messages_summary_trigger
  after insert or update or delete on messages
  for each row execute function messages_after_change();
