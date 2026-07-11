#!/usr/bin/env python3
"""Signature-material synthesizer — GENRE + KEY aware.

v1 rendered every genre with the same amapiano-style log drum, an amapiano
chord loop, and a fixed A-minor bass — so afrobeats/highlife/gospel/house all
came out amapiano mush in one key. v2 takes the genre, the key and a
four-on-floor flag and renders each lane's own pocket: real kick/snare/hat
drums (four-on-floor for house/EDM, syncopated for afro, boom-bap for hip-hop),
key-correct bass, and a genre-appropriate chord progression. log_drum stays the
pitched-glide amapiano signature (only requested for log-drum genres).

Usage: synth_material.py ROLE BPM OUTPATH [SEED] [GENRE] [KEY] [FOUR_ON_FLOOR]
"""
import sys, math
import numpy as np
# soundfile is imported lazily in __main__ (only needed to WRITE the wav) so the
# synthesis logic stays importable/testable without the native libsndfile dep.

SR = 44100

# ---- key / scale ----------------------------------------------------------
NOTE_SEMI = {'c':0,'c#':1,'db':1,'d':2,'d#':3,'eb':3,'e':4,'fb':4,'f':5,'e#':5,
             'f#':6,'gb':6,'g':7,'g#':8,'ab':8,'a':9,'a#':10,'bb':10,'b':11,'cb':11}
MINOR = [0,2,3,5,7,8,10]
MAJOR = [0,2,4,5,7,9,11]

def midi_freq(m): return 440.0 * (2.0 ** ((m - 69) / 12.0))

def parse_key(key: str):
    """-> (root_semitone 0-11, is_minor). Defaults to A minor."""
    if not key: return 9, True
    s = key.strip().lower()
    is_minor = 'min' in s or s.endswith('m') and 'maj' not in s
    # take the leading note token (e.g. 'f#', 'bb', 'a')
    tok = s.split()[0].replace('minor','').replace('major','').replace('maj','').replace('min','').strip()
    if tok and tok[-1] == 'm' and tok not in NOTE_SEMI: tok = tok[:-1]
    semi = NOTE_SEMI.get(tok, 9)
    if 'maj' in s: is_minor = False
    return semi, is_minor

def scale_freqs(root_semi, is_minor, base_midi=48, octaves=2):
    steps = MINOR if is_minor else MAJOR
    out = []
    for o in range(octaves + 1):
        for iv in steps:
            out.append(midi_freq(base_midi + root_semi + iv + 12 * o))
    return out

# ---- primitives -----------------------------------------------------------
def env_exp(n, decay):
    t = np.arange(n) / SR
    return np.exp(-t * decay)

def softclip(x, drive=1.6):
    return np.tanh(x * drive)

def place(buf, hit, at_s):
    i = int(at_s * SR)
    j = min(i + hit.size, buf.size)
    if i < buf.size:
        buf[i:j] += hit[: j - i]

def log_drum_hit(dur=0.42, f0=175.0, f1=52.0, glide=0.10, amp=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    k = np.log(f1 / f0) / glide
    f = np.where(t < glide, f0 * np.exp(k * t), f1)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * env_exp(n, 7.5)
    sub = np.sin(phase * 0.5) * env_exp(n, 5.0) * 0.6
    click = np.random.default_rng(0).standard_normal(int(0.008 * SR)) * 0.25
    out = body + sub
    out[: click.size] += click * env_exp(click.size, 400)
    return softclip(out * amp)

def kick_hit(dur=0.30, f0=120.0, f1=48.0, amp=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 45)          # fast pitch drop = punch
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * env_exp(n, 9.0)
    click = np.random.default_rng(1).standard_normal(int(0.004 * SR)) * 0.35
    out = body
    out[: click.size] += click
    return softclip(out * amp, 1.4)

def snare_hit(dur=0.18, amp=0.8, rng=None):
    rng = rng or np.random.default_rng(2)
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n) * env_exp(n, 26.0)
    tone = (np.sin(2*np.pi*180*t) + 0.5*np.sin(2*np.pi*330*t)) * env_exp(n, 30.0)
    return softclip((noise * 0.8 + tone * 0.5) * amp)

def hat_hit(dur=0.05, amp=0.4, rng=None):
    rng = rng or np.random.default_rng()
    n = int(dur * SR)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0.0)                    # crude highpass
    return x * env_exp(n, 60.0) * amp

def shaker_hit(dur=0.09, amp=0.5, rng=None):
    rng = rng or np.random.default_rng()
    n = int(dur * SR)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0.0)
    return x * env_exp(n, 55.0) * amp

def bass_note(dur, f0, f1=None, amp=0.9):
    n = int(dur * SR); t = np.arange(n) / SR
    f1 = f1 or f0
    f = f0 + (f1 - f0) * np.minimum(t / max(dur * 0.6, 1e-3), 1.0)
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) + 0.35 * np.sin(2 * phase)
    e = np.minimum(t / 0.01, 1.0) * np.exp(-np.maximum(t - dur * 0.7, 0) * 12)
    return softclip(x * e * amp)

def ep_chord(dur, freqs, amp=0.7):
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        ph = 2 * np.pi * f * t
        x += np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.18 * np.sin(3 * ph)
    att = np.minimum(t / 0.008, 1.0)
    x *= att * np.exp(-t * 2.1) * amp / max(len(freqs), 1)
    return softclip(x, 1.2)

# ---- genre config ---------------------------------------------------------
SEVENTH_GENRES = {'amapiano','afro_house','gospel','afro_gospel','afro_rnb','afro_soul',
                  'rnb','soul','jazz','lofi','blues','kwaito'}
