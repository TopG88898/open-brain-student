-- People: where a Fact came from.
--
-- A Fact read out of a text, email or meeting points at the Interaction it came from, so it can
-- be checked and so an older message never replaces a value taken from a newer one. A Fact Ethan
-- stated himself has no source and is never overridden by one read from a message.

alter table person_facts
  add column if not exists source_interaction_id uuid references interactions(id) on delete set null;
