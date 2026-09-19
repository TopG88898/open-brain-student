#!/bin/sh
# Look up contact names for phone numbers in the local Contacts database (read-only).
# Usage: contact-names.sh <phone> [<phone> ...]   e.g. +15551234567
# Prints one tab-separated line per number that has a contact: phone  name
# Numbers with no contact are left out. Matches on the last 10 digits.
# The iMessage connector's search_contacts cannot do this: it only matches names and needs
# the Contacts app running. Needs Full Disk Access for the process that runs it.

set -eu

[ "$#" -gt 0 ] || { echo "usage: contact-names.sh <phone> [<phone> ...]" >&2; exit 2; }

values=""
for n in "$@"; do
  case "$n" in
    +[0-9]*|[0-9]*) ;;
    *) echo "not a phone number: $n" >&2; exit 2 ;;
  esac
  case "$n" in
    *[!0-9+]*) echo "not a phone number: $n" >&2; exit 2 ;;
  esac
  digits=$(printf '%s' "$n" | tr -cd '0-9')
  values="${values}${values:+,}('$n','$(printf '%s' "$digits" | awk '{print substr($0, length($0) - 9)}')')"
done

for db in "$HOME"/Library/Application\ Support/AddressBook/Sources/*/AddressBook-v22.abcddb; do
  [ -f "$db" ] || continue
  sqlite3 -readonly -separator "$(printf '\t')" "$db" "
WITH wanted(phone, last10) AS (VALUES $values),
book AS (
  SELECT r.Z_PK AS owner,
         TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, '')) AS person,
         COALESCE(r.ZORGANIZATION, '') AS org,
         substr(replace(replace(replace(replace(replace(replace(p.ZFULLNUMBER, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''),
                -10) AS last10
  FROM ZABCDPHONENUMBER p
  JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER
)
SELECT DISTINCT w.phone, CASE WHEN b.person <> '' THEN b.person ELSE b.org END
FROM wanted w
JOIN book b ON b.last10 = w.last10
WHERE b.person <> '' OR b.org <> '';
"
done
