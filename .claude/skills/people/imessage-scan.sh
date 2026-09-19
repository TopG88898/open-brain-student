#!/bin/sh
# Metadata-only iMessage scan for the people skill (Syncing texts, step 2).
# Usage: imessage-scan.sh <since>   e.g. 2026-08-20T01:44:13.093Z (the `since` from start_sync)
# Prints one tab-separated line per one-to-one conversation:
#   identifier  sent  received  last_message_iso  newest_guid
# Group chats and tapbacks are left out. The message text column is never selected.
# Needs Full Disk Access for the process that runs it.

set -eu

since="${1:?usage: imessage-scan.sh <since ISO 8601 UTC time>}"
case "$since" in
  [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*) ;;
  *) echo "since must be an ISO 8601 time" >&2; exit 2 ;;
esac
case "$since" in
  *[!0-9TZ:.+-]*) echo "since must be an ISO 8601 time" >&2; exit 2 ;;
esac

exec sqlite3 -readonly -separator "$(printf '\t')" "$HOME/Library/Messages/chat.db" "
WITH scan AS (
  SELECT h.id AS identifier,
         m.is_from_me,
         m.date,
         m.guid
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id AND c.style = 45
  JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
  JOIN handle h ON h.ROWID = chj.handle_id
  WHERE m.date > (CAST(strftime('%s', '$since') AS INTEGER) - 978307200) * 1000000000
    AND m.associated_message_type = 0
)
SELECT identifier,
       SUM(is_from_me = 1),
       SUM(is_from_me = 0),
       strftime('%Y-%m-%dT%H:%M:%SZ', MAX(date) / 1000000000 + 978307200, 'unixepoch'),
       (SELECT s2.guid FROM scan s2 WHERE s2.identifier = scan.identifier ORDER BY s2.date DESC LIMIT 1)
FROM scan
GROUP BY identifier
ORDER BY SUM(is_from_me = 1) + SUM(is_from_me = 0) DESC;
"
