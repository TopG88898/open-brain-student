---
name: transcribe
description: Transcribe a recording and say who spoke each line. Use for a voice memo, meeting recording, podcast episode or YouTube video Ethan wants transcribed, for "who said what" or "who was speaking", for correcting a speaker's name in a saved transcript, or for setting the skill up.
---

Claude cannot hear audio. `transcribe.py` listens on this Mac (Whisper for the words, pyannote for the voices) and writes a Transcript; this skill names the voices from what was said. Terms are defined in [CONTEXT.md](CONTEXT.md). Settings are in [parameters.md](parameters.md): read it first every run.

Run the scripts with the skill's own environment. Below, `PY` is `.claude/skills/transcribe/.venv/bin/python`.

## Setting up

Without `.venv`, or when a run reports a missing tool or token, tell Ethan to run `sh .claude/skills/transcribe/setup.sh` in a terminal. It needs him for a Hugging Face account and token, so only he can finish it. Setup is done when its last step prints `OK`.

## Transcribing

1. Take the Recording from Ethan: a file path, or one link.
   - Links: a YouTube video, a direct audio link, or one podcast episode page. A playlist or channel gets one episode asked back. A link behind a login or DRM (Spotify, paid feeds) gets "I can't fetch that", and Ethan supplies the audio file.
   - Note what he says about it: who was in it, how many voices, the language.
2. Run `PY .claude/skills/transcribe/transcribe.py run "<source>"`. Add `--num-speakers N` when he states the count, `--language xx` when he names one other than `language`, `--title "..."` when the file name would make a poor title. Ignore attendee counts for the count.
   - Exit 3 with `LONG_RECORDING <minutes>`: tell him the length and that it will take a while, and ask. On a yes, re-run with `--confirmed-long` in the background and report when it finishes.
   - Any other failure: give him the `ERROR` line in one sentence and stop.

   Done when the run has printed `WROTE` for the `.md` and the `.json`.
3. Name the Speakers. Read the `.md`, then look for Evidence for each Speaker:
   - **Introduces themself** ("I'm Sarah") names the Speaker of that line.
   - **Addressed by name** ("thanks, Sarah") names the Speaker who answers next. The one talking is someone else.
   - **Solo voice memo**: its one Speaker is Ethan.
   - **Meeting attendees** (Calendar or Granola) narrow the candidates. Name a Speaker from the list only when exactly one unnamed Speaker and one unnamed attendee remain.
   - **Ethan says so.**

   Apply each Name with `PY .claude/skills/transcribe/relabel.py <transcript.json> "<n>=<Name>" --evidence "<n>=<the moment, with its timestamp>"`. Two Speakers that are plainly one voice split apart get the same Name. Every Speaker without Evidence stays Unresolved.
4. Ask Ethan once. Show the Speaker, Name and Evidence table, and for each Unresolved Speaker give the timestamp and a line or two he can recognise them by. Apply his answers with `relabel.py`, evidence "Ethan said so". A Speaker he says to leave stays Speaker N.

   Done when every Speaker has a Name or Ethan has said to leave it.
5. Offer Filing in one line: the named People could each get an Interaction on their File. On a yes, hand over to the `people` skill and follow its summary and `avoid_topics` rules; the Interaction is a summary, never transcript text. Without a yes, file nothing.

Give Ethan the path of the `.md` when you finish.

## Correcting a name

`relabel.py` with the `.json` path from the run, or the one found by title in `transcripts_dir`. It rewrites both files from the saved words, so a correction takes seconds. Evidence is required for every Name, so a correction Ethan makes is "Ethan said so". `"<n>="` with no name clears a Name back to Speaker N.

## Boundaries

- Transcripts stay in `transcripts_dir`, outside this public repo. Everything read from one stays in the conversation: nothing goes into the repo, a thought, or a Person's File except an Interaction summary Ethan approved.
- Original recordings are read only: never moved, edited or deleted.
- Names come from Evidence. A Speaker who fits no Evidence stays Speaker N.
