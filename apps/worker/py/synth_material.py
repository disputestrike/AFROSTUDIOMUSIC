#!/usr/bin/env python3
"""Signature-material synthesizer — inverts the detector's model into a GENERATOR.

The log-drum detector scores pitched sub hits with exponential glide; this renders
exactly that, so the material assembler gets 100%-owned, grid-locked loops today
while the licensed producer-pack decision waits. Roles: log_drum | percussion
(shaker) | bass (glide line). 2 bars at the given BPM, 44.1k mono WAV.

Usage: synth_material.py ROLE BPM OUTPATH [SEED]
"""
import sys, math
import numpy as np
import soundfile as sf

SR = 44100

def env_exp(n, decay):
    t = np.arange(n) / SR
    return np.exp(-t * decay)

def softclip(x, drive=1.6):
    return np.tanh(x * drive)

def log_drum_hit(dur=0.42, f0=175.0, f1=52.0, glide=0.10, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # exponential pitch glide (the detector's own model: r0/glide envelope)
    k = np.log(f1 / f0) / glide
    f = np.where(t < glide, f0 * np.exp(k * t), f1)
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * env_exp(n, 7.5)
    sub = np.sin(phase * 0.5) * env_exp(n, 5.0) * 0.6
    click = np.random.default_rng(0).standard_normal(int(0.008 * SR)) * 0.25
    out = body + sub
    out[: click.size] += click * env_exp(click.size, 400)
    return softclip(out * amp)

def shaker_hit(dur=0.09, amp=0.5, rng=None):
    rng = rng or np.random.default_rng()
    n = int(dur * SR)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0.0)          # crude highpass — shaker sizzle
    return x * env_exp(n, 55.0) * amp

def bass_note(dur, f0, f1=None, amp=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f1 = f1 or f0
    f = f0 + (f1 - f0) * np.minimum(t / max(dur * 0.6, 1e-3), 1.0)  # linear slide
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(phase) + 0.35 * np.sin(2 * phase)
    e = np.minimum(t / 0.01, 1.0) * np.exp(-np.maximum(t - dur * 0.7, 0) * 12)
    return softclip(x * e * amp)

def ep_chord(dur, freqs, amp=0.7):
    """Electric-piano-ish stab: fundamentals + soft harmonics, 8ms attack, long decay."""
    n = int(dur * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        ph = 2 * np.pi * f * t
        x += np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.18 * np.sin(3 * ph)
    att = np.minimum(t / 0.008, 1.0)
    x *= att * np.exp(-t * 2.1) * amp / max(len(freqs), 1)
    return softclip(x, 1.2)

def fill_build(beat, amp=0.9, rng=None):
    """One-bar Afro drum fill: descending tom hits + snare-roll crescendo into the 1."""
    rng = rng or np.random.default_rng(3)
    n = int(beat * 4 * SR); buf = np.zeros(n + SR // 8)
    for k, (b, f0) in enumerate([(0.0, 220), (0.75, 180), (1.5, 150), (2.25, 120), (3.0, 100)]):
        place(buf, log_drum_hit(dur=0.22, f0=f0, f1=f0 * 0.6, glide=0.05, amp=0.8), b * beat)
    for k in range(16):  # roll crescendo across the last two beats
        at = (2.0 + k * 0.125) * beat
        place(buf, shaker_hit(dur=0.05, amp=0.15 + 0.05 * k, rng=rng), at)
    peak = np.max(np.abs(buf)) or 1.0
    return (buf / peak * amp).astype(np.float64)

def place(buf, hit, at_s):
    i = int(at_s * SR)
    j = min(i + hit.size, buf.size)
    buf[i:j] += hit[: j - i]

def render(role: str, bpm: int, seed: int = 7):
    beat = 60.0 / bpm
    total = beat * 8  # 2 bars of 4/4
    buf = np.zeros(int(total * SR) + SR // 4)
    rng = np.random.default_rng(seed)
    if role == 'log_drum':
        # amapiano-style syncopated pattern (in beats): the off-beat call-and-response
        pattern = [0.0, 0.75, 1.5, 2.5, 3.25, 4.0, 4.75, 5.5, 6.5, 7.25]
        for k, b in enumerate(pattern):
            place(buf, log_drum_hit(f0=170 + rng.uniform(-8, 8), f1=50 + rng.uniform(-3, 3), amp=0.95 if k % 3 else 1.0), b * beat)
    elif role == 'percussion':
        for k in range(32):  # continuous 16ths with swing + accents (shaker glue)
            swing = 0.055 * beat if k % 2 else 0.0
            place(buf, shaker_hit(amp=0.55 if k % 4 == 0 else 0.32, rng=rng), k * beat / 4 + swing)
    elif role == 'chords':
        # amapiano-leaning progression: Am7 - Fmaj7 - Cmaj7 - G, offbeat stabs
        A3, C4, E4, G4 = 220.0, 261.63, 329.63, 392.0
        F3, A3b, C4b, E4b = 174.61, 220.0, 261.63, 329.63
        C3, E3, G3, B3 = 130.81, 164.81, 196.0, 246.94
        G3b, B3b, D4, F4 = 196.0, 246.94, 293.66, 349.23
        prog = [([A3, C4, E4, G4], 0.0), ([A3, C4, E4], 1.5), ([F3, A3b, C4b, E4b], 2.0), ([F3, C4b], 3.25),
                ([C3, E3, G3, B3], 4.0), ([C3, G3, B3], 5.5), ([G3b, B3b, D4, F4], 6.0), ([G3b, D4, F4], 7.25)]
        for freqs, b in prog:
            place(buf, ep_chord(1.3, freqs, amp=0.72), b * beat)
    elif role == 'fill':
        f = fill_build(beat, rng=rng)
        place(buf, f, 0.0)          # bar 1 of 2 = the fill itself
        place(buf, f * 0.0, 4 * beat)  # bar 2 silent — assembler overlays only the hit bar
    elif role == 'bass':
        root = 55.0  # A1
        seq = [(0.0, 1.5, root, root), (1.5, 1.0, root * 1.335, root), (2.5, 1.5, root, root * 0.89),
               (4.0, 1.5, root, root), (5.5, 1.0, root * 1.19, root), (6.5, 1.5, root, root)]
        for at, dur, f0, f1 in seq:
            place(buf, bass_note(dur * beat, f0, f1), at * beat)
    else:
        raise SystemExit(f"unknown role: {role}")
    peak = np.max(np.abs(buf)) or 1.0
    return (buf / peak * 0.89).astype(np.float32), total

if __name__ == '__main__':
    role, bpm, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 7
    audio, dur = render(role, bpm, seed)
    sf.write(out, audio, SR)
    print(f"{{\"ok\":true,\"role\":\"{role}\",\"bpm\":{bpm},\"durationS\":{dur:.3f}}}")
