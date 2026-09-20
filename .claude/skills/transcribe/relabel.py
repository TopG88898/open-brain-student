#!/usr/bin/env python3
"""Change speaker names on a saved transcript. No model runs: the .md is rewritten from the .json.

  relabel.py TRANSCRIPT.json "2=Sarah" --evidence "2=introduces herself at 00:12"
  relabel.py TRANSCRIPT.json "1=Ethan" "2=Sarah" --evidence "1=only voice in a solo memo" --evidence "2=Ethan said so"
  relabel.py TRANSCRIPT.json "2="        # clear the name: back to Speaker 2

A speaker is named by its number in the table ("2" or "Speaker 2"), its raw id, or its current
name. Every name needs a matching --evidence: a name without a reason is refused.
Two speakers given the same name read as one voice.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from transcribe import save_document, speaker_table


def resolve_speaker(doc, ref):
    speakers = doc["speakers"]
    ids = list(speakers)
    ref = ref.strip()
    if ref in speakers:
        return ref
    m = re.fullmatch(r"(?:speaker\s*)?(\d+)", ref, re.I)
    if m and 1 <= int(m.group(1)) <= len(ids):
        return ids[int(m.group(1)) - 1]
    named = [sid for sid, info in speakers.items() if info["name"] and info["name"].lower() == ref.lower()]
    if len(named) == 1:
        return named[0]
    raise SystemExit(f"No single speaker matches '{ref}'. There are {len(ids)}: Speaker 1 to Speaker {len(ids)}.")


def split_pairs(items, what):
    pairs = {}
    for item in items:
        ref, sep, value = item.partition("=")
        if not sep:
            raise SystemExit(f"{what} '{item}' must look like 2=text")
        pairs[ref] = value
    return pairs


def apply_names(doc, assignments, evidence):
    """assignments and evidence map a speaker reference to text. Mutates doc."""
    reasons = {resolve_speaker(doc, ref): text.strip() for ref, text in evidence.items()}
    changes = {resolve_speaker(doc, ref): name.strip() for ref, name in assignments.items()}
    for sid, name in changes.items():
        if name and not reasons.get(sid):
            raise SystemExit(f"Naming a speaker needs evidence: add --evidence \"<number>=<why>\" for {name}.")
    for sid, name in changes.items():
        doc["speakers"][sid] = {"name": name or None, "evidence": reasons[sid] if name else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("transcript", type=Path)
    parser.add_argument("assignments", nargs="+", metavar="N=NAME")
    parser.add_argument("--evidence", action="append", default=[], metavar="N=WHY")
    args = parser.parse_args(argv)

    doc = json.loads(args.transcript.read_text())
    apply_names(doc, split_pairs(args.assignments, "Assignment"), split_pairs(args.evidence, "Evidence"))
    md_path = save_document(doc, args.transcript)
    print(speaker_table(doc))
    print(f"WROTE {md_path}")


if __name__ == "__main__":
    sys.exit(main())
