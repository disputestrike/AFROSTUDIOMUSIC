#!/usr/bin/env python3
"""
SYNTHETIC EAR REGRESSION TEST — runs with NO rights-cleared audio, so it can gate CI.

Generates three deterministic genre archetypes (crude DSP stimuli, not real records)
and asserts the ear's three discriminators still fire in the right DIRECTION:
  - tempo within +/-3 BPM of the synthesized tempo,
  - fourOnFloor True/True/False for amapiano/house/afrobeats,
  - logDrumLikelihood(amapiano) strictly greater than house AND afrobeats.

This is a guard against regressions in the detector logic (it caught 5 real bugs:
band-limited onset detection, four-on-floor slot mapping, kick over-suppression,
beat-phase lock on off-beat hats, and the portamento plateau bug). It does NOT
replace the real 9-track acceptance test in eval-ear.ts — synthetic sines are not
real log drums, so it validates DIRECTION, not the calibrated absolute values.

Run: python3 scripts/synth_eartest.py   (needs the DSP stack; the worker image has it)
"""
import os
import sys
import json
import tempfile
import subprocess
import numpy as np

try:
    import soundfile as sf
except Exception as e:  # pragma: no cover
    print(f"DSP stack unavailable ({e}); skipping synthetic ear test.")
    sys.exit(0)

SR = 44100
DUR = 24.0
rng = np.random.default_rng(7)
HERE = os.path.dirname(os.path.abspath(__file__))
ANALYZER = os.path.join(HERE, "..", "analyze_dsp.py")


def _env(length, attack=0.004, decay=0.15):
    e = np.ones(length)
    a = int(attack * SR); d = int(decay * SR)
    if a > 0: e[:a] = np.linspace(0, 1, a)
    if d > 0 and d < length: e[-d:] = np.linspace(1, 0, d)
    return e


def _kick():
    kt = np.arange(int(0.18 * SR)) / SR
    return np.sin(2 * np.pi * 60 * kt) * np.exp(-kt * 30)


def _shaker(dur_s=0.04):
    sh = int(dur_s * SR)
    return np.diff(rng.standard_normal(sh), prepend=0) * _env(sh, 0.001, 0.03)


def render(bpm, kick_slots, bass_mode, hats):
    beat = 60.0 / bpm; sixteenth = beat / 4
    n = int(DUR * SR)
    drums = np.zeros(n); bass = np.zeros(n)
    k = _kick(); kd = len(k)
    nbars = int(DUR / beat) // 4
    for bar in range(nbars):
        for slot in kick_slots:
            si = int(((bar * 4 * beat) + slot * sixteenth) * SR)
            if si + kd < n:
                drums[si:si + kd] += k * 0.9
    if hats == "sixteenth":
        j = 0
        while j * sixteenth < DUR:
            si = int(j * sixteenth * SR); sh = _shaker()
            if si + len(sh) < n: drums[si:si + len(sh)] += sh * 0.06
            j += 1
    elif hats == "offbeat":
        j = 0
        while j * (beat / 2) < DUR:
            if j % 2 == 1:
                si = int(j * (beat / 2) * SR); sh = _shaker(0.06)
                if si + len(sh) < n: drums[si:si + len(sh)] += sh * 0.08
            j += 1
    ndur = int(0.34 * SR); glen = int(0.10 * SR); m = 0
    while m * beat < DUR:
        si = int(m * beat * SR)
        if si + ndur >= n: break
        if bass_mode == "glide":
            f = np.full(ndur, 70.0); f[:glen] = np.linspace(50.0, 70.0, glen)
        elif bass_mode == "pluck":
            f = np.full(ndur, [55.0, 62.0, 58.0, 65.0][m % 4])
        elif bass_mode == "sustain":
            f = np.full(ndur, 55.0)
        else:
            f = None
        if f is not None:
            note = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(ndur, 0.004, 0.30 if bass_mode != "sustain" else 0.05)
            bass[si:si + ndur] += note * 0.8
        m += 1
    nrm = lambda x: (x / (np.max(np.abs(x)) + 1e-9) * 0.9).astype(np.float32)
    return nrm(drums + bass), nrm(drums), nrm(bass)


SPECS = {
    "amapiano": dict(bpm=112, kick_slots={0, 4, 8, 12}, bass_mode="glide", hats="sixteenth"),
    "house": dict(bpm=124, kick_slots={0, 4, 8, 12}, bass_mode="sustain", hats="offbeat"),
    "afrobeats": dict(bpm=105, kick_slots={0, 6, 10}, bass_mode="pluck", hats="sixteenth"),
}
EXPECT_4OTF = {"amapiano": True, "house": True, "afrobeats": False}
EXPECT_TEMPO = {"amapiano": 112, "house": 124, "afrobeats": 105}


def main():
    d = tempfile.mkdtemp(prefix="synth-ear-")
    logdr = {}; ok = True
    print("genre      tempo(exp)   4OTF(exp)     logDrL")
    for name, spec in SPECS.items():
        mix, drums, bass = render(**spec)
        mp = os.path.join(d, f"{name}.wav"); dp = os.path.join(d, f"{name}_d.wav"); bp = os.path.join(d, f"{name}_b.wav")
        sf.write(mp, mix, SR); sf.write(dp, drums, SR); sf.write(bp, bass, SR)
        out = subprocess.run([sys.executable, ANALYZER, mp, "--drums", dp, "--bass", bp], capture_output=True, text=True, timeout=600)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        tempo = res["tempoBpm"].get("value")
        fof = res["fourOnFloor"].get("value")
        ld = res["logDrumLikelihood"].get("value")
        logdr[name] = ld if isinstance(ld, (int, float)) else -1
        tempo_ok = tempo is not None and abs(tempo - EXPECT_TEMPO[name]) <= 3
        fof_ok = fof == EXPECT_4OTF[name]
        ok = ok and tempo_ok and fof_ok
        print(f"{name:10} {str(tempo):>5}({EXPECT_TEMPO[name]})  {str(fof):>5}({EXPECT_4OTF[name]})   {ld}   {'' if tempo_ok and fof_ok else '<-- FAIL'}")
    sep = logdr["amapiano"] - max(logdr["house"], logdr["afrobeats"])
    sep_ok = sep > 0
    ok = ok and sep_ok
    print(f"\nlog-drum separation: amapiano({logdr['amapiano']}) - max(others) = {sep:.3f}  {'OK' if sep_ok else 'FAIL (should be > 0)'}")
    print("\n" + ("PASS: synthetic ear regression OK (direction). Real calibration -> eval-ear.ts." if ok else "FAIL: detector regression."))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
