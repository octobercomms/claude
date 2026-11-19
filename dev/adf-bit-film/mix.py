#!/usr/bin/env python
"""Score and foley for The Desk.

The medium is mechanical and printed, so the machines carry the rhythm: a relay, a print head
stepping two to the beat, a drum motor, stamps on cork, card slaps, a drawer. Under them a small,
cold ensemble, synthesised: bass clarinet, glockenspiel, pizzicato low strings and a slightly
detuned upright piano, at 120 BPM.

The one real silence is the price: everything drops for two beats and only the printer motor,
two rooms away and filtered down, is left.

The style asks for little energy below 45 Hz, so the whole mix is high-passed there.
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

BEAT = 0.5
rng = np.random.default_rng(10111)
music = np.zeros((N, 2), dtype=np.float64)
foley = np.zeros((N, 2), dtype=np.float64)
m = lambda x, at, g=1.0, pan=0.0: add(music, x, at, g, pan)
f = lambda x, at, g=1.0, pan=0.0: add(foley, x, at, g, pan)
midi = lambda n: 440.0 * 2 ** ((n - 69) / 12)


# ----------------------------------------------------------------- the ensemble
def bcl(note, d, v=1.0):
    """Bass clarinet: odd harmonics, a little breath, slow in and out."""
    tt = t_(d)
    f0 = midi(note)
    x = (np.sin(2 * np.pi * f0 * tt) + 0.5 * np.sin(2 * np.pi * f0 * 3 * tt)
         + 0.22 * np.sin(2 * np.pi * f0 * 5 * tt) + 0.1 * np.sin(2 * np.pi * f0 * 7 * tt))
    x = lp(x, 2200)
    x += lp(noise(d), 1600) * 0.05
    e = np.minimum(1, tt / 0.18) * np.minimum(1, (d - tt) / 0.35)
    return norm(x * e) * v


def glock(note, d=1.4, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    x = sum(a * np.sin(2 * np.pi * f0 * k * tt) * np.exp(-tt / tau)
            for k, a, tau in [(1, 1.0, 0.5), (2.76, 0.42, 0.22), (5.4, 0.2, 0.1), (8.9, 0.1, 0.06)])
    return norm(x) * v


def pizz(note, d=0.5, v=1.0):
    tt = t_(d)
    f0 = midi(note)
    x = sum(np.sin(2 * np.pi * f0 * k * tt) * np.exp(-tt * (9 + k * 6)) / k for k in (1, 2, 3, 4))
    x += lp(noise(d), 2000) * env_exp(d, 0.004) * 0.35
    return norm(x) * v


def piano(note, d=1.2, v=1.0):
    """An upright that has not been tuned this year: two strings, slightly apart."""
    tt = t_(d)
    f0 = midi(note)
    x = np.zeros_like(tt)
    for det in (0.0, 0.0022, -0.0017):
        ff = f0 * (1 + det)
        for k, a in ((1, 1.0), (2, 0.42), (3, 0.2), (4, 0.11), (5, 0.06)):
            x += a * np.sin(2 * np.pi * ff * k * tt) * np.exp(-tt * (1.6 + k * 0.9))
    x += lp(noise(d), 3000) * env_exp(d, 0.003) * 0.3
    return norm(x) * v


# ----------------------------------------------------------------- the machines
def relay(v=1.0):
    d = 0.14
    x = bp(noise(d), 900, 5200) * env_exp(d, 0.004)
    x += np.sin(2 * np.pi * 240 * t_(d)) * env_exp(d, 0.012) * 0.5
    return norm(x) * v


def step(v=1.0):
    """One step of a print head."""
    d = 0.08
    tt = t_(d)
    x = bp(noise(d), 1500, 6500) * env_exp(d, 0.0035)
    x += np.sin(2 * np.pi * 520 * tt) * env_exp(d, 0.008) * 0.45
    return norm(x) * v


def stamp(v=1.0):
    """A rubber stamp on cork: a dull knock with no ring."""
    d = 0.3
    tt = t_(d)
    x = lp(noise(d), 1700) * env_exp(d, 0.01)
    x += np.sin(2 * np.pi * 132 * tt) * env_exp(d, 0.045) * 0.9
    x += np.sin(2 * np.pi * 76 * tt) * env_exp(d, 0.07) * 0.5
    return norm(x) * v


def slap(v=1.0):
    d = 0.18
    x = bp(noise(d), 700, 5200) * env_exp(d, 0.009)
    return norm(x) * v


def paper(v=1.0):
    d = 0.4
    n = noise(d)
    out = np.zeros_like(n)
    for i in range(0, len(n), 480):
        ff = 1100 + 2600 * (i / len(n))
        out[i:i + 480] = bp(n[i:i + 480], ff, min(ff * 2.2, 15000))
    return norm(out * (np.minimum(1, t_(d) / 0.04) * np.exp(-t_(d) / 0.15))) * v * 0.8


def drawer(v=1.0):
    d = 0.7
    x = bp(noise(d), 300, 2600) * (np.minimum(1, t_(d) / 0.05) * np.exp(-t_(d) / 0.22))
    x += np.sin(2 * np.pi * 90 * t_(d)) * env_exp(d, 0.1) * 0.4
    return norm(x) * v


def motor(d, v=1.0, cut=2600):
    """A drum motor: a hum with a little mechanical flutter."""
    tt = t_(d)
    x = (np.sin(2 * np.pi * 96 * tt) * 0.7 + np.sin(2 * np.pi * 192 * tt) * 0.3
         + np.sin(2 * np.pi * 288 * tt) * 0.12)
    x *= 1 + 0.08 * np.sin(2 * np.pi * 11.5 * tt)
    x += lp(noise(d), cut) * 0.1
    e = np.minimum(1, tt / 0.25) * np.minimum(1, (d - tt) / 0.5)
    return norm(lp(x, cut) * e) * v


FOLEY = {'relay': relay, 'step': step, 'stamp': stamp, 'slap': slap,
         'paper': paper, 'drawer': drawer, 'motor': lambda v=1.0: motor(2.0, v)}

# ----------------------------------------------------------------- the arrangement
PRICE0, PRICE1 = 45.0, 46.4            # the verdict hold: everything drops
D = [50, 53, 55, 57, 58, 60, 62]       # D natural minor


def quiet(t):
    return PRICE0 - 0.05 <= t < PRICE1


# the pulse: pizzicato on the beat from the list to the calendar
for i in range(int(DUR / BEAT)):
    t = i * BEAT
    if t < 7.0 or t >= 50.0 or quiet(t):
        continue
    note = D[(i // 2) % len(D)] - 24
    g = 0.5 if i % 2 else 0.72
    m(pizz(note, 0.46, g), t, 0.42, pan=-0.2 if i % 4 < 2 else 0.2)

# the hook: one long low note under the stamp
m(bcl(38, 6.4, 0.9), 0.35, 0.5)
m(glock(74, 1.6, 0.4), 0.55, 0.55)

# the list: the print head is the rhythm, the piano answers it
for i, n in enumerate([62, 65, 67, 69, 67, 65]):
    m(piano(n, 1.1, 0.34), 7.1 + i * 0.45, 0.5, pan=0.15)
m(bcl(43, 5.0, 0.6), 7.0, 0.42)

# the number, struck
m(glock(81, 2.0, 0.6), 12.0, 0.7)
m(bcl(38, 2.6, 0.7), 12.0, 0.5)

# the rates
for i, n in enumerate([74, 77, 81]):
    m(glock(n, 1.5, 0.45), 15.0 + i * 0.34, 0.6)
m(bcl(45, 3.6, 0.5), 15.2, 0.4)

# the edition: a four-note piano figure on the motor's pulse
for i in range(10):
    n = [62, 65, 69, 67][i % 4]
    m(piano(n, 1.0, 0.3), 19.2 + i * 0.5, 0.48, pan=-0.15 + (i % 3) * 0.15)
m(bcl(41, 6.0, 0.6), 19.0, 0.45)
m(motor(5.4, 0.5), 19.0, 0.42)

# the page, the banners, the posts
m(glock(72, 1.8, 0.5), 24.0, 0.55)
m(bcl(43, 3.2, 0.55), 24.2, 0.42)
for i in range(3):
    m(glock([69, 72, 76][i], 1.3, 0.42), 27.0 + i * 0.5, 0.55)
m(bcl(45, 4.0, 0.5), 27.2, 0.4)
for i in range(3):
    m(piano([65, 69, 72][i], 1.2, 0.34), 31.0 + i * 0.4, 0.5)

# the guide: the piano alone, slower
for i, n in enumerate([57, 60, 62, 65]):
    m(piano(n, 1.6, 0.36), 34.2 + i * 0.85, 0.5, pan=-0.1)
m(bcl(38, 4.0, 0.6), 34.0, 0.45)

# the calendar: clarinet and glockenspiel
for i, n in enumerate([69, 72, 74, 77]):
    m(glock(n, 1.6, 0.44), 38.4 + i * 1.1, 0.55, pan=-0.3 + i * 0.2)
m(bcl(45, 6.4, 0.6), 38.0, 0.45)
m(bcl(43, 2.2, 0.7), 42.4, 0.5)

# the price: nothing but the motor, two rooms away
m(motor(1.5, 0.3, cut=420), PRICE0, 0.3)

# the pull-back: the band returns and resolves
for i, n in enumerate([50, 57, 62, 65, 69]):
    m(bcl(n - 12, 7.0 - i * 0.6, 0.5), 46.6 + i * 0.25, 0.42)
for i, n in enumerate([74, 77, 81, 84]):
    m(glock(n, 2.4, 0.42), 50.0 + i * 0.9, 0.55, pan=-0.3 + i * 0.2)
for i in range(6):
    m(piano([62, 65, 69, 72, 69, 65][i], 1.8, 0.3), 50.4 + i * 0.7, 0.45)
m(bcl(38, 6.0, 0.8), 52.0, 0.55)
m(glock(86, 3.0, 0.5), 52.4, 0.6)

# ----------------------------------------------------------------- foley from the picture
for e in EVENTS:
    fn = FOLEY.get(e['type'])
    if fn is None:
        continue
    f(fn(1.0), float(e['t']), float(e.get('g', 1.0)) * 0.72)
# the printer runs under its whole shot
f(motor(5.6, 0.55), 19.0, 0.55)

# ----------------------------------------------------------------- mix
gate = np.ones(N)
i0, i1 = int(PRICE0 * SR), int(PRICE1 * SR)
r = int(0.02 * SR)
gate[i0:i1] = 0.0
gate[i0 - r:i0] = np.linspace(1, 0, r)
gate[i1:i1 + r] = np.linspace(0, 1, r)
music *= gate[:, None]
foley[i0 + int(0.12 * SR):i1] *= 0.0

music = np.stack([compress(music[:, c], thr=0.2, ratio=3.0) for c in (0, 1)], axis=1)
music = norm(music, 0.6)
foley = np.stack([compress(foley[:, c], thr=0.14, ratio=4.5, att=0.002, rel=0.09) for c in (0, 1)], axis=1)
foley = norm(foley, 0.78)

mix = music * 0.62 + foley * 0.9
# the medium wants little energy below 45 Hz
mix = np.stack([hp(mix[:, c], 45) for c in (0, 1)], axis=1)

mix = norm(mix, 0.95)
stereo = np.stack([limit(mix[:, c], 0.84) for c in (0, 1)], axis=1)

out = os.path.join(HERE, 'out')
os.makedirs(out, exist_ok=True)
path = os.path.join(out, 'mix.wav')
sf.write(path, stereo, SR, subtype='PCM_24')
mono = stereo[:, 0]
print(f'{path}  {len(mono) / SR:.2f}s  peak {np.abs(mono).max():.3f}  rms {np.sqrt(np.mean(mono ** 2)):.4f}')
