#!/bin/sh
# One-time setup for the transcribe skill. Ethan runs it in a terminal: it needs him for the
# Hugging Face account and token. Safe to re-run; finished steps are skipped.
#
# It installs ffmpeg, yt-dlp and uv (Homebrew), builds a Python 3.12 environment in
# .claude/skills/transcribe/.venv (gitignored), saves the Hugging Face token to Hugging Face's
# own cache (never into the repo), then downloads both models and proves they load.
# Needs about 5 GB of disk. The first model download is the slow part.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
py="$here/.venv/bin/python"

step() { printf '\n==> %s\n' "$*"; }

command -v brew >/dev/null 2>&1 || {
  echo "Homebrew is required. Install it from https://brew.sh, then run this again." >&2
  exit 1
}

step "1/4  Command-line tools (ffmpeg, yt-dlp, uv)"
for tool in ffmpeg yt-dlp uv; do
  command -v "$tool" >/dev/null 2>&1 || brew install "$tool"
done

step "2/4  Python environment"
# Python 3.12 on purpose: the system Python is too new for the audio libraries' wheels.
[ -x "$py" ] || uv venv --python 3.12 "$here/.venv"
uv pip install --python "$py" -r "$here/requirements.txt"

step "3/4  Hugging Face token"
if "$py" -c 'from huggingface_hub import get_token; raise SystemExit(0 if get_token() else 1)'; then
  echo "A token is already saved."
else
  cat <<'EOF'
The voice model is free but gated: you accept its conditions once, with a Hugging Face account.

  1. Sign in, or create a free account:  https://huggingface.co/join
  2. Open the model page, fill in the short form and accept:
       https://huggingface.co/pyannote/speaker-diarization-community-1
  3. Create a token (type "Read"):  https://huggingface.co/settings/tokens

EOF
  for url in https://huggingface.co/join \
             https://huggingface.co/pyannote/speaker-diarization-community-1 \
             https://huggingface.co/settings/tokens; do
    open "$url" 2>/dev/null || true
  done
  trap 'stty echo 2>/dev/null || true' EXIT INT TERM
  printf 'Paste the token (it will not show as you type): '
  stty -echo
  read -r token
  stty echo
  echo
  [ -n "$token" ] || { echo "No token entered." >&2; exit 1; }
  # Passed by environment, not on the command line, so it never shows in a process list.
  HF_TOKEN_VALUE="$token" "$py" -c \
    'import os; from huggingface_hub import login; login(token=os.environ["HF_TOKEN_VALUE"], add_to_git_credential=False)'
  unset token
fi

step "4/4  Downloading both models and checking they load"
"$py" "$here/transcribe.py" check

step "Done. Ask Claude to transcribe a recording, or run:"
echo "  $py $here/transcribe.py run /path/to/recording.m4a"
