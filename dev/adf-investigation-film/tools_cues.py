#!/usr/bin/env python
"""Write cues.json from film.json, using the same split rule the page uses for subtitles."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
F = json.load(open(os.path.join(HERE, 'film.json')))
MAXC = 76
out = []
for c in F['cues']:
    txt = F['subs'].get(c['id'], '')
    t1 = round(c['t1'] + 0.25, 3)
    if len(txt) <= MAXC:
        out.append({'t0': c['t0'], 't1': t1, 'text': txt}); continue
    words = txt.split(' ')
    best, bestd, run = 0, 1e9, 0
    for i in range(len(words) - 1):
        run += len(words[i]) + 1
        d = abs(run - len(txt) / 2)
        if d < bestd: bestd, best = d, i
    a = ' '.join(words[:best + 1]); b = ' '.join(words[best + 1:])
    split = round(c['t0'] + (t1 - c['t0']) * (len(a) / len(txt)), 3)
    out.append({'t0': c['t0'], 't1': split, 'text': a})
    out.append({'t0': split, 't1': t1, 'text': b})
json.dump(out, open(os.path.join(HERE, 'cues.json'), 'w'), indent=1, ensure_ascii=False)
print(len(out), 'cues')
