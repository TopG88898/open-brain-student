---
name: people
description: Keep a private file on the people Ethan deals with. Use when he asks to add a note about a person, correct something about them, look someone up ("what do I know about Sarah?"), set a follow-up, forget someone, sync his texts, email or meetings into their files, review the people queue, or run a sweep.
---

Files live in Supabase and are reached through the `open-brain` MCP tools: `upsert_person`, `add_interaction`, `set_fact`, `get_person`, `search_people`, `forget_person`, `start_sync`, `finish_sync`, `suggest_people`, `resolve_suggestion`, `list_review_queue`, `close_review_item`. Terms are defined in [CONTEXT.md](CONTEXT.md). Settings are in [parameters.md](parameters.md): read it first every run.

Notes, lookups, manual syncs of texts, email and meetings, the review queue, sweeps and notes dictated in Telegram all work today. Telegram is a way for Ethan to dictate notes to the bot, not a source to read: there is no connector for other people's chats, so if asked to read them, say so.

## Adding a note

1. Find the Person with `get_person` by name.
   - `found`: use them.
   - `ambiguous`: ask Ethan which one.
   - `not_found`: ask before creating a File, then `upsert_person` with the name and any identifier he gave.
2. Write the summary yourself: one or two factual sentences of what he told you. Leave out any topic in `avoid_topics`. If the whole note is about a sensitive topic, do not save it and tell him why.
3. `add_interaction` with source `note`, passing `profile_max_words` and `avoid_topics` from parameters.md. Tell him the Profile changed.
4. If he asked for a follow-up, call `upsert_person` with `id`, `follow_up_at` and `follow_up_note`. With no date given, use `default_follow_up_days`.

He can also dictate a note to the Telegram bot: `@Sarah moved to Denver`, or `@Sarah Chen: moved to Denver` for a name with spaces. The bot files it on the one approved Person with that name or alias. It adds no Fact and does not refresh the Profile, so do both when he next asks about that Person. A note it cannot file waits in the review queue as an `unmatched_note` (see Reviewing the queue). It refuses a note that touches an `avoid_topics` subject, and Telegram messages without `@` stay plain thoughts.

Save a Fact with `set_fact` when he states one plainly ("she works at Acme"). Do not turn guesses into Facts.

## Correcting something

Call `set_fact` with the same key and the new value. The old value is kept as Superseded. Never edit the Profile directly.

## Looking someone up

`get_person`, then answer from the File: Profile first, then Follow-up, then recent Timeline. Use `search_people` for a name fragment or a question like "who mentioned moving?". Say when nothing is found rather than guessing.

## Creating or merging

- `possible_duplicate`: show Ethan the candidate and ask whether it is the same person. Same person: call `upsert_person` with the candidate's `id` and the new identifiers. Different person: call again with `confirm_new`.
- `conflict`: tell him the identifiers belong to two Files. Never merge them.
- `excluded`: he asked never to track this person. Do not create a File and do not repeat their details.

## Forgetting someone

1. Call `forget_person` with `confirm` false. Tell him whose File will be permanently deleted.
2. Only after he says yes, call it again with `confirm` true.

## Syncing texts or email

One source per run: `email` (Gmail connector) or `imessage` (iMessage connector). The sync is done when the batch of suggestions has been shown and `finish_sync` has been called.

1. Note the current time as `T`. Call `start_sync` with the source and `sync_lookback_days`; it returns `since`.
2. Scan from senders and recipients alone. For email, search Gmail with `gmail_query` from parameters.md plus `after:` `since`. For iMessage, list conversations since `since`. Group by identifier and count messages Ethan sent (`sent`) and received (`received`). Set `automated` for list, bulk or system senders. Message text stays unread at this stage.
3. Call `suggest_people` with every candidate and the three `suggest_*` and `ignore_*` values from parameters.md. Results come back in candidate order.
4. Read message text only for `has_file` people; skipped people are never opened. For each has_file person, write one Interaction per email thread or per day of texts with `add_interaction`: source `email` or `imessage`, `direction` `in` when they wrote last, `source_ref` the id of the newest message the summary covers (Gmail message id, iMessage message GUID), and `refresh_profile` false on every entry except that person's last. Follow the summary rules under Adding a note.
5. Show one numbered batch: each `suggested` and `already_suggested` person with name, identifier, `sent` and `received` (or, for meetings, how many one-on-one and group meetings), and a one-line reason they cleared the threshold. List each `possible_duplicate` (ask whether it is the same person) and each `conflict` (report, never merge). Give skipped people as counts by reason, without names. Say nothing at all about `excluded`.
6. Apply his answer with `resolve_suggestion`, one call per person. For each approved person, read their messages from this scan and add Interactions as in step 4. A person approved in a later session has no Interactions yet: read their messages back `sync_lookback_days` and add them the same way.
7. Call `finish_sync` with `T`, once steps 4 to 6 succeeded. A sync that failed midway is retried from the same `since`: `source_ref` makes the repeat safe.

