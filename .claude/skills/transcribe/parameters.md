# Transcribe: parameters

Settings the `transcribe` skill and its scripts read at run time. Change a value here and the next run uses it.

This file is committed to a public repo. It never holds names, usernames, emails or any other identifying data: write paths as `~/...`.

| Parameter | Value | Meaning |
| --- | --- | --- |
| `model` | `mlx-community/whisper-large-v3-turbo` | The Whisper model that turns speech into words. Runs on the Mac's GPU through MLX. |
| `language` | `en` | Language spoken in a Recording. `auto` lets Whisper detect it. A per-run request from Ethan overrides it. |
| `diarization_model` | `pyannote/speaker-diarization-community-1` | The model that tells voices apart. Needs the free Hugging Face token saved by `setup.sh`. |
| `diarization_device` | `cpu` | Where the diarization model runs: `cpu` or `mps`. `cpu` is the safe choice on an 8 GB Mac. |
| `long_recording_minutes` | 60 | A Recording longer than this needs Ethan's yes before it starts. |
| `transcripts_dir` | `~/Documents/transcripts` | Where Transcripts are written. Outside the repo, which is public. |
