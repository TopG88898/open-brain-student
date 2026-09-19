-- The to-do list behind the 4:05 brief.
--
-- RLS is on with NO policies, and anon/authenticated lose all privileges. The only
-- reader/writer is the service role (used by the local runner and, later, an edge function),
-- which bypasses RLS. This is deliberate: unlike the student kit's `thoughts` table, a
-- personal task list must not be readable with the public anon key.

create table if not exists todos (
  id               bigint generated always as identity primary key,  -- shown to the user as #id
  title            text not null check (length(trim(title)) > 0),
  status           text not null default 'open' check (status in ('open', 'done', 'dropped')),
  priority         smallint not null default 2 check (priority between 1 and 3),
  effort           text check (effort in ('S', 'M', 'L')),
  origin           text not null default 'self' check (origin in ('self', 'external')),
  due_date         date,
  snooze_until     date,
  recurrence       text,  -- null, 'daily', 'weekly', or an RRULE string
  recurrence_mode  text not null default 'fixed' check (recurrence_mode in ('fixed', 'after_completion')),
  roll_count       integer not null default 0 check (roll_count >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists todos_open_due_idx on todos (due_date) where status = 'open';
create or replace function todo_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists todos_set_updated_at on todos;
create trigger todos_set_updated_at
  before update on todos
  for each row execute function todo_set_updated_at();
alter table todos enable row level security;
revoke all on table todos from anon, authenticated;
