#!/usr/bin/env python3
"""Gate: the owned synth is genre + key aware (not amapiano-mush-in-A-minor).

Exits 0 on pass, 2 if numpy is unavailable (SKIP), 1 on a real failure.
Pure numpy — no soundfile/libsndfile needed.
"""
import sys, hashlib
try:
    import numpy as np
    import synth_material as s
except ImportError as e:
    print(f"SKIP synth test — {e}")
    sys.exit(2)

fails = []

# 1) key parsing
for k, exp in {'A minor': (9, True), 'C major': (0, False), 'F# minor': (6, True),
               'Bb major': (10, False), 'G minor': (7, True)}.items():
    if s.parse_key(k) != exp:
        fails.append(f"key parse {k} -> {s.parse_key(k)} != {exp}")

# 2) every role renders non-silent for several genres/keys
sigs = {}
for role in ['drums', 'log_drum', 'percussion', 'chords', 'fill', 'bass']:
    for genre, key, four in [('amapiano', 'A minor', False), ('house', 'A minor', True),
                             ('afrobeats', 'C major', False), ('hip_hop', 'D minor', False)]:
        a, _ = s.render(role, 112, 7, genre, key, four)
        if a.size == 0 or float(np.max(np.abs(a))) < 0.1:
            fails.append(f"{role}/{genre} silent")
        sigs[(role, genre)] = hashlib.md5(a.tobytes()).hexdigest()

# 3) drums differ by feel (four-on-floor house vs syncopated afro vs boom-bap)
drum_sigs = [sigs[('drums', g)] for g in ('amapiano', 'house', 'hip_hop')]
if len(set(drum_sigs)) != 3:
    fails.append(f"drums not distinct per genre feel: {drum_sigs}")

# 4) chords are key-aware (A minor != C major)
if s.render('chords', 112, 7, 'amapiano', 'A minor', False)[0].tobytes() == \
   s.render('chords', 112, 7, 'amapiano', 'C major', False)[0].tobytes():
    fails.append("chords ignore key")

# 5) SOUNDWAVE2 — the pocket: one shared swing on odd 16ths only
if s.resolve_swing('gqom') != 0.5:
    fails.append("gqom must be straight (swing 0.5)")
if not (0.56 <= s.resolve_swing('afrobeats') <= 0.58):
    fails.append(f"afrobeats swing out of band: {s.resolve_swing('afrobeats')}")
if s.resolve_swing('made_up', None) != s.SWING_DEFAULT:
    fails.append("unknown genre must fall back to the default swing")
if s.resolve_swing('afrobeats', 0.9) > 0.62 or s.resolve_swing('afrobeats', 'junk') != s.SWING_DEFAULT:
    fails.append("caller swing must clamp/fall back safely")
# odd 16ths shift late by (swing-0.5)*0.5 beat; even 16ths + 32nds untouched
if abs(s.swung(0.25, 0.58) - (0.25 + 0.04)) > 1e-9:
    fails.append(f"odd 16th must shift +0.04 beat at 58% swing (got {s.swung(0.25, 0.58)})")
if s.swung(0.5, 0.58) != 0.5 or s.swung(2.0, 0.58) != 2.0:
    fails.append("even 16ths (8ths/downbeats) must stay on the grid")
if s.swung(2.125, 0.58) != 2.125:
    fails.append("32nd-grid positions (fill rolls) must not swing")
if s.swung(0.75, 0.5) != 0.75:
    fails.append("straight lanes (swing 0.5) must not shift anything")

# 6) swing is audible in the bytes: straight vs swung renders differ
if s.render('percussion', 112, 7, 'afrobeats', 'A minor', False, 0.5)[0].tobytes() == \
   s.render('percussion', 112, 7, 'afrobeats', 'A minor', False, 0.58)[0].tobytes():
    fails.append("percussion ignores the swing parameter")

# 7) velocity humanization: deterministic per seed, varied across seeds
a1 = s.render('drums', 112, 7, 'afrobeats', 'A minor', False)[0]
a2 = s.render('drums', 112, 7, 'afrobeats', 'A minor', False)[0]
a3 = s.render('drums', 112, 8, 'afrobeats', 'A minor', False)[0]
if a1.tobytes() != a2.tobytes():
    fails.append("same seed must replay byte-identically (determinism law)")
if a1.tobytes() == a3.tobytes():
    fails.append("different seeds must produce different velocities/hits")

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("synth: genre + key aware, real drums, all roles non-silent, key-correct, one swung pocket (odd 16ths only), seeded humanization deterministic")
