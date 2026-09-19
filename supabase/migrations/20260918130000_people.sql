-- People: a private file on each person you deal with.
--
-- ACCESS: every table here has Row Level Security ON and NO policies, and anon/authenticated
-- have no privileges at all. Only the service role (used by the open-brain-mcp edge function)
-- can read or write. This is deliberate and different from the original `thoughts` table:
-- these rows describe other people.
--
-- Single-user by design, like the rest of the brain: no user_id columns.

create table if not exists people (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) > 0),
  -- 'suggested' = proposed by a sync and awaiting approval; 'active' = has a file.
  status             text not null default 'active' check (status in ('suggested', 'active')),
  relationship       text,
  profile_summary    text,
  profile_updated_at timestamptz,
  last_contact_at    timestamptz,
  follow_up_at       timestamptz,
  follow_up_note     text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_people_name_lower on people (lower(name));
create index if not exists idx_people_status on people (status);
create index if not exists idx_people_follow_up on people (follow_up_at) where follow_up_at is not null;

-- How a person is recognised across sources. An identifier belongs to exactly one person.
create table if not exists person_identifiers (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people(id) on delete cascade,
  type       text not null check (type in ('phone', 'email', 'telegram', 'alias')),
  value      text not null check (length(btrim(value)) > 0),
  created_at timestamptz not null default now(),
  unique (type, value)
);

create index if not exists idx_person_identifiers_person on person_identifiers (person_id);

-- Things we know about someone. A correction supersedes the old value instead of deleting it.
create table if not exists person_facts (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references people(id) on delete cascade,
  key           text not null,
  value         text not null,
  superseded_at timestamptz,
  created_at    timestamptz not null default now()
);

-- At most one current value per key; history rows have superseded_at set.
create unique index if not exists idx_person_facts_one_active
  on person_facts (person_id, key) where superseded_at is null;

-- The timeline. `summary` is written by Claude; verbatim message text is never stored.
create table if not exists interactions (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people(id) on delete cascade,
  source      text not null check (source in ('imessage', 'email', 'note', 'meeting', 'telegram')),
  occurred_at timestamptz not null default now(),
  direction   text check (direction in ('in', 'out')),
  summary     text not null check (length(btrim(summary)) > 0),
  source_ref  text,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);

-- The same source message is stored once. Notes have no source_ref and are never deduplicated.
create unique index if not exists idx_interactions_source_ref
  on interactions (source, source_ref) where source_ref is not null;
create index if not exists idx_interactions_person_time on interactions (person_id, occurred_at desc);
create index if not exists idx_interactions_embedding
  on interactions using hnsw (embedding vector_cosine_ops);

-- People (and domains) the sweep must never read, summarize, or suggest.
create table if not exists person_exclusions (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('phone', 'email', 'telegram', 'alias', 'domain')),
  value      text not null check (length(btrim(value)) > 0),
  created_at timestamptz not null default now(),
  unique (type, value)
);

-- Lets an existing thought be tied to someone's file. Deleting a person just unlinks it.
alter table thoughts
  add column if not exists person_id uuid references people(id) on delete set null;
create index if not exists idx_thoughts_person on thoughts (person_id) where person_id is not null;

-- Semantic search over the timeline, with the person's name attached.
create or replace function search_interactions(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10
)
returns table (
  id uuid,
  person_id uuid,
  person_name text,
  source text,
  occurred_at timestamptz,
  summary text,
  similarity float
)
language sql
stable
as $$
  select
    i.id,
    i.person_id,
    p.name,
    i.source,
    i.occurred_at,
    i.summary,
    (1 - (i.embedding <=> query_embedding))::float
  from interactions i
  join people p on p.id = i.person_id
  where i.embedding is not null
    and (1 - (i.embedding <=> query_embedding)) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- Lock everything down. RLS on with no policy denies by default; the revokes make an
-- unauthorised query fail loudly with "permission denied" instead of quietly returning nothing.
alter table people             enable row level security;
alter table person_identifiers enable row level security;
alter table person_facts       enable row level security;
alter table interactions       enable row level security;
alter table person_exclusions  enable row level security;

revoke all on people, person_identifiers, person_facts, interactions, person_exclusions
  from anon, authenticated;

revoke execute on function search_interactions(vector, float, int) from public, anon, authenticated;
grant  execute on function search_interactions(vector, float, int) to service_role;
