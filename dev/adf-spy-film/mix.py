#!/usr/bin/env python
"""Score, foley and briefing for The Quarter.

A 1960s spy big band, synthesised: stacked staccato brass in octaves with a crash on the stab,
low surf-guitar twang through a spring reverb, walking upright bass, brushes, bongos and shaker,
vibraphone, flute and organ. D minor at 144 BPM, an original motif.

Stabs are the edit points, placed 8 ms early so the peak lands on the frame. The stop-time is a
true zero: the gate takes the reverb tails with it.

The briefing runs through a tape chain: band-pass 220-5200 Hz, soft saturation, slow wow and a
hiss that rises underneath it.
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
EVENTS = EV['ev']
DUR = float(EV['dur'])
N = int(DUR * SR)

BPM = 144.0
BEAT = 60.0 / BPM
BAR = BEAT * 4
bar = lambda n: (n - 1) * BAR
rng = np.random.default_rng(6011)

music = np.zeros((N, 2), dtype=np.float64)
foley = np.zeros((N, 2), dtype=np.float64)
voice = np.zeros((N, 2), dtype=np.float64)

m = lambda x, at, g=1.0, pan=0.0: add(music, x, at, g, pan)
f = lambda x, at, g=1.0, pan=0.0: add(foley, x, at, g, pan)
midi = lambda n: 440.0 * 2 ** ((n - 69) / 12)


# ----------------------------------------------------------------- the band
def brass(note, d, v=1.0, bite=1.0):
    """Stacked trumpets and trombones: bright, hard attack, no vibrato, cut short."""
    tt = t_(d)
    f0 = midi(note)
    x = np.zeros_like(tt)
    for k in range(1, 13):
        amp = (1.0 / k ** 0.82) * (1.0 + 0.5 * bite * (k in (3, 4, 5, 6)))
        x += amp * np.sin(2 * np.pi * f0 * k * tt + k * 0.21)
    x = bp(x, 260, 4200)
    att = np.minimum(1.0, tt / 0.008)
    env = att * (0.25 + 0.75 * np.exp(-tt / (d * 0.33)))
    env *= np.minimum(1.0, (d - tt) / 0.02)
    return norm(x * env) * v


def crash(v=1.0):
    d = 1.9
    x = hp(noise(d), 2600) * (np.minimum(1, t_(d) / 0.002) * np.exp(-t_(d) / 0.55))
    x += hp(noise(d), 7000) * np.exp(-t_(d) / 0.22) * 0.6
    return norm(x) * v


def upright(note, d, v=1.0):
    """Walking bass: a plucked string with a short wooden thump on the attack."""
    tt = t_(d)
    f0 = midi(note)
    x = (np.sin(2 * np.pi * f0 * tt) + 0.42 * np.sin(2 * np.pi * f0 * 2 * tt)
         + 0.2 * np.sin(2 * np.pi * f0 * 3 * tt) + 0.09 * np.sin(2 * np.pi * f0 * 4 * tt))
    x *= np.exp(-tt / (d * 0.5))
    x += lp(noise(d), 900) * env_exp(d, 0.006) * 0.5
    x *= np.minimum(1.0, tt / 0.004)
    return norm(x) * v


def twang(note, d=0.9, v=1.0):
    """Low surf guitar: a plucked comb, then a spring."""
    f0 = midi(note)
    L = max(2, int(SR / f0))
    n = int(d * SR)
    buf = rng.standard_normal(L) * np.hanning(L)
    out = np.zeros(n)
    idx = 0
    for i in range(n):
        v0 = buf[idx]
        nxt = buf[(idx + 1) % L]
        buf[idx] = (v0 * 0.52 + nxt * 0.48) * 0.9965
        out[i] = v0
        idx = (idx + 1) % L
    out = lp(out, 2400) * np.exp(-t_(d) / (d * 0.7))
    return norm(spring(out)) * v


def spring(x, taps=((0.031, 0.42), (0.058, 0.3), (0.091, 0.2), (0.137, 0.13))):
    """A cheap spring reverb: a few bright delayed taps with a little feedback."""
    out = x.copy()
    for dt, a in taps:
        d = int(dt * SR)
        if d < len(x):
            out[d:] += x[:-d] * a
    out = hp(out, 380)
    d2 = int(0.071 * SR)
    if d2 < len(out):
        out[d2:] += out[:-d2] * 0.22
    return out


def brush(v=1.0, d=0.22):
    x = bp(noise(d), 1800, 8000) * (np.minimum(1, t_(d) / 0.01) * np.exp(-t_(d) / 0.07))
    return norm(x) * v


def bongo(note, v=1.0):
    d = 0.26
    tt = t_(d)
    f0 = midi(note)
    x = np.sin(2 * np.pi * f0 * tt * (1 - 0.35 * tt)) * np.exp(-tt / 0.07)
    x += bp(noise(d), 600, 3200) * env_exp(d, 0.008) * 0.7
    return norm(x) * v


def shaker(v=1.0):
    d = 0.12
    x = hp(noise(d), 5200) * (np.minimum(1, t_(d) / 0.004) * np.exp(-t_(d) / 0.03))
    return norm(x) * v


def vibe(note, d=1.1, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    trem = 1 + 0.22 * np.sin(2 * np.pi * 5.2 * tt)
    x = np.sin(2 * np.pi * f0 * tt) * np.exp(-tt / (d * 0.55))
    x += 0.3 * np.sin(2 * np.pi * f0 * 4 * tt) * np.exp(-tt / (d * 0.17))
    return norm(x * trem) * v


def flute(note, d=0.7, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    x = np.sin(2 * np.pi * f0 * tt) + 0.12 * np.sin(2 * np.pi * f0 * 2 * tt)
    x = x * (np.minimum(1, tt / 0.05) * np.minimum(1, (d - tt) / 0.08))
    x += lp(noise(d), 3000) * 0.07 * np.minimum(1, tt / 0.05)
    return norm(x) * v


def organ(note, d=0.3, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    x = (np.sin(2 * np.pi * f0 * tt) + 0.6 * np.sin(2 * np.pi * f0 * 2 * tt)
         + 0.4 * np.sin(2 * np.pi * f0 * 3 * tt))
    x *= np.minimum(1, tt / 0.006) * np.minimum(1, (d - tt) / 0.02)
    return norm(x) * v


# ----------------------------------------------------------------- foley
def slap(v=1.0):
    d = 0.19
    x = bp(noise(d), 500, 4200) * env_exp(d, 0.012)
    x += np.sin(2 * np.pi * 180 * t_(d)) * env_exp(d, 0.03) * 0.5
    return norm(x) * v


def cardslide(v=1.0):
    d = 0.34
    n = noise(d)
    out = np.zeros_like(n)
    for i in range(0, len(n), 480):
        ff = 1400 + 3400 * (i / len(n))
        out[i:i + 480] = bp(n[i:i + 480], ff, min(ff * 2.1, 15000))
    return norm(out * (np.minimum(1, t_(d) / 0.03) * np.exp(-t_(d) / 0.14))) * v * 0.8


def step(v=1.0):
    d = 0.16
    x = lp(noise(d), 1500) * env_exp(d, 0.012)
    x += np.sin(2 * np.pi * 95 * t_(d)) * env_exp(d, 0.03) * 0.6
    return norm(x) * v


def tape(v=1.0):
    d = 0.1
    x = bp(noise(d), 1800, 6000) * env_exp(d, 0.004)
    return norm(x) * v


def blind(v=1.0):
    d = 0.45
    out = np.zeros(int(d * SR))
    for i in range(7):
        s = int(i * 0.045 * SR)
        c = bp(noise(0.05), 1200, 7000) * env_exp(0.05, 0.004)
        out[s:s + len(c)] += c * (1 - i * 0.1)
    return norm(out) * v


def settle(v=1.0):
    d = 0.5
    x = bp(noise(d), 700, 5000) * (np.minimum(1, t_(d) / 0.02) * np.exp(-t_(d) / 0.16))
    return norm(x) * v


def tick(v=1.0):
    d = 0.07
    x = hp(noise(d), 3000) * env_exp(d, 0.003)
    return norm(x) * v


FOLEY = {'slap': slap, 'cardslide': cardslide, 'step': step, 'tape': tape,
         'blind': blind, 'settle': settle, 'tick': tick, 'shake': shaker, 'crash': crash}

# ----------------------------------------------------------------- the arrangement
D = 50                      # D3
SCALE = [50, 52, 53, 55, 57, 58, 60]        # D natural minor
WALK = [38, 41, 45, 43, 36, 41, 43, 45]     # the bass walks a bar at a time

FREEZE0, FREEZE1 = bar(30), bar(32)
BAND_BACK = bar(34)


def playing(t):
    """The band is out through the stop-time and the price card."""
    return not (FREEZE0 - 0.02 <= t < BAND_BACK)


# walking bass, brushes: the spine, from the top until the freeze, then back for the finish
for i in range(0, 42 * 4):
    t = i * BEAT
    if t >= DUR or not playing(t):
        continue
    note = WALK[i % len(WALK)]
    m(upright(note, BEAT * 0.92, 0.9), t, 0.52)
    m(brush(0.5 if i % 2 else 0.72), t, 0.3, pan=0.25)
    if i % 4 == 2:
        m(brush(0.4), t + BEAT * 0.5, 0.24, pan=-0.3)

# bongos and shaker once the chase is on
for i in range(0, 42 * 8):
    t = i * BEAT * 0.5
    if t < bar(7) or t >= DUR or not playing(t):
        continue
    if t >= bar(14) and t < bar(20):
        continue
    m(shaker(0.5 if i % 2 else 0.8), t, 0.16, pan=-0.35)
    if i % 4 == 0:
        m(bongo(62 if i % 8 == 0 else 57, 0.6), t, 0.3, pan=0.3)

# the motif: a dotted chromatic figure the brass take over in the network section
MOTIF = [(0, 50), (1.5, 51), (2, 53), (3, 50), (4, 57), (5.5, 56), (6, 55), (7, 53)]
for b in (7, 9, 11, 20, 22, 35, 37):
    for off, n in MOTIF:
        t = bar(b) + off * BEAT * 0.5
        if t >= DUR or not playing(t):
            continue
        if b < 14:
            m(twang(n - 12, 0.8, 0.5), t, 0.5, pan=-0.2)
        else:
            m(brass(n, BEAT * 0.42, 0.52), t, 0.62)
            m(brass(n + 12, BEAT * 0.42, 0.3), t, 0.4, pan=0.2)

# the inbox is quieter: flute and vibraphone over the bass, no brass
for i, n in enumerate([62, 65, 69, 67, 65, 62, 60, 62]):
    t = bar(14) + i * BEAT
    if t >= DUR:
        continue
    m(flute(n, BEAT * 0.9, 0.34), t, 0.5, pan=0.15)
    if i % 2 == 0:
        m(vibe(n - 12, 1.2, 0.3), t, 0.45, pan=-0.2)

# the guide: the brass thin out to organ stabs on the off-beats
for i in range(12):
    t = bar(25) + i * BEAT + BEAT * 0.5
    if t >= FREEZE0:
        continue
    m(organ(SCALE[i % len(SCALE)], 0.22, 0.3), t, 0.4, pan=0.2 if i % 2 else -0.2)

# the stabs: every edit point, 8 ms early so the peak lands on the frame
for s in EVENTS:
    if s['type'] != 'stab':
        continue
    t = float(s['t']) - 0.008
    if not playing(t + 0.02) and t < BAND_BACK - 0.1:
        continue
    for n in (38, 50, 57, 62):
        m(brass(n, BEAT * 0.75, 0.6), t, 0.7)
    m(crash(0.7), t, 0.5)

# the band comes back on the downbeat, under the hand-off
for i in range(4):
    m(brass(50 + [0, 3, 7, 10][i], BEAT * 0.6, 0.5), BAND_BACK + i * BEAT * 0.5, 0.6)
m(crash(0.8), BAND_BACK, 0.55)

# the title: the big chord, then a short button
TITLE = bar(39)
for n in (38, 45, 50, 53, 57, 62):
    m(brass(n, 2.1, 0.55, bite=1.3), TITLE, 0.72)
m(crash(1.0), TITLE, 0.7)
for n in (38, 50, 57):
    m(brass(n, 0.3, 0.6), DUR - 1.1, 0.75)
m(crash(0.6), DUR - 1.1, 0.4)

# ----------------------------------------------------------------- foley from the picture
for e in EVENTS:
    fn = FOLEY.get(e['type'])
    if fn is None:
        continue
    f(fn(1.0), float(e['t']), float(e.get('g', 1.0)) * 0.6)

# ----------------------------------------------------------------- the briefing, on tape
VO = [('v1', 11.5), ('v2', 23.5), ('v3', 32.8), ('v4', 41.2), ('v5', 51.5), ('v6', 58.0)]
duck = np.zeros(N)
for vid, at in VO:
    path = os.path.join(HERE, 'voices', f'{vid}.wav')
    if not os.path.exists(path):
        continue
    w, sr = sf.read(path)
    if w.ndim > 1:
        w = w.mean(axis=1)
    if sr != SR:
        idx = np.arange(int(len(w) * SR / sr)) * sr / SR
        w = np.interp(idx, np.arange(len(w)), w)
    # tape: band-pass, soft saturation, slow wow, hiss underneath
    w = bp(w, 220, 5200)
    w = np.tanh(w * 2.4) / 2.4
    tt = np.arange(len(w)) / SR
    warp = np.cumsum(1.0 + 0.0045 * np.sin(2 * np.pi * 0.7 * tt) + 0.0022 * np.sin(2 * np.pi * 2.3 * tt))
    w = np.interp(np.clip(warp, 0, len(w) - 1), np.arange(len(w)), w)
    hiss = bp(rng.standard_normal(len(w)), 900, 7000) * 0.016
    w = norm(w, 0.9) + hiss
    w = compress(w, thr=0.14, ratio=3.5, att=0.004, rel=0.1)
    add(voice, w, at, 0.9)
    i0, i1 = int((at - 0.2) * SR), min(N, int((at + len(w) / SR + 0.35) * SR))
    duck[max(0, i0):i1] = 1.0

k = int(0.1 * SR)
pad = np.concatenate([np.zeros(k // 2), duck, np.zeros(k - k // 2)])
cs = np.concatenate([[0.0], np.cumsum(pad)])
duck = (cs[k:k + N] - cs[:N]) / k

# ----------------------------------------------------------------- mix
# Stop-time is a true zero, reverb tails included; one tape click is allowed to remain.
gate = np.ones(N)
i0, i1 = int(FREEZE0 * SR), int(BAND_BACK * SR)
gate[i0:i1] = 0.0
r = int(0.015 * SR)
gate[i0 - r:i0] = np.linspace(1, 0, r)
gate[i1:i1 + r] = np.linspace(0, 1, r)
music *= gate[:, None]
foley[i0:i1] *= 0.0
# the one tape click the style allows in the silence
f(tape(0.55), FREEZE0 + 0.35, 1.0)

music = np.stack([compress(music[:, c], thr=0.18, ratio=3.2, att=0.004, rel=0.1) for c in (0, 1)], axis=1)
music = norm(music, 0.72) * (10 ** (-7.0 * duck / 20))[:, None]
foley = np.stack([compress(foley[:, c], thr=0.12, ratio=5.0, att=0.002, rel=0.08) for c in (0, 1)], axis=1)
foley = norm(foley, 0.6)
voice = norm(voice, 0.88)

mix = music * 0.78 + foley * 0.5 + voice * 0.9

low = np.stack([lp(mix[:, c], 120) for c in (0, 1)], axis=1)
rest = mix - low
lo_e, hi_e = float(np.sqrt(np.mean(low ** 2))), float(np.sqrt(np.mean(rest ** 2)))
if lo_e > 0:
    mix = low * min(1.0, (hi_e * 0.72) / lo_e) + rest

# a peaky big band needs a few dB into the limiter before loudnorm can reach -14
mix = norm(mix, 1.08)
stereo = np.stack([limit(mix[:, c], 0.86) for c in (0, 1)], axis=1)

out = os.path.join(HERE, 'out')
os.makedirs(out, exist_ok=True)
path = os.path.join(out, 'mix.wav')
sf.write(path, stereo, SR, subtype='PCM_24')
mono = stereo[:, 0]
print(f'{path}  {len(mono) / SR:.2f}s  peak {np.abs(mono).max():.3f}  rms {np.sqrt(np.mean(mono ** 2)):.4f}')
