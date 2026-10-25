# Generate Tidal Archive's narration from src/audio/narration.json (Kokoro v1.0, Apache-2.0).
# usage: python narrate.py <narration.json> <out dir>
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

spec = json.load(open(sys.argv[1], encoding="utf-8"))
out = sys.argv[2]
v = spec["voice"]
k = Kokoro("kokoro-v1.0.fp16.onnx", "voices-v1.0.bin")
if "blend" in v:
    a, b = v["blend"]
    voice = k.get_voice_style(a) * (1 - v["mix"]) + k.get_voice_style(b) * v["mix"]
else:
    voice = v["name"]

def deepen(audio, f):
    n = int(len(audio) / f)
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)

def trim(audio, sr, pad=0.12):
    # cut leading/trailing silence, keep a short breath of room
    idx = np.where(np.abs(audio) > 0.01)[0]
    if not len(idx):
        return audio
    p = int(pad * sr)
    return audio[max(0, idx[0] - p): min(len(audio), idx[-1] + p)]

durations = {}
for key, text in spec["lines"].items():
    audio, sr = k.create(text, voice=voice, speed=v["speed"], lang=v["lang"])
    audio = trim(deepen(audio, v["deepen"]), sr)
    audio = audio / max(1e-6, np.abs(audio).max()) * 0.89
    sf.write(f"{out}/{key}.mp3", audio, sr, format="MP3")
    durations[key] = round(len(audio) / sr, 2)
    print(f"{key:12s} {durations[key]:5.2f}s")

json.dump(durations, open(f"{out}/durations.json", "w"), indent=1)
