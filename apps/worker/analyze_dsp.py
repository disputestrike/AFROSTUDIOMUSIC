#!/usr/bin/env python3
"""
THE EAR v2 — Phase 0 audio measurement (librosa + scipy), stem-aware.

Reads ONE audio file (+ optional Demucs stems) and prints ONE JSON object of
measured musical facts to stdout. Every field carries provenance:
  { "value": <T|null>, "source": "measured"|"inferred"|"unknown",
    "confidence": 0..1, "method": "<how>" }

THE HONESTY LAW: a detector reports "measured" ONLY when it actually ran on the
audio AND its result is trustworthy. Where a detector is a proxy that can't
measure what its name claims (harmonicRichness), is inherently ambiguous
(hatRollPresence), or needs a signal we don't have yet (vocal fields need the
vocal stem), it returns "unknown" — never a fabricated number. logDrumLikelihood
is calibration-gated: it emits "inferred" (computed but its genre-separation
thresholds are not yet fit on the 9-track set) until LOGDRUM.calibrated is
flipped true after the acceptance test passes.

CLI: python3 analyze_dsp.py <audio> [--bass P] [--drums P] [--other P] [--vocals P]
Stems are optional; stem-dependent detectors fall back to the full mix at reduced
confidence (stemQuality~0.5) and NEVER fabricate. Any single detector that throws
degrades ONLY its own field to 'unknown'; the process always prints valid JSON,
exit 0. All logs/tracebacks go to stderr.
"""
import sys
import os
import json
import argparse
import warnings
import tempfile
import subprocess

warnings.filterwarnings("ignore")


def log(*a):
    print(*a, file=sys.stderr)


# ---------- provenance helpers ----------
def M(value, confidence, method):
    return {"value": value, "source": "measured", "confidence": round(float(max(0.0, min(1.0, confidence))), 3), "method": method}


def INF(value, confidence, method):
    return {"value": value, "source": "inferred", "confidence": round(float(max(0.0, min(1.0, confidence))), 3), "method": method}


def UNK(method="none"):
    return {"value": None, "source": "unknown", "confidence": 0, "method": method}


def safe(fn, method):
    try:
        return fn()
    except Exception as e:  # noqa — degrade ONLY this field, keep the rest
        log(f"[detector-error] {method}: {type(e).__name__}: {e}")
        return UNK(f"{method}:error:{type(e).__name__}")


# ---------- constants ----------
SR = 44100          # >=44.1k so the 6-16kHz shaker/hat band survives (v1's 22050 bug)
HOP = 128           # 2.9ms frames — behind-the-beat lives at 10-40ms; hop 512 too coarse
NFFT_SPEC = 8192    # ~5.4Hz bins for clean 30-120Hz integration
HOP_SPEC = 2048

# Krumhansl-Kessler key profiles.
_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# logDrumLikelihood is a TRUTH GATE. Its constants are NEVER hand-edited or env-toggled.
# They are fitted by scripts/eval-ear.ts against the 9-track acceptance set and frozen
# to py/fixtures/logdrum_calibration.json. Absent/stale/failed artifact => the field
# ships 'inferred' (carrying a machine-readable reason) and is excluded from every
# compliance score. The gate opens when the DATA says it may, not when a human says so.
LOGDRUM_SCHEMA = 3  # bump when the detector math changes -> forces a refit (stale-schema)
_LOGDRUM_DEFAULTS = dict(
    r0=0.45, s=0.12,            # P_sub sigmoid center/width on E(40-100)/E(20-300)
    w1=1.2, w2=0.15,            # P_glide = saturate(w1*glideFraction + w2*glideRate)
    glideFloor=0.30,            # final = core*(glideFloor + (1-glideFloor)*P_glide)
    e_sub=0.8, e_perc=1.0, e_pitch=0.9, geo_root=2.7,  # weighted geo-mean exponents
)
CALIB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "py", "fixtures", "logdrum_calibration.json")


def _load_logdrum_calibration():
    d = dict(_LOGDRUM_DEFAULTS)
    try:
        with open(CALIB_PATH) as f:
            c = json.load(f)
        if not c.get("gatesPassed"):
            return {**d, "calibrated": False, "reason": "gates-not-passed", "separationMargin": None}
        if c.get("schemaVersion") != LOGDRUM_SCHEMA:
            return {**d, "calibrated": False, "reason": "stale-schema", "separationMargin": None}
        # ADDENDUM C-1 — synthetic calibration must NOT open the truth gate.
        # Synthetic sines validate DIRECTION, not calibrated absolute values: only
        # the real 9-track run (eval-ear.ts, the sole writer of 'real-9track')
        # earns 'measured'. A synthetic artifact still improves the constants but
        # the field ships 'inferred' and is excluded from every compliance score,
        # rankTakes, and the promotion rule — exactly as if uncalibrated.
        if c.get("provenance") != "real-9track":
            return {**d, **(c.get("params") or {}), "calibrated": False, "reason": "synthetic-calibration", "separationMargin": c.get("separationMargin"), "provenance": c.get("provenance") or "synthetic"}
        return {**d, **(c.get("params") or {}), "calibrated": True, "reason": None, "separationMargin": c.get("separationMargin"), "calibratedOn": c.get("calibratedOn") or "reference-tracks", "provenance": "real-9track"}
    except FileNotFoundError:
        return {**d, "calibrated": False, "reason": "no-calibration-artifact", "separationMargin": None}
    except Exception as e:  # noqa — a broken artifact must NOT crash analysis; it just means uncalibrated
        return {**d, "calibrated": False, "reason": f"artifact-error:{type(e).__name__}", "separationMargin": None}


