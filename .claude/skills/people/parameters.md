# People: parameters

Settings the `people` skill reads at run time. Change a value here and the next run uses it.

This file is committed to a public repo. It never holds names, phone numbers, emails or any other identifying data. Exclusions live in the `person_exclusions` table.

| Parameter | Value | Meaning |
| --- | --- | --- |
| `profile_max_words` | 120 | Longest a Person's Profile may be. |
| `avoid_topics` | health, medical, legal, financial, religion | Sensitive topics: never written into an Interaction summary or a Profile. |
| `default_follow_up_days` | 30 | Follow-up date when Ethan asks for one without saying when. |
| `default_country_code` | 1 | Assumed for phone numbers written without one. |
| `suggest_min_messages` | 6 | Fewest messages, in total, before someone is suggested. |
| `suggest_min_each_way` | 2 | Fewest messages required from each side; keeps out one-way senders. |
| `ignore_no_reply_senders` | true | Never suggest no-reply, marketing or automated senders. |
| `sync_lookback_days` | 30 | How far back the first Sync reads. |
| `gmail_query` | `(in:inbox OR in:sent) -category:promotions -category:updates -category:social -category:forums` | Which Gmail a Sync reads: Inbox and Sent, without bulk categories. `after:` is added from the last Sync. |
| `suggest_min_one_on_one_meetings` | 1 | Fewest meetings with only Ethan and them before someone is suggested from meetings. |
| `meeting_max_attendees` | 8 | Meetings with more attendees (counting Ethan) are ignored: no Interactions, no Suggestions. |
| `sweep_schedule` | daily, 07:00 | When the scheduled Sweep runs. Off until manual runs look right. |

## Sources

| Source | Status |
| --- | --- |
| `note` | Active |
| `imessage` | Active (manual Sync) |
| `email` | Active (manual Sync) |
| `meeting` | Active (Granola and Calendar) |
| `telegram` | Active for dictated notes only (`@Name note`); chats are never read |

The bot's own sensitive-topic check (`supabase/functions/_shared/telegram-note.ts`) mirrors `avoid_topics` as word stems. Change both together.
