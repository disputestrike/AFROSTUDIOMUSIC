#!/usr/bin/env python3
"""
THE EAR — Phase 0 audio measurement (librosa).

Reads ONE audio file (path passed as argv[1]) and prints ONE JSON object of
measured musical facts to stdout. Every field carries provenance:
  { "value": <T|null>, "source": "measured"|"inferred"|"unknown",
    "confidence": 0..1, "method": "<how>" }

THE HONESTY LAW: a detector reports "measured" ONLY when it actually ran on the
audio. Where a reliable detector does not exist yet (log-drum composite, vocal
sub-analysis — those need the Demucs stems), the field is "unknown" — NEVER a
guess. Any single detector that throws degrades ONLY its own field to "unknown";
the process still prints a valid JSON. If the whole thing fails, it still prints
a valid all-unknown JSON and exits 0 so the Node worker never crashes on it.
"""
import sys, json, warnings
warnings.filterwarnings("ignore")


def M(value, confidence, method):
    return {"value": value, "source": "measured", "confidence": round(float(confidence), 3), "method": method}


def INF(value, method):
    return {"value": value, "source": "inferred", "confidence": 0, "method": method}


def UNK(method="none"):
    return {"value": None, "source": "unknown", "confidence": 0, "method": method}


def safe(fn, method):
    """Run a detector; on any error return an 'unknown' field for it."""
    try:
        return fn()
    except Exception as e:  # noqa
        return UNK(f"{method}:error:{type(e).__name__}")


