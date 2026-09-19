-- People, Milestone 2: sync markers and dismissed suggestions.
--
-- Same access rules as 20260918130000_people.sql: RLS on, no policies, anon/authenticated
-- have no privileges. Only the service role (the open-brain-mcp edge function) can touch these.

-- A suggestion Ethan turned down is kept as 'dismissed' so later syncs do not suggest it again.
-- It is not an exclusion: exclusions are never read at all, a dismissal is only never suggested.
alter table people drop constraint if exists people_status_check;
alter table people
  add constraint people_status_check check (status in ('suggested', 'active', 'dismissed'));

-- Where each source's last finished sync stopped, so the next one reads only what is new.
create table if not exists sync_state (
  source         text primary key check (source in ('email', 'imessage')),
  last_synced_at timestamptz not null
);

alter table sync_state enable row level security;
revoke all on sync_state from anon, authenticated;
