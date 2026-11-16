#!/usr/bin/env python
"""Score and foley for ADF 2027 — Direction.

Motorik at 120 BPM, synthesised: kick, closed hat, rim, bass pulse, marimba, glockenspiel.
No samples, no voice. The picture's own event list (events.json, written by events.mjs from
window.EV) places every foley hit, so a snap on screen and a hit in the mix are the same number.

Print foley only, dry and close, no reverb: ruling pen, block snap, letterpress clack,
guillotine snick, paper slap and slide, numeral thunk, rubber stamp, carriage return.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

LIB = os.environ.get('LIB') or os.path.expanduser('~/lemo-opuscar')
sys.path.insert(0, os.path.join(LIB, 'core', 'audio'))
import sfx  # noqa: E402
from sfx import SR, add, bp, compress, env_exp, hp, limit, lp, noise, norm, t_  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
EV = json.load(open(os.path.join(HERE, 'events.json')))
DUR = float(EV['dur'])
EVENTS = EV['ev']

BPM = 120.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
N = int(DUR * SR)

rng = np.random.default_rng(20272026)


# ----------------------------------------------------------------- instruments
def kick(v=1.0):
    d = 0.42
    tt = t_(d)
    f = 110 * np.exp(-tt * 28) + 46
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(d, 0.10)
    tick = lp(noise(d), 1800) * env_exp(d, 0.004) * 0.6
    return norm(body + tick) * v


def hat(v=1.0, open_=False):
    d = 0.11 if open_ else 0.055
    return norm(hp(noise(d), 7000) * env_exp(d, 0.012 if open_ else 0.006)) * v


def rim(v=1.0):
    d = 0.09
    tt = t_(d)
    x = bp(noise(d), 1400, 3600) * env_exp(d, 0.008)
    x += np.sin(2 * np.pi * 420 * tt) * env_exp(d, 0.012) * 0.5
    return norm(x) * v


def bassnote(midi, d, v=1.0, bright=1.0):
    f = 440 * 2 ** ((midi - 69) / 12)
    tt = t_(d)
    # a saw with its first harmonics, so it speaks on small speakers
    x = sum(np.sin(2 * np.pi * f * k * tt) / k for k in (1, 2, 3, 4))
    x = lp(x, 180 + 900 * bright)
    e = np.minimum(1.0, t_(d) / 0.006) * env_exp(d, max(0.05, d * 0.45))
    return norm(x * e) * v


def wood(midi, d=0.5, v=1.0, bright=1.0):
    """Marimba: a fundamental with the bar's 4th partial, struck and short."""
    f = 440 * 2 ** ((midi - 69) / 12)
    tt = t_(d)
    x = (np.sin(2 * np.pi * f * tt) * env_exp(d, 0.22)
         + 0.35 * bright * np.sin(2 * np.pi * f * 4 * tt) * env_exp(d, 0.05)
         + 0.12 * np.sin(2 * np.pi * f * 9.2 * tt) * env_exp(d, 0.02))
    x += lp(noise(d), 4000) * env_exp(d, 0.003) * 0.25
    return norm(x) * v


def glock(midi, d=1.1, v=1.0):
    f = 440 * 2 ** ((midi - 69) / 12)
    tt = t_(d)
    x = sum(a * np.sin(2 * np.pi * f * k * tt) * env_exp(d, tau)
            for k, a, tau in [(1, 1.0, 0.45), (2.76, 0.5, 0.2), (5.4, 0.25, 0.1)])
    return norm(x) * v


def vibe(midi, d=0.9, v=1.0):
    f = 440 * 2 ** ((midi - 69) / 12)
    tt = t_(d)
    trem = 1 + 0.18 * np.sin(2 * np.pi * 4.5 * tt)
    x = (np.sin(2 * np.pi * f * tt) * env_exp(d, 0.4)
         + 0.3 * np.sin(2 * np.pi * f * 4 * tt) * env_exp(d, 0.12))
    return norm(x * trem) * v


