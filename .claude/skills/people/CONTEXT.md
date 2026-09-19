# People

A private file on each person Ethan deals with, kept current from his texts, email, meetings and dictated notes.

## Language

**Person**:
Someone who has a File. Only people Ethan has approved get one.
_Avoid_: Contact, lead, client, account

**File**:
Everything held on one Person: their Profile, Facts, Identifiers, Follow-up and Timeline.
_Avoid_: Dossier, record, card

**Identifier**:
A phone number, email address or Telegram handle that belongs to exactly one Person and is how they are recognised across sources. A name is never an Identifier.
_Avoid_: Handle, key, alias (an alias is only a second name for the same Person)

**Interaction**:
One dated entry on a Person's Timeline, written as a short summary, never as the original message text.
_Avoid_: Message, touchpoint, log entry

**Timeline**:
A Person's Interactions in date order.
_Avoid_: History, log, thread

**Note**:
An Interaction Ethan dictated himself. It records what he knows or wants remembered, not something the Person did.
_Avoid_: Memo, comment

**Exchange**:
An Interaction where Ethan and the Person actually communicated: a text, an email, a meeting or a Telegram message. A Note is not an Exchange.
_Avoid_: Contact, touch

**Last contact**:
The date of a Person's most recent Exchange.
_Avoid_: Last seen, last active

**Fact**:
One current, labelled claim about a Person, such as their employer or city.
_Avoid_: Attribute, field, detail

**Superseded**:
A Fact that a correction replaced. It stays in the File as history and is never used in the Profile.
_Avoid_: Deleted, overwritten, stale

**Profile**:
The short running summary of a Person, regenerated from their current Facts and Timeline. It is never edited by hand.
_Avoid_: Bio, description

**Follow-up**:
A date and a reason to reach out to a Person.
_Avoid_: Reminder, task, to-do

## Deciding who gets a File

**Suggestion**:
A candidate Person the sweep proposes and Ethan approves or rejects. Nobody gets a File without approval.
_Avoid_: Auto-add, lead

**Dismissed**:
A Suggestion Ethan turned down. It is remembered so it is never suggested again, but it is not an Exclusion: they simply get no File. Approving a dismissed Person later is allowed.
_Avoid_: Rejected, blocked, ignored

**Relevance threshold**:
The minimum amount of two-way communication before someone is worth suggesting: messages sent each way, or one-on-one meetings.
_Avoid_: Score, priority

**One-on-one**:
A meeting with only Ethan and one other Person. Attending one makes someone worth suggesting; a group meeting alone does not.
_Avoid_: 1:1 meeting, catch-up

**Possible duplicate**:
A new Person whose name matches an existing Person but who shares no Identifier with them. It is never merged automatically; Ethan decides.
_Avoid_: Match, conflict

**Conflict**:
Identifiers that belong to two different existing Persons, which would require merging them. It is reported and never resolved automatically.
_Avoid_: Duplicate

**Unmatched note**:
A Note Ethan dictated in Telegram that the bot could not file on exactly one approved Person: no File has that name, several do, or the Person is not approved yet. It waits in the Review queue with his words, and is filed once he says whose it is.
_Avoid_: Orphan note, pending note

## Keeping people out

**Exclusion**:
A phone number, email, handle, name or domain that is never read, summarized or suggested.
_Avoid_: Blocklist, blacklist, ignore list

**Sensitive topic**:
A subject, such as health, legal or financial matters, that is never written into any summary, even for an approved Person.
_Avoid_: Private topic, restricted content

**Forget**:
Permanently delete a Person's File and add them to the Exclusions. It cannot be undone.
_Avoid_: Archive, remove, soft delete

## Keeping files current

**Sync**:
Reading new texts, email and meetings and adding Interactions for the People who have Files, then proposing Suggestions. Each source remembers where its last Sync finished, so the next one reads only what is new.
_Avoid_: Import, refresh

**Sweep**:
A Sync that runs on a schedule instead of on request. Nobody is there to answer, so it leaves what needs Ethan's decision in the Review queue.
_Avoid_: Job, cron

**Review queue**:
What a Sweep or the Telegram bot left for Ethan: new Suggestions, Possible duplicates, Conflicts and Unmatched notes. Each item goes when he decides it, and nothing in the queue is applied without his answer.
_Avoid_: Inbox, backlog, to-do
