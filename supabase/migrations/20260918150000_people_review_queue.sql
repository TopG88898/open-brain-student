-- People, Milestone 3: the review queue.
--
-- The scheduled sweep runs unattended and cannot ask Ethan anything, so what needs his decision
-- waits here: new suggestions, possible duplicates and conflicting identifiers. Same access rules
-- as the other people tables: RLS on, no policies, anon/authenticated have no privileges.
--
-- Closing an item deletes it. Once Ethan has decided, nothing about the person needs to stay here.

create table if not exists review_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('suggestion', 'possible_duplicate', 'conflict')),
  -- What makes two items the same question: the person id, the identifiers, or the owner ids.
  key        text not null,
  -- A suggestion belongs to the suggested person and goes with them if they are forgotten.
  person_id  uuid references people(id) on delete cascade,
  subject    text not null check (length(btrim(subject)) > 0),
  -- Where it was seen, the identifiers, and message counts; never message text.
  detail     jsonb not null,
  created_at timestamptz not null default now(),
  unique (kind, key)
);

alter table review_items enable row level security;
revoke all on review_items from anon, authenticated;