BOOMBAP_GENRES = {'hip_hop','trap','drill','lofi'}

def chord_prog(scale, is_minor, use7):
    # degree indices into the 2-octave scale (7 notes/octave)
    degs = [0, 5, 2, 6] if is_minor else [0, 4, 5, 3]  # i-VI-III-VII  /  I-V-vi-IV
    chords = []
    for d in degs:
        idx = [d, d + 2, d + 4] + ([d + 6] if use7 else [])
        chords.append([scale[i] for i in idx if i < len(scale)])
    return chords

def render(role, bpm, seed=7, genre='afrobeats', key='A minor', four_on_floor=False):
    beat = 60.0 / bpm
    total = beat * 8  # 2 bars of 4/4
    buf = np.zeros(int(total * SR) + SR // 4)
    rng = np.random.default_rng(seed)
    root_semi, is_minor = parse_key(key)
    scale = scale_freqs(root_semi, is_minor)
    root_bass = midi_freq(24 + root_semi)  # octave-1 root for bass

    if role == 'drums':
        # kick + snare/clap + hats, patterned by feel.
        if four_on_floor:                              # house / edm / afro_house / gqom
            for b in range(8):
                place(buf, kick_hit(f0=130, f1=50, amp=1.0), b * beat)
            for b in (2, 6):                           # backbeat clap on 2 & 4 of each bar
                place(buf, snare_hit(amp=0.7, rng=rng), b * beat)
            for k in range(16):                        # offbeat 8th hats
                place(buf, hat_hit(amp=0.3, rng=rng), (k + 0.5) * beat / 2)
        elif genre in BOOMBAP_GENRES:                  # hip-hop / trap / drill / lofi
            for b in (0.0, 2.5, 4.0, 6.5):
                place(buf, kick_hit(f0=110, f1=45, amp=1.0), b * beat)
            for b in (2.0, 6.0):
                place(buf, snare_hit(amp=0.8, rng=rng), b * beat)
            for k in range(32):                        # busy 16th hats
                place(buf, hat_hit(dur=0.03, amp=0.22 + (0.1 if k % 4 == 0 else 0), rng=rng), k * beat / 4)
        else:                                          # afro pocket — syncopated kick, backbeat on 3
            for b in (0.0, 1.5, 2.75, 4.0, 5.5, 6.75):
                place(buf, kick_hit(f0=125, f1=48, amp=0.95), b * beat)
            for b in (2.0, 6.0):
                place(buf, snare_hit(amp=0.6, rng=rng), b * beat)
            for k in range(16):
                place(buf, hat_hit(amp=0.25, rng=rng), k * beat / 2)

    elif role == 'log_drum':                            # amapiano signature — tuned to key
        f0 = midi_freq(45 + root_semi)                  # ~ pitched sub around the key root
        pattern = [0.0, 0.75, 1.5, 2.5, 3.25, 4.0, 4.75, 5.5, 6.5, 7.25]
        for k, b in enumerate(pattern):
            place(buf, log_drum_hit(f0=f0 + rng.uniform(-6, 6), f1=root_bass * 0.95, amp=0.95 if k % 3 else 1.0), b * beat)

    elif role == 'percussion':
        for k in range(32):
            swing = 0.055 * beat if k % 2 else 0.0
            place(buf, shaker_hit(amp=0.55 if k % 4 == 0 else 0.32, rng=rng), k * beat / 4 + swing)

    elif role == 'chords':
        use7 = genre in SEVENTH_GENRES
        prog = chord_prog(scale, is_minor, use7)
        # two chords per bar (on 1 and the 'and' of 3) — offbeat stabs
        hits = [(prog[0], 0.0), (prog[1], 2.5), (prog[2], 4.0), (prog[3], 6.5)]
        for freqs, b in hits:
            place(buf, ep_chord(1.3, freqs, amp=0.7), b * beat)

    elif role == 'fill':
        # descending toms into the 1 — plain kicks (not log-drum timbre) so
        # non-amapiano genres don't get an amapiano sub in every fill.
        for b, f0 in [(0.0, 200), (0.75, 165), (1.5, 135), (2.25, 110), (3.0, 90)]:
            place(buf, kick_hit(dur=0.18, f0=f0, f1=f0 * 0.6, amp=0.8), b * beat)
        for k in range(16):
            place(buf, snare_hit(dur=0.05, amp=0.12 + 0.03 * k, rng=rng), (2.0 + k * 0.125) * beat)

    elif role == 'bass':
        r = root_bass
        seq = [(0.0, 1.5, r, r), (1.5, 1.0, r * 1.5, r), (2.5, 1.5, r, r * 0.75),
               (4.0, 1.5, r, r), (5.5, 1.0, r * 1.335, r), (6.5, 1.5, r, r)]
        for at, dur, f0, f1 in seq:
            place(buf, bass_note(dur * beat, f0, f1), at * beat)
    else:
        raise SystemExit(f"unknown role: {role}")

    peak = np.max(np.abs(buf)) or 1.0
    return (buf / peak * 0.89).astype(np.float32), total

if __name__ == '__main__':
    import soundfile as sf
    role, bpm, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 7
    genre = sys.argv[5] if len(sys.argv) > 5 else 'afrobeats'
    key = sys.argv[6] if len(sys.argv) > 6 else 'A minor'
    four = (len(sys.argv) > 7 and sys.argv[7] == '1')
    audio, dur = render(role, bpm, seed, genre, key, four)
    sf.write(out, audio, SR)
    print(f"{{\"ok\":true,\"role\":\"{role}\",\"bpm\":{bpm},\"genre\":\"{genre}\",\"key\":\"{key}\",\"durationS\":{dur:.3f}}}")
