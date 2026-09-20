#!/usr/bin/env python3
"""Transcribe a recording and attribute every word to a speaker.

Run with the skill's own environment (see SKILL.md):
  transcribe.py run SOURCE [--language L] [--num-speakers N] [--title T] [--confirmed-long]
  transcribe.py check

SOURCE is a local audio/video file or one http(s) link. `run` writes a .md and a .json
Transcript into transcripts_dir (parameters.md) and prints their paths as `WROTE <path>`.
A recording longer than long_recording_minutes prints `LONG_RECORDING <minutes>` and exits 3
until it is re-run with --confirmed-long.

The two models run in separate child processes (_whisper, _diarize) so the first one's memory
is returned to the OS before the second starts: the target Mac has 8 GB.
"""

import argparse
import bisect
import datetime
import json
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
EXIT_LONG = 3


class SourceError(Exception):
    """Something Ethan can act on; the message is shown to him as written."""


class LongRecording(Exception):
    def __init__(self, minutes):
        super().__init__(minutes)
        self.minutes = minutes


class Params(dict):
    def __missing__(self, key):
        raise SourceError(f"parameters.md has no `{key}` row.")


def read_parameters(path=SKILL_DIR / "parameters.md"):
    params = Params()
    for line in path.read_text().splitlines():
        m = re.match(r"\|\s*`(\w+)`\s*\|\s*([^|]+?)\s*\|", line)
        if m:
            params[m.group(1)] = m.group(2).strip("` ")
    return params


# --- words -> speakers -> turns -> text (pure: no models, no I/O) -------------------------


def assign_speakers(words, segments):
    """Give each word {w, s, e} the speaker whose diarization segment overlaps it most.

    segments is a list of (start, end, speaker). A word in a gap between segments goes to the
    nearest one, so no word is left without a speaker.
    """
    segs = sorted(segments)
    if not segs:
        return [{**w, "speaker": "SPEAKER_00"} for w in words]
    starts = [s for s, _, _ in segs]
    longest = max(e - s for s, e, _ in segs)
    out = []
    for w in words:
        lo = bisect.bisect_left(starts, w["s"] - longest)
        hi = bisect.bisect_right(starts, w["e"])
        best, best_overlap = None, 0.0
        for s, e, speaker in segs[lo:hi]:
            overlap = min(e, w["e"]) - max(s, w["s"])
            if overlap > best_overlap:
                best, best_overlap = speaker, overlap
        if best is None:
            mid = (w["s"] + w["e"]) / 2
            i = bisect.bisect_left(starts, mid)
            near = segs[max(0, i - 8) : i + 8]

            def gap(seg):
                s, e, _ = seg
                return 0.0 if s <= mid <= e else min(abs(mid - s), abs(mid - e))

            best = min(near, key=gap)[2]
        out.append({**w, "speaker": best})
    return out


def new_document(meta, words):
    ids = []
    for w in words:
        if w["speaker"] not in ids:
            ids.append(w["speaker"])
    speakers = {i: {"name": None, "evidence": None} for i in ids}
    return {"version": 1, **meta, "speakers": speakers, "words": words}


def speaker_labels(doc):
    """Speaker id -> what the Transcript calls them: their Name, else Speaker N."""
    return {
        sid: info["name"] or f"Speaker {n}"
        for n, (sid, info) in enumerate(doc["speakers"].items(), 1)
    }


def build_turns(words, labels):
    """Group consecutive words by label, so two speakers given one Name read as one voice."""
    turns = []
    for w in words:
        who = labels[w["speaker"]]
        if turns and turns[-1]["speaker"] == who:
            turns[-1]["end"] = w["e"]
            turns[-1]["text"] += " " + w["w"]
        else:
            turns.append({"speaker": who, "start": w["s"], "end": w["e"], "text": w["w"]})
    return turns


def timestamp(seconds, hours):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if hours else f"{m:02d}:{s:02d}"


def cell(text):
    return (text or "").replace("|", "\\|").replace("\n", " ")


def speaker_table(doc):
    rows = ["| Speaker | Name | Evidence |", "| --- | --- | --- |"]
    for n, info in enumerate(doc["speakers"].values(), 1):
        rows.append(f"| Speaker {n} | {cell(info['name']) or 'Unresolved'} | {cell(info['evidence'])} |")
    return "\n".join(rows)


