-- People, Milestone 3c: dictated notes from the Telegram bot.
--
-- A note the bot cannot file on exactly one approved person (no file, several people with the
-- name, or not yet approved) waits in the review queue as an 'unmatched_note'. Its detail holds
-- what Ethan dictated, when, and why it was not filed. Closing the item deletes it.

alter table review_items drop constraint if exists review_items_kind_check;
alter table review_items
  add constraint review_items_kind_check
  check (kind in ('suggestion', 'possible_duplicate', 'conflict', 'unmatched_note'));
