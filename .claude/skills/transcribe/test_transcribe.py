"""Tests for the pure logic in transcribe.py and relabel.py. No models, no audio, standard library only.

Run: python3 .claude/skills/transcribe/test_transcribe.py
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import relabel
import transcribe


def word(w, s, e):
    return {"w": w, "s": s, "e": e}


def two_speaker_doc():
    words = transcribe.assign_speakers(
        [word("Hi,", 0.0, 0.4), word("I'm", 0.5, 0.7), word("Sarah.", 0.7, 1.2),
         word("Thanks,", 5.0, 5.4), word("Sarah.", 5.4, 5.9)],
        [(0.0, 2.0, "SPEAKER_01"), (4.5, 6.0, "SPEAKER_00")],
    )
    return transcribe.new_document(
        {"title": "Standup", "source": "memo.m4a", "recorded": "2026-09-19",
         "duration_seconds": 6.0, "language": "en"},
        words,
    )


class AssignSpeakers(unittest.TestCase):
    def test_word_takes_the_segment_it_overlaps_most(self):
        words = [word("hello", 1.8, 2.6)]
        out = transcribe.assign_speakers(words, [(0, 2.0, "A"), (2.0, 4.0, "B")])
        self.assertEqual(out[0]["speaker"], "B")

    def test_word_in_a_gap_goes_to_the_nearest_segment(self):
        out = transcribe.assign_speakers([word("um", 4.1, 4.2)], [(0, 1, "A"), (5, 6, "B")])
        self.assertEqual(out[0]["speaker"], "B")

    def test_every_word_gets_a_speaker_even_with_no_segments(self):
        out = transcribe.assign_speakers([word("x", 0, 1)], [])
        self.assertEqual(out[0]["speaker"], "SPEAKER_00")

    def test_a_long_early_segment_still_claims_a_late_word(self):
        segments = [(0, 100, "A"), (10, 11, "B")]
        out = transcribe.assign_speakers([word("late", 90, 91)], segments)
        self.assertEqual(out[0]["speaker"], "A")


class Rendering(unittest.TestCase):
    def test_speakers_are_numbered_by_first_appearance(self):
        doc = two_speaker_doc()
        self.assertEqual(list(doc["speakers"]), ["SPEAKER_01", "SPEAKER_00"])
        md = transcribe.render_markdown(doc)
        self.assertIn("[00:00] Speaker 1: Hi, I'm Sarah.", md)
        self.assertIn("[00:05] Speaker 2: Thanks, Sarah.", md)
        self.assertIn("| Speaker 1 | Unresolved |", md)

    def test_two_speakers_with_one_name_read_as_one_turn(self):
        doc = two_speaker_doc()
        for info in doc["speakers"].values():
            info["name"] = "Sarah"
        turns = transcribe.build_turns(doc["words"], transcribe.speaker_labels(doc))
        self.assertEqual(len(turns), 1)

    def test_hour_long_recordings_show_hours(self):
        self.assertEqual(transcribe.timestamp(3725, hours=True), "1:02:05")
        self.assertEqual(transcribe.timestamp(125, hours=False), "02:05")

    def test_pipes_in_evidence_cannot_break_the_table(self):
        doc = two_speaker_doc()
        doc["speakers"]["SPEAKER_01"] = {"name": "Sarah", "evidence": "said 'a | b'"}
        self.assertIn("said 'a \\| b'", transcribe.speaker_table(doc))


class Files(unittest.TestCase):
    def test_a_second_recording_with_the_same_title_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, _ = transcribe.write_new_document(two_speaker_doc(), Path(tmp))
            second, _ = transcribe.write_new_document(two_speaker_doc(), Path(tmp))
            self.assertNotEqual(first, second)
            self.assertTrue(first.exists() and second.exists())

    def test_slug(self):
        self.assertEqual(transcribe.slug("Ep. 42: Who's Talking?!"), "ep-42-who-s-talking")
        self.assertEqual(transcribe.slug("???"), "recording")


class LongRecordings(unittest.TestCase):
    def test_over_the_limit_waits_for_a_yes(self):
        with self.assertRaises(transcribe.LongRecording) as caught:
            transcribe.check_length(95.4, 60, confirmed=False)
        self.assertEqual(caught.exception.minutes, 95)

    def test_confirmed_or_short_recordings_pass(self):
        transcribe.check_length(95, 60, confirmed=True)
        transcribe.check_length(60, 60, confirmed=False)


class Parameters(unittest.TestCase):
    def test_reads_the_real_parameters_file(self):
        params = transcribe.read_parameters()
        self.assertEqual(params["language"], "en")
        self.assertEqual(params["transcripts_dir"], "~/Documents/transcripts")
        self.assertEqual(float(params["long_recording_minutes"]), 60)

    def test_a_missing_row_says_which(self):
        with self.assertRaises(transcribe.SourceError):
            transcribe.read_parameters()["no_such_setting"]


class Relabel(unittest.TestCase):
    def test_a_name_needs_evidence(self):
        with self.assertRaises(SystemExit):
            relabel.apply_names(two_speaker_doc(), {"1": "Sarah"}, {})

    def test_naming_by_number_with_evidence(self):
        doc = two_speaker_doc()
        relabel.apply_names(doc, {"1": "Sarah"}, {"1": "introduces herself at 00:00"})
        self.assertEqual(doc["speakers"]["SPEAKER_01"]["name"], "Sarah")
        self.assertIn("[00:00] Sarah:", transcribe.render_markdown(doc))

    def test_clearing_a_name_clears_its_evidence(self):
        doc = two_speaker_doc()
        relabel.apply_names(doc, {"1": "Sarah"}, {"1": "said so"})
        relabel.apply_names(doc, {"Sarah": ""}, {})
        self.assertEqual(doc["speakers"]["SPEAKER_01"], {"name": None, "evidence": None})

    def test_unknown_speaker_is_refused(self):
        with self.assertRaises(SystemExit):
            relabel.apply_names(two_speaker_doc(), {"9": "Nobody"}, {"9": "x"})

    def test_saved_json_round_trips_through_the_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, json_path = transcribe.write_new_document(two_speaker_doc(), Path(tmp))
            relabel.main([str(json_path), "2=Ethan", "--evidence", "2=Ethan said so"])
            saved = json.loads(json_path.read_text())
            self.assertEqual(saved["speakers"]["SPEAKER_00"]["name"], "Ethan")
            self.assertIn("Ethan: Thanks, Sarah.", json_path.with_suffix(".md").read_text())


if __name__ == "__main__":
    unittest.main()
