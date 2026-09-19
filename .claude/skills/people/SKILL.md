---
name: people
description: Keep a private file on the people Ethan deals with. Use when he asks to add a note about a person, correct something about them, look someone up ("what do I know about Sarah?"), set a follow-up, forget someone, or sync his texts or email into their files.
---

Files live in Supabase and are reached through the `open-brain` MCP tools: `upsert_person`, `add_interaction`, `set_fact`, `get_person`, `search_people`, `forget_person`, `start_sync`, `finish_sync`, `suggest_people`, `resolve_suggestion`. Terms are defined in [CONTEXT.md](CONTEXT.md). Settings are in [parameters.md](parameters.md): read it first every run.

Notes, lookups, and manual syncs of texts and email work today. If asked to sync meetings or Telegram, or to run a sweep, say those are not built yet (Milestone 3).

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

## Boundaries

- Never send, reply to, draft or label a text or email as part of this skill. Drafting a reply is a separate request Ethan makes explicitly.
- Never store message text word for word. Summaries only.
