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
import hashlib
import hmac
import shutil
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


def _sign_artifact(artifact, key):
    unsigned = dict(artifact)
    unsigned.pop("signature", None)
    unsigned["signatureAlgorithm"] = "hmac-sha256"
    unsigned["signatureKeyId"] = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    canonical = json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    unsigned["signature"] = hmac.new(key.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return unsigned


def _calibration_status(path, key):
    env = os.environ.copy()
    env["LOGDRUM_CALIBRATION_PATH"] = path
    env["LOGDRUM_CALIBRATION_SIGNING_KEY"] = key
    run = subprocess.run(
        [sys.executable, ANALYZER, "--calibration-status"],
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )
    if run.returncode != 0 or not run.stdout.strip():
        raise RuntimeError(f"calibration status failed: {run.stderr[-300:]}")
    return json.loads(run.stdout.strip().splitlines()[-1])


def _truth_gate_regression(directory):
    key = "synthetic-test-signing-key-32-bytes-minimum"
    artifact = {
        "schemaVersion": 4,
        "manifestSchemaVersion": 1,
        "gatesPassed": True,
        "provenance": "real-9track",
        "rightsVerified": True,
        "trackCount": 9,
        "trackIds": [f"track-{index:02d}" for index in range(9)],
        "corpusHash": "a" * 64,
        "genreCounts": {"amapiano": 3, "afrobeats": 3, "house": 3},
        "rightsBasisCounts": {"owned-master": 9, "licensed-evaluation": 0},
        "separationMargin": 0.2,
        "gates": {"tempo": True, "fourOnFloor": True, "logDrumSeparation": True},
        "params": {"r0": 0.45, "s": 0.12, "w1": 1.2, "w2": 0.15, "glideFloor": 0.3},
    }
    signed = _sign_artifact(artifact, key)
    path = os.path.join(directory, "signed-calibration.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(signed, handle, ensure_ascii=False)
    valid = _calibration_status(path, key)
    signed["separationMargin"] = 0.3
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(signed, handle, ensure_ascii=False)
    tampered = _calibration_status(path, key)
    passed = valid.get("calibrated") is True and tampered.get("calibrated") is False and tampered.get("reason") == "invalid-signature"
    print(f"truth-gate signature: {'OK' if passed else 'FAIL'} (valid={valid.get('calibrated')}, tampered={tampered.get('reason')})")
    return passed


def main():
    directory = tempfile.mkdtemp(prefix="synth-ear-")
    logdr = {}
    ok = True
    try:
        print("genre      tempo(exp)   4OTF(exp)     logDrL")
        for name, spec in SPECS.items():
            mix, drums, bass = render(**spec)
            mp = os.path.join(directory, f"{name}.wav")
            dp = os.path.join(directory, f"{name}_d.wav")
            bp = os.path.join(directory, f"{name}_b.wav")
            sf.write(mp, mix, SR)
            sf.write(dp, drums, SR)
            sf.write(bp, bass, SR)
            out = subprocess.run(
                [sys.executable, ANALYZER, mp, "--drums", dp, "--bass", bp],
                capture_output=True,
                text=True,
                timeout=600,
            )
            if out.returncode != 0 or not out.stdout.strip():
                raise RuntimeError(f"analyzer failed for {name}: {out.stderr[-300:]}")
            result = json.loads(out.stdout.strip().splitlines()[-1])
            tempo = result["tempoBpm"].get("value")
            fof = result["fourOnFloor"].get("value")
            likelihood = result["logDrumLikelihood"].get("value")
            logdr[name] = likelihood if isinstance(likelihood, (int, float)) else -1
            tempo_ok = tempo is not None and abs(tempo - EXPECT_TEMPO[name]) <= 3
            fof_ok = fof == EXPECT_4OTF[name]
            ok = ok and tempo_ok and fof_ok
            marker = "" if tempo_ok and fof_ok else "<-- FAIL"
            print(f"{name:10} {str(tempo):>5}({EXPECT_TEMPO[name]})  {str(fof):>5}({EXPECT_4OTF[name]})   {likelihood}   {marker}")

        separation = logdr["amapiano"] - max(logdr["house"], logdr["afrobeats"])
        separation_ok = separation > 0
        ok = ok and separation_ok
        print(f"\nlog-drum separation: amapiano({logdr['amapiano']}) - max(others) = {separation:.3f}  {'OK' if separation_ok else 'FAIL (should be > 0)'}")
        ok = ok and _truth_gate_regression(directory)

        if ok:
            import datetime
            artifact = {
                "schemaVersion": 4,
                "gatesPassed": True,
                "separationMargin": round(float(separation), 3),
                "fittedOn": datetime.date.today().isoformat(),
                "calibratedOn": "synthetic-archetypes",
                "trackCount": 3,
                "provenance": "synthetic",
                "rightsVerified": False,
                "manifestSchemaVersion": None,
                "corpusHash": None,
                "genreCounts": {"amapiano": 1, "afrobeats": 1, "house": 1},
                "rightsBasisCounts": {"owned-master": 0, "licensed-evaluation": 0},
                "note": "Synthetic DSP regression evidence only; it cannot open the measured gate.",
                "params": {"r0": 0.45, "s": 0.12, "w1": 1.2, "w2": 0.15, "glideFloor": 0.3},
            }
            path = os.path.join(HERE, "..", "py", "fixtures", "logdrum_calibration.synthetic.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(artifact, handle, indent=2)
                handle.write("\n")
            print(f"Wrote synthetic diagnostic (never the truth artifact) -> {path}")

        print("\n" + ("PASS: synthetic ear regression and signature gate are sound." if ok else "FAIL: detector or truth-gate regression."))
        sys.exit(0 if ok else 1)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


if __name__ == "__main__":
    main()