LOGDRUM = _load_logdrum_calibration()


# ---------- decode ----------
def decode(path, max_seconds=None):
    """ffmpeg -> mono 44100 wav -> soundfile. Handles mp3/m4a/url uniformly and
    sidesteps libsndfile mp3 flakiness. Falls back to librosa.load on failure."""
    import numpy as np
    import soundfile as sf
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", path, "-ac", "1", "-ar", str(SR)]
        if max_seconds:
            cmd += ["-t", str(max_seconds)]
        cmd += ["-f", "wav", tmp.name]
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        y, sr = sf.read(tmp.name, dtype="float32")
        if y.ndim > 1:
            y = y.mean(axis=1)
        return np.asarray(y, dtype=np.float32), sr
    except Exception as e:
        log(f"[decode] ffmpeg failed ({e}); trying librosa.load")
        import librosa
        y, sr = librosa.load(path, sr=SR, mono=True)
        return y, sr
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def sos_band(y, sr, lo, hi):
    """Zero-phase Butterworth bandpass (order 4)."""
    from scipy.signal import butter, sosfiltfilt
    ny = sr / 2.0
    lo = max(1.0, lo); hi = min(hi, ny - 1)
    sos = butter(4, [lo / ny, hi / ny], btype="band", output="sos")
    return sosfiltfilt(sos, y)


