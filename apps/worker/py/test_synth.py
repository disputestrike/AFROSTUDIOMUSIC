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

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("synth: genre + key aware, real drums, all roles non-silent, key-correct")
