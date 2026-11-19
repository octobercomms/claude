#!/usr/bin/env python
"""Write cues.json for the .srt from the same times the page and the mix use."""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'story.js'), encoding='utf-8').read()
dur = json.load(open(os.path.join(HERE, 'voices', 'dur.json')))
rows = re.findall(r"\{ id: '(v\d)', t: ([\d.]+), sub: '((?:[^'\\]|\\.)*)' \}", src)
out = []
for vid, t, sub in rows:
    t = float(t)
    txt = sub.replace("\\'", "'")
    hold = max(dur[vid] + 0.6, len(txt) / 15 + 1.5, 1.8)
    out.append({'t0': round(t, 3), 't1': round(t + hold, 3), 'text': txt})
json.dump(out, open(os.path.join(HERE, 'cues.json'), 'w'), indent=1, ensure_ascii=False)
print(len(out), 'cues')