def sineglide(d, f0, f1, v=1.0):
    tt = t_(d)
    f = f0 + (f1 - f0) * (tt / d)
    e = np.minimum(1, tt / 0.15) * np.minimum(1, (d - tt) / 0.3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * e * v


# ----------------------------------------------------------------- print foley
def pen(v=1.0):
    d = 0.5
    x = bp(noise(d), 2200, 7000) * (np.minimum(1, t_(d) / 0.05) * env_exp(d, 0.4))
    return norm(x) * v * 0.6


def blocksnap(v=1.0):
    d = 0.08
    tt = t_(d)
    x = bp(noise(d), 900, 4200) * env_exp(d, 0.006)
    x += np.sin(2 * np.pi * 240 * tt) * env_exp(d, 0.02) * 0.7
    return norm(x) * v


def clack(v=1.0):
    d = 0.12
    tt = t_(d)
    x = bp(noise(d), 1800, 6000) * env_exp(d, 0.005)
    x += np.sin(2 * np.pi * 760 * tt) * env_exp(d, 0.015) * 0.4
    x += np.sin(2 * np.pi * 180 * tt) * env_exp(d, 0.03) * 0.5
    return norm(x) * v


def snick(v=1.0):
    """Guillotine: a thin metal slice."""
    d = 0.22
    tt = t_(d)
    x = hp(noise(d), 4500) * env_exp(d, 0.03)
    x += np.sin(2 * np.pi * 3100 * tt * (1 - 0.25 * tt)) * env_exp(d, 0.05) * 0.35
    return norm(x) * v


def paperslap(v=1.0):
    d = 0.3
    x = bp(noise(d), 300, 3000) * env_exp(d, 0.035)
    return norm(x) * v


def paperslide(v=1.0):
    d = 0.42
    n = noise(d)
    out = np.zeros_like(n)
    for i in range(0, len(n), 480):
        f = 700 + 2600 * (i / len(n))
        out[i:i + 480] = bp(n[i:i + 480], f, min(f * 2.4, 15000))
    return norm(out * (np.minimum(1, t_(d) / 0.06) * env_exp(d, 0.22))) * v * 0.8


def stamp(v=1.0):
    d = 0.2
    tt = t_(d)
    x = lp(noise(d), 2600) * env_exp(d, 0.012)
    x += np.sin(2 * np.pi * 150 * tt) * env_exp(d, 0.05) * 0.8
    return norm(x) * v


def carriage(v=1.0):
    d = 0.5
    n = noise(d)
    out = bp(n, 1200, 5200) * (np.minimum(1, t_(d) / 0.02) * env_exp(d, 0.18))
    tt = t_(0.09)
    ding_ = np.sin(2 * np.pi * 2100 * tt) * env_exp(0.09, 0.04) * 0.5
    out[:len(ding_)] += ding_
    return norm(out) * v


def felt(v=1.0):
    d = 0.3
    tt = t_(d)
    x = np.sin(2 * np.pi * 92 * tt * (1 - 0.2 * tt)) * env_exp(d, 0.08)
    x += lp(noise(d), 700) * env_exp(d, 0.02) * 0.5
    return norm(x) * v


# ----------------------------------------------------------------- the score
music = np.zeros((N, 2), dtype=np.float64)
foley = np.zeros((N, 2), dtype=np.float64)


def m(x, at, g=1.0):
    add(music, x, at, g)


def f(x, at, g=1.0):
    add(foley, x, at, g)


# A minor: the bass pulses the root, the marimba moves inside the mode.
ROOT = 33          # A1
SCALE = [57, 59, 60, 62, 64, 67, 69]      # A minor pentatonic-ish, no leading note


def beats(t0, t1, step=BEAT):
    t = t0
    while t < t1 - 1e-6:
        yield t
        t += step


# bass pulse: present almost everywhere, the film's own clock
BASS = [(0.0, 10.5, 0.30, 0.25), (10.5, 22.0, 0.42, 0.7), (22.0, 25.0, 0.09, 0.08),
        (26.0, 30.5, 0.30, 0.2), (30.5, 38.5, 0.46, 0.8), (38.5, 48.5, 0.46, 0.8),
        (48.5, 53.0, 0.07, 0.06), (53.0, 62.0, 0.52, 1.0), (62.0, 70.5, 0.40, 0.5),
        (70.5, 78.0, 0.50, 0.9), (78.0, 85.0, 0.52, 1.0), (85.0, 94.0, 0.46, 0.7),
        (94.0, 101.0, 0.30, 0.25)]
for t0, t1, g, br in BASS:
    for t in beats(t0, t1):
        m(bassnote(ROOT, BEAT * 0.92, 1.0, br), t, g)

# motorik kit: kick on 1 and 3, hats on eighths, rim on 2 and 4
KIT = [(10.5, 22.0, 0.8, False), (30.5, 38.5, 0.95, True), (38.5, 48.5, 0.9, False),
       (53.0, 62.0, 1.0, True), (70.5, 78.0, 0.95, True), (78.0, 85.0, 1.0, True)]
for t0, t1, g, sixteenths in KIT:
    for i, t in enumerate(beats(t0, t1)):
        if i % 2 == 0:
            m(kick(0.9), t, g)
        if i % 4 == 1 or i % 4 == 3:
            m(rim(0.35), t, g * 0.8)
    step = BEAT / 4 if sixteenths else BEAT / 2
    for j, t in enumerate(beats(t0, t1, step)):
        m(hat(0.22 if j % 2 else 0.34), t, g * 0.55)

# the two doors: half time
for i, t in enumerate(beats(85.0, 94.0, BEAT * 2)):
    m(kick(0.85), t, 0.9)
    m(hat(0.3), t + BEAT, 0.5)

# the weeks: one marimba note per week bar, climbing with the money
WK = [11.0 + i * BEAT for i in range(9)] + [20.0, 21.0, 22.0]
for i, t in enumerate(WK):
    m(wood(SCALE[i % len(SCALE)] + (12 if i > 8 else 0), 0.55, 0.5 + i * 0.03), t, 0.75)

# the slam: everything stops; one low tone under it
m(bassnote(ROOT - 5, 1.6, 1.0, 0.1), 25.0, 0.85)
m(wood(45, 1.2, 1.0, 0.4), 25.0, 0.5)

# the four reasons: one voice added per reason, the build is the argument
for i in range(4):
    t0 = 39.0 + i
    for j, t in enumerate(beats(t0, 48.5, BEAT)):
        if (j + i) % 4 == 0:
            m(wood(SCALE[(i * 2) % len(SCALE)], 0.5, 0.42), t, 0.6)

# the empty grid: a single struck note, then nothing
m(wood(45, 1.6, 0.5, 0.3), 49.0, 0.32)

# the institutions: one glockenspiel note each, and the marimba doubled
INST_T = [53.5 + (i // 2) * 0.5 + (i % 2) * 0.25 for i in range(17)]
for i, t in enumerate(INST_T):
    m(glock(SCALE[i % len(SCALE)] + 12, 1.0, 0.30), t, 0.7)
for j, t in enumerate(beats(53.0, 62.0, BEAT)):
    m(wood(SCALE[j % len(SCALE)], 0.5, 0.36), t, 0.6)
# the red element lands on the grid
m(glock(69 + 12, 1.8, 0.5), 59.0, 0.9)
m(bassnote(ROOT + 12, 1.4, 0.6, 1.0), 59.0, 0.7)

# the rotation: the band thins, the months arrive as single notes
for i in range(12):
    m(wood(SCALE[i % len(SCALE)], 0.45, 0.34), 66.4 + i * 0.175, 0.6)

# shape and money: a vibraphone ostinato over the kit
for j, t in enumerate(beats(70.5, 85.0, BEAT)):
    if j % 2 == 0:
        m(vibe(SCALE[(j // 2) % len(SCALE)] + 12, 0.9, 0.22), t, 0.6)

# the exception sings: a sine glide follows B's border as it draws
m(sineglide(2.0, 300, 760, 0.16), 90.0, 1.0)

# the end: the instruments are cut away with the elements, the bass pulse last
m(wood(SCALE[0], 1.4, 0.4), 98.5, 0.6)
m(bassnote(ROOT, 2.4, 0.8, 0.15), 98.5, 0.5)

# ----------------------------------------------------------------- foley from the picture
MAP = {
    'pen': pen, 'snap': blocksnap, 'clack': clack, 'knife': snick,
    'stamp': stamp, 'slide': paperslide, 'thump': felt, 'thunk': felt,
    'carriage': carriage,
}
for e in EVENTS:
    ty, at, g = e['type'], float(e['t']), float(e.get('g', 1.0))
    if ty == 'slam':
        f(snick(1.0), at, 1.0)
        f(paperslap(1.0), at + 0.02, 0.9)
        f(felt(1.0), at + 0.03, 1.0)
        continue
    if ty in ('stop', 'glide'):
        continue
    fn = MAP.get(ty)
    if fn is None:
        continue
    if ty == 'thunk':
        f(fn(1.0), at, g * 0.9)
    else:
        f(fn(1.0), at, g * 0.7)

# ----------------------------------------------------------------- mix
# A hard stop of everything on the downbeat of the slam, so the next snap reads as an event.
gate = np.ones(N)
for a, b, lo in [(25.02, 25.95, 0.0), (48.55, 48.98, 0.0), (101.2, DUR, 0.0)]:
    i0, i1 = int(a * SR), min(N, int(b * SR))
    ramp = int(0.02 * SR)
    gate[i0:i1] = lo
    gate[max(0, i0 - ramp):i0] = np.linspace(1, lo, min(ramp, i0))
    if i1 < N:
        gate[i1:i1 + ramp] = np.linspace(lo, 1, len(gate[i1:i1 + ramp]))
music *= gate[:, None]

# Print foley is all transient. Compressed hard, so the film's average level can sit high
# without the peaks forcing a limiter to work for 9 dB at the master stage.
music = np.stack([compress(music[:, c], thr=0.16, ratio=4.0, att=0.006, rel=0.12) for c in (0, 1)], axis=1)
music = norm(music, 0.70)
foley = np.stack([compress(foley[:, c], thr=0.10, ratio=7.0, att=0.002, rel=0.09) for c in (0, 1)], axis=1)
foley = norm(foley, 0.80)

mix = music * 0.72 + foley * 0.80

# keep the low end honest: 20-120 Hz about 3 dB under the rest
low = np.stack([lp(mix[:, c], 120) for c in (0, 1)], axis=1)
rest = mix - low
lo_e, hi_e = float(np.sqrt(np.mean(low ** 2))), float(np.sqrt(np.mean(rest ** 2)))
if lo_e > 0:
    mix = low * min(1.0, (hi_e * 0.70) / lo_e) + rest

mix = norm(mix, 0.92)
stereo = np.stack([limit(mix[:, c], 0.89) for c in (0, 1)], axis=1)
mix = stereo[:, 0]

out = os.path.join(HERE, 'out')
os.makedirs(out, exist_ok=True)
path = os.path.join(out, 'mix.wav')
sf.write(path, stereo, SR, subtype='PCM_24')
print(f'{path}  {len(mix) / SR:.2f}s  peak {np.abs(mix).max():.3f}  rms {np.sqrt(np.mean(mix ** 2)):.4f}')