def render_markdown(doc):
    hours = doc["duration_seconds"] >= 3600
    lines = [
        f"# {doc['title']}",
        "",
        f"- Recorded: {doc['recorded']}",
        f"- Source: {doc['source']}",
        f"- Length: {timestamp(doc['duration_seconds'], hours)}",
        f"- Language: {doc['language']}",
        "",
        speaker_table(doc),
        "",
    ]
    for t in build_turns(doc["words"], speaker_labels(doc)):
        lines += [f"[{timestamp(t['start'], hours)}] {t['speaker']}: {t['text']}", ""]
    return "\n".join(lines)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60].strip("-") or "recording"


def save_document(doc, json_path):
    """Write the .json and the .md rendered from it, side by side."""
    json_path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    md_path = json_path.with_suffix(".md")
    md_path.write_text(render_markdown(doc))
    return md_path


def write_new_document(doc, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{doc['recorded']}-{slug(doc['title'])}"
    stem, n = base, 1
    while (out_dir / f"{stem}.json").exists():
        n += 1
        stem = f"{base}-{n}"
    json_path = out_dir / f"{stem}.json"
    return save_document(doc, json_path), json_path


def check_length(minutes, limit, confirmed):
    if minutes > limit and not confirmed:
        raise LongRecording(round(minutes))


# --- getting the audio ------------------------------------------------------------------


def log(message):
    print(message, file=sys.stderr, flush=True)


def require_tool(name):
    path = shutil.which(name)
    if not path:
        raise SourceError(f"{name} is not installed. Run: sh .claude/skills/transcribe/setup.sh")
    return path


def run_tool(cmd, what):
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = (proc.stderr.strip().splitlines() or ["no output"])[-1]
        raise SourceError(f"{what} failed: {tail}")
    return proc.stdout


def probe_duration(path):
    out = run_tool(
        [require_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        "Reading the recording's length",
    )
    try:
        return float(out.strip())
    except ValueError:
        raise SourceError("That file has no audio I can read.")


def to_wav(src, dst):
    run_tool(
        [require_tool("ffmpeg"), "-nostdin", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(dst)],
        "Converting the audio",
    )


def inspect_url(url):
    out = run_tool(
        [require_tool("yt-dlp"), "--dump-single-json", "--flat-playlist", "--no-warnings", url],
        "Looking up that link",
    )
    meta = json.loads(out)
    if meta.get("_type") in ("playlist", "multi_video"):
        raise SourceError("That link is a playlist or channel. Give me one video or episode.")
    return meta


def download_audio(url, tmp):
    run_tool(
        [require_tool("yt-dlp"), "--no-playlist", "--no-warnings", "-f", "bestaudio/best",
         "-o", str(tmp / "download.%(ext)s"), url],
        "Downloading the audio",
    )
    files = sorted(tmp.glob("download.*"))
    if not files:
        raise SourceError("Downloading the audio failed: nothing was saved.")
    return files[0]


def upload_date(raw):
    try:
        return datetime.datetime.strptime(raw, "%Y%m%d").date().isoformat()
    except (TypeError, ValueError):
        return datetime.date.today().isoformat()


# --- the run ----------------------------------------------------------------------------


def run_stage(name, *args):
    proc = subprocess.run([sys.executable, str(Path(__file__).resolve()), name, *map(str, args)])
    if proc.returncode != 0:
        raise SourceError(f"The {name.lstrip('_')} step failed; the error is above.")


def cmd_run(args):
    params = read_parameters()
    limit = float(params["long_recording_minutes"])
    out_dir = Path(params["transcripts_dir"]).expanduser()
    tmp = Path(tempfile.mkdtemp(prefix="transcribe-"))
    try:
        if re.match(r"https?://", args.source):
            meta = inspect_url(args.source)
            title = args.title or meta.get("title") or "recording"
            recorded = upload_date(meta.get("upload_date"))
            shown_source = args.source
            if meta.get("duration"):
                check_length(meta["duration"] / 60, limit, args.confirmed_long)
            audio = download_audio(args.source, tmp)
        else:
            audio = Path(args.source).expanduser()
            if not audio.is_file():
                raise SourceError(f"There is no file at {args.source}")
            title = args.title or audio.stem
            recorded = datetime.date.fromtimestamp(audio.stat().st_mtime).isoformat()
            shown_source = audio.name
            check_length(probe_duration(audio) / 60, limit, args.confirmed_long)

        wav = tmp / "audio.wav"
        to_wav(audio, wav)
        duration = probe_duration(wav)
        check_length(duration / 60, limit, args.confirmed_long)

        language = args.language or params["language"]
        words_path, segments_path = tmp / "words.json", tmp / "segments.json"
        log("Transcribing. The first run downloads the speech model, so it can take a while.")
        run_stage("_whisper", wav, words_path, params["model"], language)
        log("Working out who speaks when. The first run downloads the voice model.")
        run_stage("_diarize", wav, segments_path, params["diarization_model"],
                  params["diarization_device"], args.num_speakers or 0)

        heard = json.loads(words_path.read_text())
        if not heard["words"]:
            raise SourceError("No speech was found in that recording.")
        segments = [tuple(s) for s in json.loads(segments_path.read_text())]
        doc = new_document(
            {
                "title": title,
                "source": shown_source,
                "recorded": recorded,
                "duration_seconds": round(duration, 1),
                "language": heard.get("language") or language,
                "model": params["model"],
                "diarization_model": params["diarization_model"],
            },
            assign_speakers(heard["words"], segments),
        )
        md_path, json_path = write_new_document(doc, out_dir)
        print(f"WROTE {md_path}")
        print(f"WROTE {json_path}")
        print(f"SPEAKERS {len(doc['speakers'])}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def cmd_check(_args):
    """Prove setup worked: both models load and the Hugging Face token is accepted."""
    params = read_parameters()
    import mlx_whisper  # noqa: F401
    from huggingface_hub import get_token, snapshot_download
    from pyannote.audio import Pipeline

    token = get_token()
    if not token:
        raise SourceError("No Hugging Face token is saved. Run: sh .claude/skills/transcribe/setup.sh")
    log("Fetching the speech model...")
    snapshot_download(params["model"])
    log("Fetching the voice model...")
    Pipeline.from_pretrained(params["diarization_model"], token=token)
    print("OK")


# --- child stages (heavy imports live here so the pure code above stays testable) --------


def stage_whisper(args):
    import mlx_whisper

    options = {"path_or_hf_repo": args.model, "word_timestamps": True, "condition_on_previous_text": False}
    if args.language != "auto":
        options["language"] = args.language
    result = mlx_whisper.transcribe(str(args.wav), **options)
    words = [
        {"w": w["word"].strip(), "s": round(w["start"], 3), "e": round(w["end"], 3)}
        for segment in result["segments"]
        for w in segment.get("words", [])
        if w["word"].strip()
    ]
    Path(args.out).write_text(json.dumps({"language": result.get("language"), "words": words}))


def stage_diarize(args):
    import numpy as np
    import torch
    from huggingface_hub import get_token
    from pyannote.audio import Pipeline

    token = get_token()
    if not token:
        sys.exit("No Hugging Face token is saved. Run: sh .claude/skills/transcribe/setup.sh")
    pipeline = Pipeline.from_pretrained(args.model, token=token)
    pipeline.to(torch.device(args.device))

    # Hand pyannote the waveform: its own file reader needs ffmpeg libraries that Homebrew's
    # newer ffmpeg may not provide.
    with wave.open(str(args.wav)) as f:
        rate, frames = f.getframerate(), f.readframes(f.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    audio = {"waveform": torch.from_numpy(samples).unsqueeze(0), "sample_rate": rate}

    options = {"num_speakers": args.num_speakers} if args.num_speakers else {}
    output = pipeline(audio, **options)
    # The exclusive variant has no overlapping speech, which is what word alignment needs.
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = output.speaker_diarization
    segments = [
        [round(turn.start, 3), round(turn.end, 3), speaker]
        for turn, _, speaker in annotation.itertracks(yield_label=True)
    ]
    Path(args.out).write_text(json.dumps(segments))


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="transcribe one recording")
    run.add_argument("source")
    run.add_argument("--language")
    run.add_argument("--num-speakers", type=int)
    run.add_argument("--title")
    run.add_argument("--confirmed-long", action="store_true")

    sub.add_parser("check", help="verify setup")

    whisper = sub.add_parser("_whisper")
    for name in ("wav", "out", "model", "language"):
        whisper.add_argument(name)

    diarize = sub.add_parser("_diarize")
    for name in ("wav", "out", "model", "device"):
        diarize.add_argument(name)
    diarize.add_argument("num_speakers", type=int)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    handlers = {"run": cmd_run, "check": cmd_check, "_whisper": stage_whisper, "_diarize": stage_diarize}
    try:
        handlers[args.cmd](args)
    except LongRecording as e:
        print(f"LONG_RECORDING {e.minutes}")
        return EXIT_LONG
    except SourceError as e:
        print(f"ERROR {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