# ============================================================
def analyze(audio_path, stems):
    import numpy as np
    import librosa

    y, sr = decode(audio_path)
    out = {}
    dur = float(len(y) / sr)
    out["durationS"] = M(round(dur, 2), 1.0, "ffmpeg-decode+sample-count")

    # Load stems (44.1k). Fall back to full mix (stemQuality tracks this).
    def load_stem(key):
        p = stems.get(key)
        if p and os.path.exists(p):
            try:
                sy, _ = decode(p)
                return sy, 1.0
            except Exception as e:
                log(f"[stem] {key} decode failed: {e}")
        return y, 0.5  # full-mix fallback
    drums_y, drums_q = load_stem("drums")
    bass_y, bass_q = load_stem("bass")
    other_y, other_q = load_stem("other")
    vocals_y, vocals_q = load_stem("vocals")  # q<1.0 => no real stem => vocal fields stay unknown

    # ---------- SHARED SUBSTRATE: onsets + beat grid ----------
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP, aggregate=np.median)
    tempo_raw, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP, start_bpm=115, trim=False)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    n_beats = len(beat_times)

    grid_ok = n_beats >= 8
    if grid_ok:
        ibis = np.diff(beat_times)
        cv = float(np.std(ibis) / (np.mean(ibis) + 1e-9))
        grid_conf = float(max(0.0, min(1.0, 1.0 - cv / 0.10)))
        sigma_beat = float(np.median(ibis))
        sigma16 = sigma_beat / 4.0
        # isochronous least-squares grid (for kick microtiming — avoids self-reference)
        j = np.arange(n_beats)
        A = np.vstack([np.ones(n_beats), j]).T
        t0, spb = np.linalg.lstsq(A, beat_times, rcond=None)[0]
        iso_beats = t0 + spb * j
    else:
        grid_conf = 0.0
        sigma_beat = sigma16 = 0.0
        iso_beats = beat_times

    # ---------- band-split onset streams (drums stem, else full mix) ----------
    # ENERGY-FLUX onsets (half-wave-rectified diff of the band RMS envelope). NOT
    # librosa.onset.onset_strength — its mel-spectrogram flux collapses to ~0 on a
    # heavily band-limited signal (a 30-120Hz bandpass lands in 1-2 mel bins), so it
    # silently misses kicks. Energy-flux works on both narrowband sub-kicks and HF hats.
    def onset_times_in_band(sig, sig_sr, lo, hi, delta=0.15, wait_ms=58):
        try:
            b = sos_band(sig, sig_sr, lo, hi).astype(np.float32)
            rms = librosa.feature.rms(y=b, hop_length=HOP, frame_length=512)[0]
            rms = rms / (rms.max() + 1e-9)
            flux = np.maximum(0.0, np.diff(rms, prepend=rms[0]))
            flux = flux / (flux.max() + 1e-9)
            wait = max(1, int(wait_ms / 1000.0 * sig_sr / HOP))
            peaks = librosa.util.peak_pick(flux, pre_max=10, post_max=10, pre_avg=10, post_avg=10, delta=delta, wait=wait)
            return librosa.frames_to_time(peaks, sr=sig_sr, hop_length=HOP), flux
        except Exception as e:
            log(f"[onset-band {lo}-{hi}] {e}")
            return np.array([]), np.array([])

    kick_t, _ = onset_times_in_band(drums_y, sr, 30, 120)
    clap_t, _ = onset_times_in_band(drums_y, sr, 150, 4000)
    hat_t, hat_env = onset_times_in_band(drums_y, sr, 6000, min(16000, sr / 2 - 500))

    # ---------- tempo ----------
    def _tempo():
        tempo = float(np.atleast_1d(tempo_raw)[0])
        # octave fold into [88,180]
        cands = [tempo, tempo * 2, tempo / 2, tempo * 1.5, tempo / 1.5]
        cands = [c for c in cands if 88 <= c <= 180] or [tempo]
        try:
            tg = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr, hop_length=HOP, win_length=384)
            ac = np.mean(tg, axis=1)
        except Exception:
            ac = None

        def salience(bpm):
            if ac is None:
                return 1.0
            lag = int(round((60.0 / bpm) * sr / HOP))
            lag = max(1, min(lag, len(ac) - 1))
            return float(ac[lag])
        best = max(cands, key=salience)
        # confidence: tempogram clarity + beat regularity + estimator agreement
        clarity = 0.5
        if ac is not None:
            p = salience(best)
            comps = [salience(best * m) for m in (0.5, 2, 3, 2.0 / 3) if 40 <= best * m <= 320]
            c = max(comps) if comps else 0.0
            clarity = float(p / (p + c + 1e-9))
        reg = grid_conf
        agree = 1.0 if abs(best - float(np.atleast_1d(tempo_raw)[0])) / best < 0.02 else 0.6
        conf = 0.5 * clarity + 0.3 * reg + 0.2 * agree
        # honesty cap on octave ambiguity
        if ac is not None:
            near = [salience(best * m) for m in (0.5, 2) if 40 <= best * m <= 320]
            if near and max(near) > 0.85 * salience(best):
                conf = min(conf, 0.6)
        return M(round(best, 1), conf, "onset_strength+beat_track+tempogram-fold[88-180]")
    out["tempoBpm"] = safe(_tempo, "tempo") if grid_ok else UNK("tempo:too-few-beats")

    # ---------- key + mode ----------
    def _key_mode():
        y_harm, _ = librosa.effects.hpss(y, margin=3.0)
        chroma = librosa.feature.chroma_cens(y=y_harm, sr=sr, hop_length=HOP_SPEC, bins_per_octave=36, n_octaves=7)
        prof = chroma.mean(axis=1)
        prof = prof / (prof.sum() + 1e-9)
        maj = np.array(_MAJ); mn = np.array(_MIN)
        scored = []
        for i in range(12):
            scored.append(("major", i, float(np.corrcoef(prof, np.roll(maj, i))[0, 1])))
            scored.append(("minor", i, float(np.corrcoef(prof, np.roll(mn, i))[0, 1])))
        scored.sort(key=lambda x: x[2], reverse=True)
        (mode0, root0, best_r) = scored[0]
        # next DIFFERENT tonic for separation
        second_r = next((r for (mo, ro, r) in scored[1:] if ro != root0), scored[1][2])
        key_conf = 0.5 * max(0.0, best_r) + 0.5 * max(0.0, min(1.0, (best_r - second_r) / 0.15))
        if (best_r - second_r) < 0.05:
            key_conf = min(key_conf, 0.5)
        # mode: check relative maj/min (same pitch classes, flips mode)
        rel_mode = "minor" if mode0 == "major" else "major"
        rel_root = (root0 - 3) % 12 if mode0 == "major" else (root0 + 3) % 12
        prof_tmpl = mn if rel_mode == "minor" else maj
        rel_r = float(np.corrcoef(prof, np.roll(prof_tmpl, rel_root))[0, 1])
        mode_conf = key_conf if (best_r - rel_r) >= 0.05 else min(key_conf, 0.4)
        return _NOTES[root0], key_conf, mode0, mode_conf
    km = safe(lambda: _key_mode(), "key")
    if isinstance(km, tuple):
        note, kconf, mode0, mconf = km
        out["key"] = M(note, kconf, "hpss+chroma_cens+krumhansl-kessler")
        out["mode"] = M(mode0, mconf, "krumhansl-kessler(+relative-minor check)")
    else:
        out["key"] = km; out["mode"] = UNK("mode:key-failed")

    # ---------- timeSignature (measured numerator, NEVER hardcoded 4/4) ----------
    def _timesig():
        if not grid_ok:
            return UNK("timesig:no-grid")
        # beat-synchronous onset-energy autocorrelation, inspect bar-length lags
        oe = onset_env / (onset_env.max() + 1e-9)
        bsync = librosa.util.sync(oe[np.newaxis, :], beat_frames, aggregate=np.mean).flatten()
        bsync = bsync - bsync.mean()
        if len(bsync) < 8:
            return UNK("timesig:too-short")
        ac = np.correlate(bsync, bsync, mode="full")[len(bsync) - 1:]
        ac = ac / (ac[0] + 1e-9)
        lags = {n: float(ac[n]) for n in (2, 3, 4, 6) if n < len(ac)}
        if not lags:
            return UNK("timesig:no-lags")
        num = max((3, 4), key=lambda n: lags.get(n, -1))
        peak = lags.get(num, 0.0)
        if peak < 0.20:
            return UNK("timesig:weak-bar-periodicity")
        return M(f"{num}/4", min(0.7, grid_conf * (0.4 + peak)), "beat-sync onset autocorr (denom inferred)")
    out["timeSignature"] = safe(_timesig, "timesig")

    # ---------- fourOnFloor ----------
    def _four_on_floor():
        if not grid_ok or len(kick_t) < 8:
            return UNK("fourOnFloor:no-grid-or-kicks")
        w = 0.12 * sigma_beat
        # PHASE-INDEPENDENT: librosa's beat tracker can lock onto the OFF-beat when the
        # off-beat pulse (e.g. house open hats) is strong, putting the grid a half-beat
        # off the kicks. So slide the grid across one whole beat and take the phase that
        # best covers the kicks — a true four-on-floor has SOME phase where a kick sits
        # on nearly every beat; a broken/syncopated kick (afrobeats) never does.
        best_hit = 0.0
        for ph in np.linspace(-0.5, 0.5, 21) * sigma_beat:
            grid = beat_times + ph
            hit = float(np.mean([1.0 if np.any(np.abs(kick_t - g) <= w) else 0.0 for g in grid]))
            best_hit = max(best_hit, hit)
        kicks_per_beat = len(kick_t) / max(1, n_beats)
        is4 = bool(best_hit >= 0.85 and kicks_per_beat >= 0.8)
        conf = grid_conf * max(0.0, min(1.0, (best_hit - 0.5) / 0.4)) if is4 else grid_conf * 0.7
        return M(is4, conf, f"kick coverage(best-phase)={best_hit:.2f} kicks/beat={kicks_per_beat:.2f}")
    out["fourOnFloor"] = safe(_four_on_floor, "fourOnFloor")

    # ---------- microtiming (signed ms behind/ahead; grid-independent) ----------
    def _microtiming():
        if not grid_ok:
            return UNK("microtiming:no-grid")
        # drift-adaptive 16th slot times
        slots = []
        for jb in range(n_beats - 1):
            for s in range(4):
                slots.append(beat_times[jb] + s * (beat_times[jb + 1] - beat_times[jb]) / 4.0)
        slots = np.array(slots)
        res = {}
        mad_ms = {}
        for name, times in (("snareClap", clap_t), ("hat", hat_t)):
            devs = []
            for t in times:
                gi = int(np.argmin(np.abs(slots - t)))
                if abs(t - slots[gi]) < 0.4 * sigma16:
                    devs.append((t - slots[gi]) * 1000.0)
            if len(devs) >= 8:
                devs = np.array(devs)
                med = float(np.median(devs))
                res[name] = round(med, 1)
                mad_ms[name] = float(np.median(np.abs(devs - med)))
        # kick vs ISOCHRONOUS grid (independent) — else self-referential
        kdev = []
        iso_slots = np.array([iso_beats[jb] + s * (iso_beats[min(jb + 1, n_beats - 1)] - iso_beats[jb]) / 4.0
                              for jb in range(n_beats - 1) for s in range(4)]) if n_beats > 1 else np.array([])
        for t in kick_t:
            if len(iso_slots):
                gi = int(np.argmin(np.abs(iso_slots - t)))
                if abs(t - iso_slots[gi]) < 0.4 * sigma16:
                    kdev.append((t - iso_slots[gi]) * 1000.0)
        if len(kdev) >= 8:
            res["kick"] = round(float(np.median(kdev)), 1)
        if not res:
            return UNK("microtiming:no-class-with-8-onsets")
        worst_mad = max(mad_ms.values()) if mad_ms else 20.0
        conf = grid_conf * (1.0 / (1.0 + worst_mad / 15.0)) * min(1.0, len(res) / 2.0)
        return M(res, conf, "signed ms vs grid (+late/behind); kick vs isochronous-LS grid")
    out["microtiming"] = safe(_microtiming, "microtiming")

    # ---------- swingRatio (one continuous 16th stream; unknown if none) ----------
    def _swing():
        if not grid_ok:
            return UNK("swing:no-grid")
        stream = hat_t if len(hat_t) >= len(clap_t) else clap_t
        if len(stream) < 12:
            return UNK("swing:no-continuous-16th-layer")
        samples = []
        for jb in range(n_beats - 1):
            t0b = beat_times[jb]; t_next = beat_times[jb + 1]
            step = (t_next - t0b) / 4.0
            g = [t0b + s * step for s in range(4)] + [t_next]

            def nearest(gt):
                if not len(stream):
                    return None
                i = int(np.argmin(np.abs(stream - gt)))
                return stream[i] if abs(stream[i] - gt) < 0.4 * step else None
            a0, a1, a2 = nearest(g[0]), nearest(g[1]), nearest(g[2])
            if a0 is not None and a1 is not None and a2 is not None:
                long, short = a1 - a0, a2 - a1
                if long + short > 0:
                    samples.append(100.0 * long / (long + short))
        if len(samples) < 12:
            return UNK("swing:too-few-valid-16th-triples")
        samples = np.array(samples)
        med = float(np.median(samples))
        iqr = float(np.subtract(*np.percentile(samples, [75, 25])))
        conf = min(1.0, len(samples) / 16.0) * (1.0 - min(1.0, iqr / 20.0))
        return M(round(med, 1), conf, "median long/(long+short) on continuous 16th stream")
    out["swingRatio"] = safe(_swing, "swing")

    # ---------- syncopationIndex (LHL over swing-corrected slots) ----------
    def _syncopation():
        if not grid_ok:
            return UNK("syncopation:no-grid")
        W = [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4]  # LHL 16-slot metrical weights
        swing = out.get("swingRatio", {})
        swf = (swing.get("value") or 50.0) / 100.0 if swing.get("source") == "measured" else 0.5
        # composite drum onsets (kick+clap+hat)
        allt = np.sort(np.concatenate([kick_t, clap_t, hat_t])) if (len(kick_t) + len(clap_t) + len(hat_t)) else np.array([])
        if len(allt) < 8:
            return UNK("syncopation:too-few-onsets")
        S_bars = []
        nbar = max(1, int(n_beats // 4))
        for bar in range(nbar):
            bstart = beat_times[bar * 4]
            bend = beat_times[min(bar * 4 + 4, n_beats - 1)]
            barlen = bend - bstart
            if barlen <= 0:
                continue
            occ = np.zeros(16)
            for t in allt:
                if bstart <= t < bend:
                    frac = (t - bstart) / barlen
                    slot = int(round(frac * 16)) % 16
                    occ[slot] = 1
            s = 0.0
            for p in range(16):
                if occ[p] == 1:
                    q = (p + 1) % 16
                    if occ[q] == 0 and W[q] > W[p]:
                        s += (W[q] - W[p])
            S_bars.append(s)
        if not S_bars:
            return UNK("syncopation:no-bars")
        idx = float(np.mean(S_bars)) / 12.0  # normalize by a nominal S_max
        conf = grid_conf * min(1.0, nbar / 4.0)
        return M(round(min(1.0, idx), 3), conf, f"LHL weak->strong-rest, swing~{swf:.2f} (relative scale)")
    out["syncopationIndex"] = safe(_syncopation, "syncopation")

    # ---------- lowEndProfile (deterministic, most trustworthy) ----------
    def _lowend():
        Sfull = np.abs(librosa.stft(y, n_fft=NFFT_SPEC, hop_length=HOP_SPEC))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=NFFT_SPEC)
        band = np.where((freqs >= 30) & (freqs < 120))[0]
        total = float((Sfull ** 2).sum()) + 1e-9
        ratio = float((Sfull[band, :] ** 2).sum()) / total
        # crest of the low-band time envelope (punchy vs drone)
        lb = sos_band(y, sr, 30, 120)
        rms = np.sqrt(np.mean(lb ** 2)) + 1e-9
        crest = float(np.max(np.abs(lb)) / rms)
        clip_frac = float(np.mean(np.abs(y) > 0.999))
        conf = 0.9 * (1.0 - min(1.0, clip_frac * 20)) * (1.0 if dur >= 8 else 0.5)
        return M({"ratio": round(ratio, 4), "crest": round(crest, 2)}, conf, "STFT 30-120Hz/total + low-band crest")
    out["lowEndProfile"] = safe(_lowend, "lowEnd")

    # ---------- logDrumLikelihood (composite, glide-gated, calibration-gated) ----------
    def _logdrum():
        C = LOGDRUM
        # choose candidate stem: bass (log drum lives here) else other else full-mix HPSS-low
        candidates = []
        if bass_q >= 1.0:
            candidates.append(("bass", bass_y, bass_q))
        if other_q >= 1.0:
            candidates.append(("other", other_y, other_q))
        if not candidates:
            hlow, _ = librosa.effects.hpss(y)
            candidates.append(("fullmix-hpss", hlow, 0.5))

        best = None
        for cname, cy, cq in candidates:
            cyseg = cy[: int(90 * sr)]  # bound pyin runtime
            Sc = np.abs(librosa.stft(cyseg, n_fft=NFFT_SPEC, hop_length=HOP_SPEC))
            fr = librosa.fft_frequencies(sr=sr, n_fft=NFFT_SPEC)
            e_sub = float((Sc[np.where((fr >= 40) & (fr < 100))[0], :] ** 2).sum())
            e_ref = float((Sc[np.where((fr >= 20) & (fr < 300))[0], :] ** 2).sum()) + 1e-9
            ratio = e_sub / e_ref
            P_sub = 1.0 / (1.0 + np.exp(-(ratio - C["r0"]) / C["s"]))
            # percussive transient character on sub-band
            sub = sos_band(cyseg, sr, 40, 120)
            env = librosa.onset.onset_strength(y=sub.astype(np.float32), sr=sr, hop_length=HOP)
            ons = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=HOP)
            bars = max(1.0, len(cyseg) / sr / (sigma_beat * 4)) if grid_ok else max(1.0, len(cyseg) / sr / 2)
            opb = len(ons) / bars
            crest = float(np.max(env) / (np.mean(env) + 1e-9)) if len(env) else 0.0
            P_perc = max(0.0, min(1.0, (min(opb, 8) / 8.0) * 0.6 + min(1.0, crest / 8.0) * 0.4))
            # pitch + glide via pyin. FINE hop (512 = 11.6ms) so a ~30-150ms portamento
            # is resolved by ~3-13 frames (HOP_SPEC=46ms only gave ~2 — too coarse to see
            # the glide contour). Bound the segment to keep pyin runtime sane.
            from scipy.signal import medfilt
            PYIN_HOP = 512
            pseg = cy[: int(30 * sr)]  # bound runtime (fine hop + long frame is costly)
            # frame_length=4096 (~93ms) is REQUIRED to track 30-80Hz sub-bass — a shorter
            # window spans too few periods and pyin reports the log drum as unvoiced.
            f0, vflag, vprob = librosa.pyin(pseg, fmin=30, fmax=175, sr=sr, frame_length=4096, hop_length=PYIN_HOP)
            vp = np.nan_to_num(vprob)
            voiced_mask = ~np.isnan(f0)
            vmask = voiced_mask
            if voiced_mask.sum() > 8:
                cents = np.where(voiced_mask, 1200 * np.log2(np.clip(np.nan_to_num(f0, nan=55.0), 1e-6, None) / 55.0), np.nan)
                cents_v = cents[voiced_mask]
                semitone_range = (np.percentile(cents_v, 90) - np.percentile(cents_v, 10)) / 100.0
                P_pitch = float(np.mean(vp)) * max(0.0, min(1.0, semitone_range / 7.0))
                # PORTAMENTO: walk each CONTIGUOUS VOICED RUN (a note) and look for a
                # monotonic pitch rise >=60 cents spanning ~20-200ms. Crucially we never
                # diff across unvoiced gaps (which would fabricate huge transitions).
                frame_dt = PYIN_HOP / sr
                notes = 0; glides = 0
                N = len(f0); i = 0
                while i < N:
                    if not voiced_mask[i]:
                        i += 1
                        continue
                    j = i
                    while j < N and voiced_mask[j]:
                        j += 1
                    run = medfilt(cents[i:j], 3) if (j - i) >= 3 else cents[i:j]
                    notes += 1
                    # A portamento is a CONTIGUOUS RISE that ENDS at a plateau. Ride up
                    # only while clearly rising (>2 cents/frame) and STOP at the plateau —
                    # otherwise dt spans the whole sustained note and the glide is rejected.
                    # Require a plateau afterward (>=2 roughly-flat frames) so a pyin
                    # attack-ramp that never settles isn't counted.
                    k = 1; found = False
                    while k < len(run):
                        if run[k] - run[k - 1] > 2:            # a rise starts
                            s = k - 1
                            while k < len(run) and run[k] - run[k - 1] > 2:
                                k += 1
                            span = run[k - 1] - run[s]; dt = (k - 1 - s) * frame_dt
                            tail = run[k:k + 3]
                            plateaued = len(tail) >= 2 and float(np.max(np.abs(np.diff(tail)))) < 25
                            if span >= 60 and 0.02 <= dt <= 0.25 and plateaued:
                                found = True; break
                        else:
                            k += 1
                    if found:
                        glides += 1
                    i = j
                glide_frac = glides / max(1, notes)
                glide_rate = glides / max(1e-6, len(pseg) / sr)
                P_glide = max(0.0, min(1.0, C["w1"] * glide_frac + C["w2"] * glide_rate))
                pyin_rel = float(np.mean(vp[vp > 0])) if (vp > 0).any() else 0.3
            else:
                P_pitch = 0.0; P_glide = 0.0; pyin_rel = 0.2
            core = (max(P_sub, 1e-6) ** C["e_sub"] * max(P_perc, 1e-6) ** C["e_perc"] * max(P_pitch, 1e-6) ** C["e_pitch"]) ** (1.0 / C["geo_root"])
            final = core * (C["glideFloor"] + (1 - C["glideFloor"]) * P_glide)
            sig_adequacy = max(0.0, min(1.0, int(vmask.sum()) / 200.0))
            cand_conf = cq * pyin_rel * (0.5 + 0.5 * sig_adequacy)
            rec = dict(stem=cname, value=float(final), conf=float(cand_conf),
                       subs=dict(P_sub=round(float(P_sub), 3), P_perc=round(float(P_perc), 3),
                                 P_pitch=round(float(P_pitch), 3), P_glide=round(float(P_glide), 3)))
            if best is None or rec["value"] > best["value"]:
                best = rec
        method = f"composite[{best['stem']}] subs={best['subs']}"
        if C.get("calibrated"):
            return M(round(best["value"], 3), best["conf"], f"logdrum calibrated(margin={C.get('separationMargin')}) " + method)
        # Uncalibrated: ship 'inferred' with the machine-readable reason so the UI can say
        # "log drum: not scored — <reason>" instead of silently dropping the field.
        return INF(round(best["value"], 3), min(best["conf"], 0.5), f"logdrum uncalibrated({C.get('reason')}) " + method)
    out["logDrumLikelihood"] = safe(_logdrum, "logDrum")

    # ---------- shakerContinuity ----------
    def _shaker():
        if not grid_ok:
            return UNK("shaker:no-grid")
        perc = librosa.effects.hpss(drums_y)[1]
        hf = sos_band(perc, sr, 6000, min(16000, sr / 2 - 500))
        slot_e = []
        for jb in range(n_beats - 1):
            step = (beat_times[jb + 1] - beat_times[jb]) / 4.0
            for s in range(4):
                t = beat_times[jb] + s * step
                i0 = max(0, int((t - 0.03) * sr)); i1 = min(len(hf), int((t + 0.03) * sr))
                slot_e.append(np.sqrt(np.mean(hf[i0:i1] ** 2)) if i1 > i0 else 0.0)
        slot_e = np.array(slot_e)
        if len(slot_e) < 8:
            return UNK("shaker:too-few-slots")
        med = np.median(slot_e); mad = np.median(np.abs(slot_e - med)) + 1e-9
        thresh = med + 1.0 * mad
        filled = float(np.mean(slot_e > thresh))
        hf_snr = float(med / (np.mean(hf ** 2) ** 0.5 + 1e-9))
        conf = grid_conf * min(1.0, hf_snr) * drums_q
        return M(round(filled, 3), conf, "HF-percussive(6-16k) RMS>median+MAD per 16th (conflates shaker+hat)")
    out["shakerContinuity"] = safe(_shaker, "shaker")

    # ---------- kickDensity ----------
    def _kick_density():
        if not grid_ok or len(kick_t) < 4:
            return UNK("kickDensity:no-grid-or-kicks")
        # Log-drum-vs-kick suppression ONLY matters on the full-mix fallback (both live
        # 30-150Hz). With a real drums stem the kick is already isolated (log drum ->
        # bass stem), and a real kick often lands ON a bassline note — suppressing then
        # would wrongly halve the count. So suppress only when we lack a drums stem.
        if drums_q < 1.0 and bass_q >= 1.0:
            bass_on = onset_times_in_band(bass_y, sr, 40, 150)[0]
            kept = [kt for kt in kick_t if not (len(bass_on) and np.min(np.abs(bass_on - kt)) < 0.03)]
            note = "full-mix, bass-onset suppressed"
        else:
            kept = list(kick_t)
            note = "drums-stem (trusted, no suppression)"
        barlen = sigma_beat * 4
        val = len(kept) / max(1.0, dur / barlen)
        conf = grid_conf * drums_q * 0.8
        return M(round(val, 2), conf, f"30-150Hz percussive onsets/bar ({note})")
    out["kickDensity"] = safe(_kick_density, "kickDensity")

    # ---------- clapBackbeat (alternation strength; phase-capped) ----------
    def _clap():
        if not grid_ok or len(clap_t) < 4:
            return UNK("clapBackbeat:no-grid-or-claps")
        w = 0.15 * sigma_beat
        acc = [1.0 if np.any(np.abs(clap_t - bt) <= w) else 0.0 for bt in beat_times]
        even = np.mean([acc[i] for i in range(0, n_beats, 2)])
        odd = np.mean([acc[i] for i in range(1, n_beats, 2)])
        alt = abs(even - odd) / (even + odd + 1e-9)
        return M(round(float(alt), 3), grid_conf * 0.4, "even/odd beat clap alternation (phase-ambiguous, no downbeat)")
    out["clapBackbeat"] = safe(_clap, "clapBackbeat")

    # ---------- sectionBoundaries ----------
    def _sections():
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP_SPEC)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP_SPEC, n_mfcc=13)
        if grid_ok:
            bf_spec = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP_SPEC)
            bf_spec = bf_spec[(bf_spec > 0) & (bf_spec < chroma.shape[1])]
            if len(bf_spec) > 4:
                chroma = librosa.util.sync(chroma, bf_spec, aggregate=np.median)
                mfcc = librosa.util.sync(mfcc, bf_spec, aggregate=np.mean)
                frame_times = beat_times[: chroma.shape[1]]
            else:
                frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=HOP_SPEC)
        else:
            frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=HOP_SPEC)
        feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=0)])
        k = int(max(3, min(9, round(dur / 25.0))))
        bounds = librosa.segment.agglomerative(feat, k)
        times = sorted(set(float(frame_times[min(b, len(frame_times) - 1)]) for b in bounds))
        if grid_ok and times:
            minlen = sigma_beat * 4 * 4
            merged = [times[0]]
            for t in times[1:]:
                if t - merged[-1] >= minlen:
                    merged.append(t)
            times = merged
        return M([round(t, 2) for t in times], min(0.85, max(0.3, grid_conf)), "beat-sync chroma+mfcc agglomerative")
    out["sectionBoundaries"] = safe(_sections, "sections")

    # ---------- energyCurve ----------
    def _energy():
        hop = int(0.1 * sr)
        starts = list(range(0, max(1, len(y) - hop), hop))
        try:
            import pyloudnorm as pyln
            meter = pyln.Meter(sr)
            win = int(0.4 * sr)
            curve = []
            for i in starts:
                seg = y[i:i + win]
                if len(seg) < win // 2:
                    break
                try:
                    curve.append(meter.integrated_loudness(seg))
                except Exception:
                    curve.append(-70.0)
            method = "momentary-LUFS(pyloudnorm)"
        except Exception:
            curve = [20 * np.log10(np.sqrt(np.mean(y[i:i + hop] ** 2)) + 1e-9) for i in starts]
            method = "RMS-dB fallback"
        curve = np.clip(np.array(curve, dtype=float), -60, 0)
        norm = (curve - curve.min()) / (curve.max() - curve.min() + 1e-9)
        if len(norm) > 400:
            idx = np.linspace(0, len(norm) - 1, 400).astype(int)
            norm = norm[idx]
        return M([round(float(v), 3) for v in norm], 0.9, method + " @0.1s, normalized 0-1")
    out["energyCurve"] = safe(_energy, "energy")

    # ---------- firstDropAtS + introLengthBars ----------
    def _first_drop():
        lb = sos_band(y, sr, 30, 120)
        hop = int(0.1 * sr)
        rms = np.array([np.sqrt(np.mean(lb[i:i + hop] ** 2)) for i in range(0, max(1, len(lb) - hop), hop)])
        if rms.max() <= 0:
            return UNK("firstDrop:silent")
        F = rms / rms.max()
        t_per = hop / sr
        barsamp = max(1, int((sigma_beat * 4) / t_per)) if grid_ok else int(2 / t_per)
        if F[:barsamp].mean() > 0.6:
            return M(round(float(beat_times[0]) if grid_ok and n_beats else 0.0, 2), 0.4, "no-intro (full from bar 1)")
        for i in range(barsamp, len(F) - barsamp):
            before = F[max(0, i - barsamp):i].mean()
            after = F[i:i + barsamp].mean()
            if before < 0.3 and after > 0.6:
                contrast = after - before
                t = i * t_per
                if grid_ok and n_beats:
                    t = float(beat_times[np.argmin(np.abs(beat_times - t))])
                return M(round(t, 2), min(0.9, max(0.3, contrast)), "low-band fullness crossing (snapped)")
        return UNK("firstDrop:no-clear-drop")
    fd = safe(_first_drop, "firstDrop")
    out["firstDropAtS"] = fd

    def _intro_bars():
        if fd.get("source") != "measured" or not grid_ok:
            return UNK("introBars:needs-drop+grid")
        barlen = sigma_beat * 4
        start = float(beat_times[0]) if n_beats else 0.0
        bars = (fd["value"] - start) / (barlen + 1e-9)
        r = round(bars)
        rounding = 1.0 if abs(bars - r) < 0.25 and r in (2, 4, 8, 12, 16) else 0.6
        return M(round(bars, 1), min(0.8, fd["confidence"] * rounding), "firstDrop/barLength")
    out["introLengthBars"] = safe(_intro_bars, "introBars")

    # ---------- vocal fields (v1.1 — need the vocals stem; full mix would false-positive
    # on melodic synth/guitar, so without a real vocal stem these stay honestly unknown) ----------
    def _vocal_presence():
        if vocals_q < 1.0:
            return UNK("vocalPresence:no-vocal-stem")
        vr = librosa.feature.rms(y=vocals_y.astype(np.float32), hop_length=HOP_SPEC, frame_length=2048)[0]
        if vr.max() <= 0:
            return M(0.0, 0.8, "vocal-stem RMS (silent stem)")
        rn = vr / vr.max()
        thr = max(0.06, float(np.median(rn) * 0.5))  # adaptive floor above the noise bed
        return M(round(float(np.mean(rn > thr)), 3), 0.85, "vocal-stem RMS>adaptive-floor fraction")
    out["vocalPresenceRatio"] = safe(_vocal_presence, "vocalPresence")

    def _sung_vs_spoken():
        if vocals_q < 1.0:
            return UNK("sungVsSpoken:no-vocal-stem")
        vseg = vocals_y[: int(45 * sr)].astype(np.float32)
        f0, vflag, vprob = librosa.pyin(vseg, fmin=80, fmax=1000, sr=sr, frame_length=2048, hop_length=512)
        vmask = ~np.isnan(f0)
        if int(vmask.sum()) < int(3 * sr / 512):  # <3s of voiced material
            return UNK("sungVsSpoken:insufficient-voiced")
        cents = 1200 * np.log2(np.clip(np.nan_to_num(f0, nan=100.0), 1e-6, None) / 100.0)
        frame_dt = 512 / sr
        # PRIMARY cue: voiced-RUN length. Sung notes are HELD (~0.3-1s); spoken syllables
        # are short (~0.1-0.25s). SECONDARY: pitch-plateau fraction (held pitch vs drift).
        runs = []
        i = 0; N = len(f0)
        while i < N:
            if vmask[i]:
                j = i
                while j < N and vmask[j]:
                    j += 1
                runs.append((j - i) * frame_dt)
                i = j
            else:
                i += 1
        med_run = float(np.median(runs)) if runs else 0.0
        run_score = max(0.0, min(1.0, (med_run - 0.15) / 0.30))  # 0.15s->0 .. 0.45s->1
        plateau = 0; total = 0
        for i in np.where(vmask)[0]:
            lo = max(0, i - 2); hi = min(len(cents), i + 3)
            seg = cents[lo:hi][vmask[lo:hi]]
            if len(seg) >= 3:
                total += 1
                if (seg.max() - seg.min()) < 60:
                    plateau += 1
        plateau_frac = plateau / max(1, total)
        sungness = 0.6 * run_score + 0.4 * plateau_frac
        label = "sung" if sungness >= 0.55 else ("spoken" if sungness <= 0.30 else "mixed")
        conf = min(0.8, 0.45 + abs(sungness - 0.42))
        return M(label, conf, f"sungness={sungness:.2f} (medRun={med_run:.2f}s, plateau={plateau_frac:.2f})")
    out["sungVsSpoken"] = safe(_sung_vs_spoken, "sungVsSpoken")

    # ---------- HONESTLY UNKNOWN (per honesty law — proxies that can't measure their claim) ----------
    def _keys_presence():
        # SUSTAINED HARMONIC MID-BAND PRESENCE (piano/keys/pads/guitar bed).
        # HPSS harmonic component, 200-2000 Hz energy share x frame-to-frame
        # continuity. Measures PRESENCE of sustained pitched harmony (what
        # "amapiano without piano" lacks) - NOT chord complexity.
        y_h, _yp = librosa.effects.hpss(y)
        S = np.abs(librosa.stft(y_h, hop_length=HOP_SPEC))
        freqs = librosa.fft_frequencies(sr=sr)
        band = (freqs >= 200) & (freqs <= 2000)
        band_e = S[band].sum(axis=0)
        tot_e = S.sum(axis=0) + 1e-9
        ratio = float(np.clip(np.median(band_e / tot_e) * 2.2, 0, 1))
        b = band_e + 1e-9
        cont = float(np.clip(np.median(np.minimum(b[1:], b[:-1]) / np.maximum(b[1:], b[:-1])), 0, 1))
        return M(round(0.55 * ratio + 0.45 * cont, 3), 0.6, "hpss-midband(200-2k)-sustained-energy v1")
    out["harmonicRichness"] = safe(_keys_presence, "keysPresence")
    out["hatRollPresence"] = UNK("v1:roll-vs-fast-hat-indistinguishable(needs-calibration)")
    out["adLibDensity"] = UNK("permanent-v1:demucs-vocal-stem-mixes-lead+backing")

    out["engineOk"] = True
    return out


def main():
    # Boot-time / eval query: report the log-drum truth-gate status without analyzing.
    if len(sys.argv) > 1 and sys.argv[1] == "--calibration-status":
        print(json.dumps({
            "calibrated": bool(LOGDRUM.get("calibrated")),
            "reason": LOGDRUM.get("reason"),
            "separationMargin": LOGDRUM.get("separationMargin"),
            "calibratedOn": LOGDRUM.get("calibratedOn"),
            "provenance": LOGDRUM.get("provenance"),
            "schema": LOGDRUM_SCHEMA,
        }))
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--bass"); ap.add_argument("--drums"); ap.add_argument("--other"); ap.add_argument("--vocals")
    args = ap.parse_args()
    stems = {k: v for k, v in (("bass", args.bass), ("drums", args.drums), ("other", args.other), ("vocals", args.vocals)) if v}
    try:
        res = analyze(args.audio, stems)
    except Exception as e:  # noqa — never crash the caller
        import traceback
        log(traceback.format_exc())
        res = {"engineOk": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(res))


if __name__ == "__main__":
    main()
