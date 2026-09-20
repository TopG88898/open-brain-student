# Transcribe

A private transcript of a recording that says who spoke each line, made on this Mac. Nothing leaves the machine.

## Language

**Recording**:
One audio or video source Ethan hands over: a voice memo, a meeting recording, a podcast episode or a YouTube video.
_Avoid_: Audio, clip, file

**Transcript**:
The pair of files written for one Recording: a readable `.md` and a `.json` holding every word with its time and Speaker. The `.json` is the source of truth and the `.md` is rendered from it. Both live outside the repo.
_Avoid_: Notes, summary (a summary is what the `people` skill files)

**Speaker**:
One voice the Transcript tells apart. Until it has a Name it shows as Speaker 1, Speaker 2, in order of first appearance.
_Avoid_: Participant, attendee (an attendee is on the invite, a Speaker actually spoke)

**Turn**:
One Speaker's unbroken run of words, with the time it began.
_Avoid_: Segment, line

**Name**:
The person a Speaker is. A Name is set only with Evidence.
_Avoid_: Label, tag

**Evidence**:
The one-line reason a Speaker has a Name, pointing at a moment in the Recording: they introduce themselves, someone addresses them by name, or Ethan said so. A solo voice memo is Evidence that its one Speaker is Ethan. An attendee list narrows the candidates and is Evidence only when one unnamed Speaker and one unnamed attendee are left.
_Avoid_: Confidence, guess

**Unresolved**:
A Speaker with no Name. It stays Speaker N until Ethan or the Recording supplies one; it is never guessed.
_Avoid_: Unknown, anonymous

**Relabel**:
Changing Names on a saved Transcript. It rewrites the files from the saved words and runs no model.
_Avoid_: Redo, re-transcribe

**Long recording**:
A Recording longer than `long_recording_minutes`. It waits for Ethan's yes before it starts.
_Avoid_: Big file

**Filing**:
Offering to turn a named Transcript into Interactions on the Files of the People in it. The `people` skill does the filing, under its own rules.
_Avoid_: Syncing, importing
