-- People, Milestone 3b: meetings become a syncable source.
--
-- sync_state is the table from 20260918140000_people_sync.sql; its source check listed only
-- email and imessage. Granola and Calendar meetings share one marker, 'meeting'.

alter table sync_state drop constraint if exists sync_state_source_check;
alter table sync_state
  add constraint sync_state_source_check check (source in ('email', 'imessage', 'meeting'));
