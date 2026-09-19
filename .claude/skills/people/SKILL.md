---
name: people
description: Keep a private file on the people Ethan deals with. Use when he asks to add a note about a person, correct something about them, look someone up ("what do I know about Sarah?"), set a follow-up, forget someone, sync his texts or email into their files, review the people queue, or run a sweep.
---

Files live in Supabase and are reached through the `open-brain` MCP tools: `upsert_person`, `add_interaction`, `set_fact`, `get_person`, `search_people`, `forget_person`, `start_sync`, `finish_sync`, `suggest_people`, `resolve_suggestion`, `list_review_queue`, `close_review_item`. Terms are defined in [CONTEXT.md](CONTEXT.md). Settings are in [parameters.md](parameters.md): read it first every run.

Notes, lookups, manual syncs of texts and email, the review queue and sweeps of texts and email work today. If asked to sync meetings or Telegram, say those are not built yet (Milestone 3).

## Adding a note

1. Find the Person with `get_person` by name.
   - `found`: use them.
   - `ambiguous`: ask Ethan which one.
   - `not_found`: ask before creating a File, then `upsert_person` with the name and any identifier he gave.
2. Write the summary yourself: one or two factual sentences of what he told you. Leave out any topic in `avoid_topics`. If the whole note is about a sensitive topic, do not save it and tell him why.
3. `add_interaction` with source `note`, passing `profile_max_words` and `avoid_topics` from parameters.md. Tell him the Profile changed.
4. If he asked for a follow-up, call `upsert_person` with `id`, `follow_up_at` and `follow_up_note`. With no date given, use `default_follow_up_days`.

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
5. Show one numbered batch: each `suggested` and `already_suggested` person with name, identifier, `sent` and `received`, and a one-line reason they cleared the threshold. List each `possible_duplicate` (ask whether it is the same person) and each `conflict` (report, never merge). Give skipped people as counts by reason, without names. Say nothing at all about `excluded`.
6. Apply his answer with `resolve_suggestion`, one call per person. For each approved person, read their messages from this scan and add Interactions as in step 4. A person approved in a later session has no Interactions yet: read their messages back `sync_lookback_days` and add them the same way.
7. Call `finish_sync` with `T`, once steps 4 to 6 succeeded. A sync that failed midway is retried from the same `since`: `source_ref` makes the repeat safe.

## Reviewing the queue

Start every run by calling `list_review_queue`. When something is waiting, say how many items, once, and carry on with what he asked. When he asks to review:

1. Show one numbered batch as in Syncing step 5: each `suggestion` with source, `sent` and `received`; each `possible_duplicate` with the candidates from `candidate_ids` (`get_person` each); each `conflict` with the people in `person_ids`.
2. Apply his answers:
   - `suggestion`: `resolve_suggestion`, which also clears the item. For each approved person, read their messages back `sync_lookback_days` and add Interactions as in Syncing step 4.
   - `possible_duplicate`: same person, then `upsert_person` with that candidate's `id` and the identifiers from `detail`; different person, then `upsert_person` with `confirm_new`. Then `close_review_item`.
   - `conflict`: report it and never merge. `close_review_item` once he has seen it.

## Running a Sweep

A Sweep is a Sync that runs while Ethan is away, so nobody can answer a question. Decide everything the rules decide and leave the rest in the review queue. The sweep is done when both sources have been tried and the summary is written.

For `email`, then `imessage`, follow Syncing steps 1 to 4 and 7, with these changes:

- Step 3: pass `queue_source` (the source name) to `suggest_people`. That is what puts suggestions, possible duplicates and conflicts in the queue.
- Steps 5 and 6 do not run. Nothing is shown to anyone, and no call to `resolve_suggestion`, `close_review_item` or `upsert_person` with `confirm_new` is made.
- A source that fails midway is left without `finish_sync`, so the next sweep retries from the same `since`. Carry on with the other source.

Finish with a summary of counts only: per source, Interactions added, items now in the queue, people skipped by reason, and errors. Names and message text stay out of it.

## Boundaries

- Never send, reply to, draft or label a text or email as part of this skill. Drafting a reply is a separate request Ethan makes explicitly.
- Never store message text word for word. Summaries only.
