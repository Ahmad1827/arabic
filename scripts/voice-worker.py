"""Keeps the Arabic voice loaded and turns text into WAV files on request.

The app's server starts this once and talks to it over stdin/stdout, one JSON
object per line: {"id": 1, "text": "...", "out": "/path/file.wav"}.
"""
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig

voice = PiperVoice.load(sys.argv[1])
config = SynthesisConfig(length_scale=1.15)  # a little slower than normal, for learners
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    request = json.loads(line)
    try:
        with wave.open(request["out"], "wb") as wav_file:
            voice.synthesize_wav(request["text"], wav_file, syn_config=config)
        reply = {"id": request["id"], "ok": True}
    except Exception as error:  # report it and keep serving
        reply = {"id": request["id"], "ok": False, "error": str(error)}
    print(json.dumps(reply), flush=True)
