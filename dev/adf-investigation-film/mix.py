#!/usr/bin/env python
"""Score, foley and voice for Where the Year Goes.

The investigation-desk palette, synthesised: a low D held by bowed strings, a pendulum tick on
the half second, a pizzicato ostinato (Dm - Bb - Gm - A) under the slow sections, tremolo clusters
for the findings and a resolving D minor add9 for the evidence map. Foley is paper, pencil,
keystrokes, a rewind sweep and one deep thump.

The voice is Kokoro am_michael, compressed and balanced about 10 dB over the music; the music
ducks a further 9 dB while a line is speaking, as the style asks. Every timing comes from
film.json, which the picture reads too.
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
FILM = json.load(open(os.path.join(HERE, 'film.json')))
EVENTS = json.load(open(os.path.join(HERE, 'events.json')))['ev']
DUR = float(FILM['dur'])
N = int(DUR * SR)
CUES = {c['id']: c for c in FILM['cues']}
SEC = {s['id']: s for s in FILM['sections']}

rng = np.random.default_rng(190337)
music = np.zeros((N, 2), dtype=np.float64)
foley = np.zeros((N, 2), dtype=np.float64)
voice = np.zeros((N, 2), dtype=np.float64)


def m(x, at, g=1.0, pan=0.0):
    add(music, x, at, g, pan)


def f(x, at, g=1.0, pan=0.0):
    add(foley, x, at, g, pan)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


# ----------------------------------------------------------------- instruments
def bowed(note, d, v=1.0, bright=0.5):
    """Contrabass and cellos holding one note: a few detuned saws, slow bow, no vibrato."""
    tt = t_(d)
    f0 = midi(note)
    x = np.zeros_like(tt)
    for det, amp in ((0.0, 1.0), (-0.09, 0.6), (0.14, 0.5), (0.0, 0.35)):
        ff = f0 * (1 + det / 100)
        for k in (1, 2, 3, 4, 5):
            x += (amp / k ** 1.4) * np.sin(2 * np.pi * ff * k * tt + k * 0.7)
    x = lp(x, 180 + 700 * bright)
    bow = np.minimum(1.0, tt / 1.2) * np.minimum(1.0, (d - tt) / 1.4)
    bow = bow * (1 + 0.04 * np.sin(2 * np.pi * 0.17 * tt))
    return norm(x * np.maximum(bow, 0)) * v


def pizz(note, d=0.6, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    x = sum(np.sin(2 * np.pi * f0 * k * tt) * np.exp(-tt * (7 + k * 5)) / k for k in (1, 2, 3, 4, 5))
    x += lp(noise(d), 2500) * env_exp(d, 0.004) * 0.4
    return norm(x) * v


def cluster(note, d=2.4, v=1.0):
    """Tremolo minor-second cluster: tension under a finding."""
    tt = t_(d)
    trem = 0.5 + 0.5 * np.sin(2 * np.pi * 7.5 * tt)
    x = (np.sin(2 * np.pi * midi(note) * tt) + np.sin(2 * np.pi * midi(note + 1) * tt) * 0.9)
    x = lp(x, 1400) * trem
    e = np.minimum(1, tt / 0.25) * np.minimum(1, (d - tt) / 0.8)
    return norm(x * e) * v


def chord(notes, d=4.0, v=1.0):
    tt = t_(d)
    x = sum(np.sin(2 * np.pi * midi(n) * tt + i) / (1 + i * 0.3) for i, n in enumerate(notes))
    x += sum(0.25 * np.sin(2 * np.pi * midi(n + 12) * tt) * np.exp(-tt * 0.8) for n in notes[:2])
    e = np.minimum(1, tt / 0.9) * np.minimum(1, (d - tt) / 2.0)
    return norm(lp(x, 2600) * e) * v


def pendulum(v=1.0):
    """A clock tick: wood, dry, no ring."""
    d = 0.08
    tt = t_(d)
    x = bp(noise(d), 1200, 5200) * env_exp(d, 0.004)
    x += np.sin(2 * np.pi * 900 * tt) * env_exp(d, 0.006) * 0.4
    return norm(x) * v


# ----------------------------------------------------------------- foley
def paper(v=1.0):
    d = 0.42
    n = noise(d)
    out = np.zeros_like(n)
    for i in range(0, len(n), 480):
        ff = 900 + 2400 * (i / len(n))
        out[i:i + 480] = bp(n[i:i + 480], ff, min(ff * 2.3, 15000))
    return norm(out * (np.minimum(1, t_(d) / 0.05) * env_exp(d, 0.2))) * v * 0.8


def pencil(v=1.0):
    d = 0.5
    x = bp(noise(d), 1800, 6500) * (np.minimum(1, t_(d) / 0.02) * env_exp(d, 0.3))
    x *= 0.6 + 0.4 * np.sin(2 * np.pi * 14 * t_(d))
    return norm(x) * v * 0.7


def key(v=1.0):
    d = 0.13
    tt = t_(d)
    x = bp(noise(d), 1600, 7000) * env_exp(d, 0.005)
    x += np.sin(2 * np.pi * 320 * tt) * env_exp(d, 0.02) * 0.5
    return norm(x) * v


def tap(v=1.0):
    d = 0.09
    x = bp(noise(d), 2200, 8000) * env_exp(d, 0.004)
    return norm(x) * v


def stamp(v=1.0):
    d = 0.24
    tt = t_(d)
    x = lp(noise(d), 2400) * env_exp(d, 0.012)
    x += np.sin(2 * np.pi * 120 * tt) * env_exp(d, 0.06) * 0.9
    return norm(x) * v


def thump(v=1.0):
    d = 0.9
    tt = t_(d)
    x = np.sin(2 * np.pi * 54 * tt * (1 - 0.18 * tt)) * env_exp(d, 0.16)
    x += lp(noise(d), 420) * env_exp(d, 0.03) * 0.5
    return norm(x) * v


def sweep(v=1.0):
    """The rewind: a band sweeping down with scan-line chatter."""
    d = 0.8
    n = noise(d)
    out = np.zeros_like(n)
    for i in range(0, len(n), 240):
        ff = 6000 * (1 - i / len(n)) + 300
        out[i:i + 240] = bp(n[i:i + 240], ff, min(ff * 1.8, 17000))
    out *= 0.6 + 0.4 * np.sin(2 * np.pi * 42 * t_(d))
    return norm(out * np.minimum(1, (d - t_(d)) / 0.2)) * v * 0.8


FOLEY = {'paper': paper, 'pencil': pencil, 'key': key, 'tap': tap,
         'stamp': stamp, 'thump': thump, 'sweep': sweep, 'tick': pendulum}

# ----------------------------------------------------------------- the bed
# A low D held under the whole film, moving only where the sections move.
D1, D2 = 26, 38
BED = [(0.0, SEC['record']['t0'], D1, 0.30), (SEC['record']['t0'], SEC['sale']['t0'], D1, 0.34),
       (SEC['sale']['t0'], SEC['year']['t0'], D2 - 7, 0.32), (SEC['year']['t0'], SEC['costs']['t0'], D1, 0.40),
       (SEC['costs']['t0'], SEC['compare']['t0'], D1 + 5, 0.38), (SEC['compare']['t0'], SEC['board']['t0'], D2 - 5, 0.34),
       (SEC['board']['t0'], SEC['map']['t0'], D1, 0.30), (SEC['map']['t0'], DUR, D1, 0.34)]
for a, b, note, g in BED:
    t = a
    while t < b - 0.1:
        d = min(7.5, b - t)
        m(bowed(note, d, 1.0, 0.35), t, g)
        t += max(1.0, d - 1.2)      # the overlap must never exceed the note, or t stops advancing

# The pendulum: every half second through the sections that are about the clock.
for a, b in [(SEC['sale']['t0'], SEC['sale']['t1']), (SEC['year']['t0'], SEC['year']['t1'])]:
    t = a
    i = 0
    while t < b:
        m(pendulum(0.30 if i % 2 else 0.42), t, 0.5)
        t += 0.5
        i += 1

# Pizzicato ostinato, Dm - Bb - Gm - A, under the reading sections.
OST = [[50, 53, 57], [46, 53, 58], [43, 50, 58], [45, 52, 57]]
for a, b in [(SEC['record']['t0'], SEC['record']['t1']), (SEC['costs']['t0'], SEC['costs']['t1']),
             (SEC['compare']['t0'], SEC['compare']['t1'])]:
    t, i = a, 0
    while t < b - 0.4:
        ch = OST[(i // 4) % 4]
        m(pizz(ch[i % 3] - 12, 0.7, 0.34), t, 0.6, pan=-0.25 + 0.5 * ((i % 3) / 2))
        t += 0.5
        i += 1

# Findings: a tremolo cluster under each verdict, then it clears.
for lid in ('l11', 'l17', 'l22'):
    m(cluster(50, 2.6, 0.30), CUES[lid]['t0'] - 0.5, 0.65)

# The overlap, the one moment the film is about.
m(cluster(53, 3.0, 0.42), CUES['l16']['t0'] - 0.4, 0.8)
m(bowed(D1 - 2, 5.0, 0.8, 0.2), CUES['l16']['t0'], 0.5)

# The evidence map resolves: D minor add9 with a bell on top.
m(chord([38, 45, 50, 53, 57], 7.0, 0.42), SEC['map']['t0'] + 1.0, 0.7)
m(chord([38, 45, 50, 53, 60], 6.0, 0.40), CUES['l29']['t0'], 0.7)

# ----------------------------------------------------------------- foley from the picture
for e in EVENTS:
    fn = FOLEY.get(e['type'])
    if fn is None:
        continue
    f(fn(1.0), float(e['t']), float(e.get('g', 1.0)) * (0.5 if e['type'] == 'tick' else 0.75))

# ----------------------------------------------------------------- voice
dur = json.load(open(os.path.join(HERE, 'voices', 'dur.json')))
duck = np.zeros(N)
for c in FILM['cues']:
    path = os.path.join(HERE, 'voices', f"{c['id']}.wav")
    if not os.path.exists(path):
        continue
    w, sr = sf.read(path)
    if w.ndim > 1:
        w = w.mean(axis=1)
    if sr != SR:                      # Kokoro writes 24 kHz; the film runs at 48
        idx = np.arange(int(len(w) * SR / sr)) * sr / SR
        w = np.interp(idx, np.arange(len(w)), w)
    w = compress(norm(w, 0.9), thr=0.12, ratio=4.0, att=0.004, rel=0.12)
    add(voice, w, c['t0'], 0.88)
    i0 = int((c['t0'] - 0.25) * SR)
    i1 = min(N, int((c['t0'] + len(w) / SR + 0.45) * SR))
    duck[max(0, i0):i1] = 1.0

# smooth the duck so it does not click. A running mean through a cumulative sum: np.convolve
# with a 5,760-tap kernel over nine million samples is tens of billions of operations.
k = int(0.12 * SR)
pad = np.concatenate([np.zeros(k // 2), duck, np.zeros(k - k // 2)])
cs = np.concatenate([[0.0], np.cumsum(pad)])
duck = (cs[k:k + N] - cs[:N]) / k
gain = 10 ** (-9.0 * duck / 20)       # music ducks about 9 dB under the voice

music = np.stack([compress(music[:, c], thr=0.22, ratio=3.0) for c in (0, 1)], axis=1)
music = norm(music, 0.55) * gain[:, None]
foley = np.stack([compress(foley[:, c], thr=0.14, ratio=5.0, att=0.002, rel=0.09) for c in (0, 1)], axis=1)
foley = norm(foley, 0.62) * (0.45 + 0.55 * (1 - duck))[:, None]
voice = norm(voice, 0.9)

mix = voice * 0.92 + music * 0.52 + foley * 0.40

low = np.stack([lp(mix[:, c], 120) for c in (0, 1)], axis=1)
rest = mix - low
lo_e, hi_e = float(np.sqrt(np.mean(low ** 2))), float(np.sqrt(np.mean(rest ** 2)))
if lo_e > 0:
    mix = low * min(1.0, (hi_e * 0.70) / lo_e) + rest

mix = norm(mix, 0.92)
stereo = np.stack([limit(mix[:, c], 0.88) for c in (0, 1)], axis=1)

out = os.path.join(HERE, 'out')
os.makedirs(out, exist_ok=True)
path = os.path.join(out, 'mix.wav')
sf.write(path, stereo, SR, subtype='PCM_24')
mono = stereo[:, 0]
print(f'{path}  {len(mono) / SR:.2f}s  peak {np.abs(mono).max():.3f}  rms {np.sqrt(np.mean(mono ** 2)):.4f}')
