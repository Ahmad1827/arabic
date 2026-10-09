#!/usr/bin/env bash
# Installs the app's own Arabic voice: the Piper speech engine and one voice
# model (about 60 MB), into .voice/ inside the project. Run once: npm run setup-voice
set -euo pipefail
cd "$(dirname "$0")/.."

VOICE=ar_JO-kareem-medium
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium

echo "Installing the speech engine..."
python3 -m venv .voice
.voice/bin/pip install --quiet --upgrade pip
.voice/bin/pip install --quiet piper-tts

echo "Downloading the Arabic voice..."
mkdir -p .voice/models
for file in "$VOICE.onnx" "$VOICE.onnx.json"; do
  curl -fL --progress-bar -o ".voice/models/$file" "$BASE/$file"
done

echo "Done. Restart the app to use the voice."