## Syncing meetings

Source `meeting` reads Granola and Calendar together. The sync is done when the batch has been shown and `finish_sync` has been called.

1. Note the current time as `T`. Call `start_sync` with source `meeting` and `sync_lookback_days`; it returns `since`.
2. Collect meetings since `since` that have ended.
   - Granola: `list_meetings` offers only `this_week`, `last_week` and `last_30_days`. Take the smallest that covers `since` and drop meetings before it.
   - Calendar: `list_events` from `since` to now. Keep timed events of type `DEFAULT` that Ethan has not declined and that have at least one other attendee.
   - A Granola meeting and a Calendar event with overlapping start times and shared attendees or title are one meeting.
3. Drop every meeting with more than `meeting_max_attendees` attendees (counting Ethan), and every meeting whose title is about an `avoid_topics` subject.
4. Identify attendees by email address, taken from list metadata and Calendar events. Open a Granola meeting for its attendee list only when nothing else shows it, and use nothing else from its notes until `suggest_people` has returned. An attendee with no email address is skipped, never guessed.
5. Build one candidate per person: `meetings.one_on_one` counts meetings where they were the only other attendee, `meetings.group` the rest. Set `automated` for room and resource calendars and note-taker bots. Call `suggest_people` with `min_one_on_one_meetings` and `ignore_no_reply` from parameters.md in place of the message thresholds.
6. For each `has_file` person, add one Interaction per meeting with `add_interaction`: source `meeting`, `occurred_at` the start time, no `direction`, and `refresh_profile` false except on that person's last entry. `source_ref` is `cal:` plus the Calendar event id when the meeting has one, else `granola:` plus the Granola id. Write the summary yourself in one or two factual sentences of what was discussed, from Granola's notes when there are any; with only a Calendar event, use the title and time.
7. Show the batch and apply his answers as in Syncing steps 5 and 6 (meeting counts in place of message counts).
8. Call `finish_sync` with `T`, once steps 6 and 7 succeeded.

## Reviewing the queue

Start every run by calling `list_review_queue`. When something is waiting, say how many items, once, and carry on with what he asked. When he asks to review:

1. Show one numbered batch as in Syncing step 5: each `suggestion` with source, `sent` and `received`; each `possible_duplicate` with the candidates from `candidate_ids` (`get_person` each); each `conflict` with the people in `person_ids`; each `unmatched_note` with the name he wrote, the note itself (`detail.note`), the date and the reason (`detail.reason`), plus the people in `candidate_ids`.
2. Apply his answers:
   - `suggestion`: `resolve_suggestion`, which also clears the item. For each approved person, read their messages or meetings back `sync_lookback_days` and add Interactions as in Syncing step 4 or Syncing meetings step 5.
   - `possible_duplicate`: same person, then `upsert_person` with that candidate's `id` and the identifiers from `detail`; different person, then `upsert_person` with `confirm_new`. Then `close_review_item`.
   - `conflict`: report it and never merge. `close_review_item` once he has seen it.
   - `unmatched_note`: ask whose File it belongs on, or whether to drop it. `no_match`: he may mean an existing Person under another name (then `upsert_person` with that `id` and the name as an `alias` Identifier, so it matches next time) or someone new (then `upsert_person` with the name). `ambiguous`: ask which of `candidate_ids`. `not_approved`: `resolve_suggestion` approve first, if he agrees. Then `add_interaction` with source `note`, `summary` his note in the same words unless it touches an `avoid_topics` subject, `occurred_at` from `detail`, and `source_ref` the item's `key`. `close_review_item` after that, or straight away if he drops it.

## Running a Sweep

A Sweep is a Sync that runs while Ethan is away, so nobody can answer a question. Decide everything the rules decide and leave the rest in the review queue. The sweep is done when all three sources have been tried and the summary is written.

Run `email`, then `imessage` (Syncing), then `meeting` (Syncing meetings), each in full except for these changes:

- Pass `queue_source` (the source name) to `suggest_people`. That is what puts suggestions, possible duplicates and conflicts in the queue.
- The step that shows a batch and applies answers does not run. Nothing is shown to anyone, and no call to `resolve_suggestion`, `close_review_item` or `upsert_person` with `confirm_new` is made.
- A source that fails midway is left without `finish_sync`, so the next sweep retries from the same `since`. Carry on with the next source.

Finish with a summary of counts only: per source, Interactions added, items now in the queue, people skipped by reason, and errors. Names, titles and message text stay out of it.

## Boundaries

- Never send, reply to, draft or label a text or email as part of this skill. Drafting a reply is a separate request Ethan makes explicitly.
- Never store message text word for word. Summaries only.