# Krumhansl-Schmuckler key profiles.
_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def analyze(path):
    import numpy as np
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True)
    out = {}

    dur = float(librosa.get_duration(y=y, sr=sr))
    out["durationS"] = M(round(dur, 2), 0.99, "librosa.get_duration")

    # ---- Tempo + beat grid ----
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, units="time")
    tempo = float(np.atleast_1d(tempo)[0])

    def _tempo():
        # Confidence from beat-interval regularity: tight IBIs => confident grid.
        if len(beats) >= 4:
            ibis = np.diff(beats)
            cv = float(np.std(ibis) / (np.mean(ibis) + 1e-9))
            conf = max(0.0, min(1.0, 1.0 - cv * 3))
        else:
            conf = 0.3
        return M(round(tempo, 1), conf, "librosa.beat.beat_track")
    out["tempoBpm"] = safe(_tempo, "tempo")

    # ---- Key + mode (Krumhansl on mean chroma) ----
    def _key():
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        prof = chroma.mean(axis=1)
        prof = prof / (prof.sum() + 1e-9)
        maj = np.array(_MAJ); mn = np.array(_MIN)
        cors = []
        for i in range(12):
            cors.append(("major", i, float(np.corrcoef(prof, np.roll(maj, i))[0, 1])))
            cors.append(("minor", i, float(np.corrcoef(prof, np.roll(mn, i))[0, 1])))
        cors.sort(key=lambda x: x[2], reverse=True)
        best = cors[0]; second = cors[1]
        conf = max(0.0, min(1.0, (best[2] - second[2]) * 4 + 0.3))
        return best, conf
    keyres = safe(lambda: _key(), "key")
    if isinstance(keyres, tuple):
        (mode, root, _c), conf = keyres
        out["key"] = M(_NOTES[root], conf, "chroma_cqt+krumhansl")
        out["mode"] = M(mode, conf, "chroma_cqt+krumhansl")
    else:
        out["key"] = keyres; out["mode"] = UNK("key:error")

    # 4/4 is the overwhelming default for these genres — honestly INFERRED, not measured.
    out["timeSignature"] = INF("4/4", "genre-default(4/4)")

    # ---- Band-split onsets (kick=low, snare/clap=mid, hat/shaker=high) ----
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    total_energy = float(S.sum()) + 1e-9

    def band(lo, hi):
        idx = np.where((freqs >= lo) & (freqs < hi))[0]
        return S[idx, :] if len(idx) else S[0:1, :] * 0

    low = band(30, 120)      # kick + sub (log drum lives partly here)
    mid = band(200, 2000)    # snare / clap / keys
    high = band(8000, 16000)  # hats / shakers

    def _lowend():
        ratio = float(low.sum()) / total_energy
        return M(round(ratio, 4), 0.8, "stft:30-120Hz/total")
    out["lowEndProfile"] = safe(_lowend, "lowEndProfile")

    hop = 512
    beat_frames = librosa.time_to_frames(beats, sr=sr, hop_length=hop) if len(beats) else np.array([], dtype=int)

    def _four_on_floor():
        # Kick present on ~every beat => low-band onset energy peaks at each beat.
        if len(beat_frames) < 4:
            return UNK("fourOnFloor:too-few-beats")
        low_env = low.sum(axis=0)
        low_env = low_env / (low_env.max() + 1e-9)
        hits = 0
        for bf in beat_frames:
            w = low_env[max(0, bf - 2):bf + 3]
            if len(w) and w.max() > 0.35:
                hits += 1
        frac = hits / len(beat_frames)
        return M(bool(frac >= 0.8), min(1.0, 0.5 + frac / 2), "low-band onset @ beats")
    out["fourOnFloor"] = safe(_four_on_floor, "fourOnFloor")

    def _swing():
        # 16th-note swing: compare energy timing of off-beat 16ths between beats.
        if len(beats) < 4:
            return UNK("swing:too-few-beats")
        ibis = np.diff(beats); ibi = float(np.median(ibis))
        low_env = low.sum(axis=0) + mid.sum(axis=0)
        low_env = low_env / (low_env.max() + 1e-9)
        offsets = []
        for i in range(len(beats) - 1):
            t0 = beats[i]
            # expected straight 16th at +0.25 IBI; find nearest onset peak
            for k in (1, 3):  # the two off-beat 16ths
                exp = t0 + ibi * (k / 4.0)
                fr = int(librosa.time_to_frames(exp, sr=sr, hop_length=hop))
                w = low_env[max(0, fr - 4):fr + 5]
                if len(w):
                    peak = int(np.argmax(w)) - 4
                    offsets.append(peak * hop / sr / ibi)  # as fraction of a beat
        if not offsets:
            return UNK("swing:no-offbeats")
        # Positive late offset on the 2nd/4th 16th => swing. Map to a 50-66% ratio.
        late = float(np.median(offsets))
        pct = max(50.0, min(70.0, 50.0 + late * 200))
        return M(round(pct, 1), 0.5, "16th-onset timing (approx)")
    out["swingRatio"] = safe(_swing, "swing")

    def _microtiming():
        # Mean signed ms offset of each band's onsets vs the nearest beat grid slot.
        if len(beat_frames) < 4:
            return UNK("microtiming:too-few-beats")
        res = {}
        for name, b in (("kick", low), ("snarelap", mid), ("hat", high)):
            env = b.sum(axis=0); env = env / (env.max() + 1e-9)
            peaks = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=3, post_avg=3, delta=0.1, wait=5)
            if len(peaks) == 0:
                continue
            offs = []
            for p in peaks:
                nearest = beat_frames[np.argmin(np.abs(beat_frames - p))]
                offs.append((p - nearest) * hop / sr * 1000.0)  # ms, signed
            if offs:
                res[name] = round(float(np.median(offs)), 1)
        if not res:
            return UNK("microtiming:no-onsets")
        return M(res, 0.45, "band onset vs beat grid (approx, no stems)")
    out["microtiming"] = safe(_microtiming, "microtiming")

    def _syncopation():
        # Energy on off-beats vs on-beats.
        if len(beat_frames) < 4:
            return UNK("syncopation:too-few-beats")
        env = (mid.sum(axis=0) + high.sum(axis=0)); env = env / (env.max() + 1e-9)
        on = float(np.mean([env[bf] for bf in beat_frames if bf < len(env)]))
        offbeat_frames = ((beat_frames[:-1] + beat_frames[1:]) // 2)
        off = float(np.mean([env[bf] for bf in offbeat_frames if bf < len(env)])) if len(offbeat_frames) else 0
        idx = off / (on + off + 1e-9)
        return M(round(idx, 3), 0.5, "off-vs-on-beat energy")
    out["syncopationIndex"] = safe(_syncopation, "syncopation")

    def _shaker():
        # Proportion of 16th slots carrying HF percussive energy.
        if len(beats) < 4:
            return UNK("shaker:too-few-beats")
        ibi = float(np.median(np.diff(beats)))
        henv = high.sum(axis=0); henv = henv / (henv.max() + 1e-9)
        slots = 0; filled = 0
        for i in range(len(beats) - 1):
            for k in range(4):
                t = beats[i] + ibi * (k / 4.0)
                fr = int(librosa.time_to_frames(t, sr=sr, hop_length=hop))
                w = henv[max(0, fr - 2):fr + 3]
                slots += 1
                if len(w) and w.max() > 0.25:
                    filled += 1
        if slots == 0:
            return UNK("shaker:no-slots")
        return M(round(filled / slots, 3), 0.55, "HF energy per 16th slot")
    out["shakerContinuity"] = safe(_shaker, "shaker")

    def _kick_density():
        if len(beats) < 4:
            return UNK("kick:too-few-beats")
        lenv = low.sum(axis=0); lenv = lenv / (lenv.max() + 1e-9)
        peaks = librosa.util.peak_pick(lenv, pre_max=3, post_max=3, pre_avg=3, post_avg=3, delta=0.15, wait=5)
        bars = max(1.0, dur / (float(np.median(np.diff(beats))) * 4))
        return M(round(len(peaks) / bars, 2), 0.5, "low-band onsets per bar")
    out["kickDensity"] = safe(_kick_density, "kickDensity")

    def _clap_backbeat():
        if len(beat_frames) < 4:
            return UNK("clap:too-few-beats")
        menv = mid.sum(axis=0); menv = menv / (menv.max() + 1e-9)
        # beats 2 & 4 (index 1,3 within each group of 4)
        two_four = [beat_frames[i] for i in range(len(beat_frames)) if i % 4 in (1, 3)]
        one_three = [beat_frames[i] for i in range(len(beat_frames)) if i % 4 in (0, 2)]
        e24 = float(np.mean([menv[b] for b in two_four if b < len(menv)])) if two_four else 0
        e13 = float(np.mean([menv[b] for b in one_three if b < len(menv)])) if one_three else 1e-9
        return M(round(e24 / (e13 + 1e-9), 3), 0.4, "mid energy beats2&4 / beats1&3")
    out["clapBackbeat"] = safe(_clap_backbeat, "clapBackbeat")

    def _hat_roll():
        henv = high.sum(axis=0); henv = henv / (henv.max() + 1e-9)
        # bursts of rapid HF onsets = rolls
        peaks = librosa.util.peak_pick(henv, pre_max=2, post_max=2, pre_avg=2, post_avg=2, delta=0.1, wait=1)
        if len(peaks) < 2:
            return M(0.0, 0.4, "HF onset spacing")
        gaps = np.diff(peaks)
        fast = float(np.mean(gaps < 6))  # frames < ~0.14s apart
        return M(round(fast, 3), 0.4, "HF onset spacing")
    out["hatRollPresence"] = safe(_hat_roll, "hatRoll")

    def _harmonic_richness():
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        active = (chroma > (chroma.max() * 0.5)).sum(axis=0)  # active pitch classes per frame
        return M(round(float(active.mean()), 2), 0.5, "active pitch-classes (chroma)")
    out["harmonicRichness"] = safe(_harmonic_richness, "harmonicRichness")

    def _sections():
        # Self-similarity / agglomerative segmentation on MFCC+chroma.
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        bounds = librosa.segment.agglomerative(mfcc, 8)
        times = librosa.frames_to_time(bounds, sr=sr).tolist()
        return M([round(t, 2) for t in times], 0.5, "agglomerative(mfcc)")
    out["sectionBoundaries"] = safe(_sections, "sections")

    def _first_drop():
        # First large sustained jump in low-band energy after the intro.
        lenv = low.sum(axis=0)
        if lenv.max() <= 0:
            return UNK("firstDrop:silent")
        lenv = lenv / lenv.max()
        win = int(sr / hop)  # ~1s
        for i in range(win, len(lenv) - win):
            if lenv[i - win:i].mean() < 0.25 and lenv[i:i + win].mean() > 0.55:
                return M(round(i * hop / sr, 2), 0.45, "low-band energy jump")
        return M(0.0, 0.3, "no clear drop")
    fd = safe(_first_drop, "firstDrop")
    out["firstDropAtS"] = fd

    def _intro_bars():
        if fd.get("source") != "measured" or not len(beats) >= 4:
            return UNK("introBars:needs-drop+tempo")
        barlen = float(np.median(np.diff(beats))) * 4
        return M(round((fd["value"] or 0) / (barlen + 1e-9), 1), 0.4, "firstDrop/barLength")
    out["introLengthBars"] = safe(_intro_bars, "introBars")

    # ---- HONESTLY UNKNOWN at v1 — these need the Demucs stems / a trained detector,
    # not the full mix. Faking them would separate nothing and break the honesty law. ----
    out["logDrumLikelihood"] = UNK("v1:needs-stem-composite(pitched+percussive+sub+portamento)")
    out["vocalPresenceRatio"] = UNK("v1:needs-vocal-stem")
    out["sungVsSpoken"] = UNK("v1:needs-vocal-stem")
    out["adLibDensity"] = UNK("v1:needs-vocal-stem")

    out["engineOk"] = True
    return out


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"engineOk": False, "error": "no audio path"}))
        return
    try:
        res = analyze(sys.argv[1])
    except Exception as e:  # noqa — never crash the caller; emit a valid all-unknown result
        res = {"engineOk": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(res))


if __name__ == "__main__":
    main()
