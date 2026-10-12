# The October Human Writing Standard

**Applies to:** press releases, bylined articles, case studies, award entries,
and any copy issued in a client's name.
**Version:** 1.0, 2026-10-12
**Enforced by:** `.claude/skills/human-writing`, and the Humanity Checker
specified in `docs/october-outreach/HUMANITY-CHECKER-BRIEF.md`.

---

## 1. The rule

**Claude does everything except the prose.**

Research, angle options, interview questions, fact chasing, structure,
headline options, pitch variants, media lists, follow-ups: all automated.
The sentences of the release itself are written by a person, from a completed
fact sheet.

This is not a rule about detectors. It is a rule about reporting. The reason
AI-written releases fail is the same reason they get flagged: nobody gathered
the facts.

---

## 2. What the evidence showed

Three samples, Pangram 4.0, 12 October 2026:

| Sample | Origin | Words | Verdict |
|---|---|---|---|
| Agency prose about AI detection | Claude | 64 | 100% AI |
| Hollaway Studio F51 release extract | Human | 118 | 100% Human |
| Indiewalls boilerplate, hand-edited | Claude + edits | 68 | 100% AI |

Three correct results. The third is the one that decides the policy: editing a
Claude draft by hand did not shift it. The pattern lives in the structure of
the writing, not in its word choice, so editing at sentence level leaves it
where it was.

**There is no edit pass that converts AI prose into human prose.** The only
lever is where the prose originates.

---

## 3. How AI writes

Eight markers, all drawn from the two flagged samples.

**1. Coordinate lists.** Three or four items with an Oxford comma. The
Indiewalls extract carried three in 68 words: "hospitality, workplace,
multifamily, and healthcare"; "its brand, its community, and its history";
"printing, framing, and sampling". This is the loudest single marker.

**2. Perfect parallelism.** Items in a list share grammatical form exactly.
"Printing, framing, and sampling" is three gerunds in a row. People break
parallelism without noticing.

**3. Every sentence resolves.** Each one is a complete, balanced proposition
that earns its place. Nothing trails off, nothing arrives as an afterthought,
no clause turns up because the writer remembered something halfway through.

**4. Abstraction over specifics.** "Approaches every project as a work of
research" describes nothing checkable. The Indiewalls extract contained one
concrete noun in 68 words.

**5. The closing flourish.** The last sentence lands an interpretation or a
benefit rather than a fact: "giving the art consultancy control over quality
and lead time."

**6. Even information density.** Facts are distributed smoothly. Human copy
clumps three into one sentence and one into the next.

**7. No errors.** Grammatically immaculate from first word to last.

**8. Uniform register.** No shifts up or down in formality across the piece.

---

## 4. How humans write

Six markers, all from the Hollaway F51 extract.

**1. Seams and errors.** "Hollaway Studio's design for F51, features three
skateparks" puts a comma between subject and verb. The opening, "Describing it
as an 'adrenaline building'", is a dangling modifier that never says who is
describing. "Climbing wall… and boxing ring" drops its articles.

**2. Clumsy repetition.** "Ongoing programme" then "ongoing commitment" two
sentences later. "Folkestone Creative Quarter" then "landscape of Folkestone".
A model varies these automatically.

**3. Asymmetric emphasis.** "Placing community firmly at the very heart of its
work" stacks three intensifiers in one clause while the rest sits flat.

**4. Knowledge that cannot be inferred.** The climbing wall is the tallest in
the South East of England. Nobody works that out from context. Somebody knew it.

**5. Lumpy density.** Three facts in one sentence, one in the next.

**6. Lifted fragments.** Two quoted phrases pulled in from outside the text and
used as texture: "adrenaline building", "immaculately crafted".

**Do not manufacture markers 1 to 3.** Deliberately roughened AI prose is a
known category and detectors are trained on it. Markers 4 to 6 are the real
ones, and they come from reporting, not from style.

---

## 5. The specificity count

The single most useful measurement. Count every checkable item and divide by
word count.

A **checkable item** is a proper noun, a number, a date, a measurement, a
currency figure, a named material, an award, a publication, or a direct
quotation from a named source.

| Sample | Checkable | Words | Per 100 words |
|---|---|---|---|
| Hollaway F51 (human) | ~15 | 118 | **12.7** |
| Indiewalls (AI) | ~2 | 68 | **2.9** |
| Agency prose (AI) | ~2 | 64 | **3.1** |

**Target: 10 or more per 100 words. Below 6, the release is not ready.**

These counts are mine, from three samples, using the definition above. Treat
them as a working benchmark until October has calibrated against its own
corpus of 20 covered releases.

The useful property of this metric: it predicts coverage as well as it
predicts a detector verdict. Journalists bin releases for vagueness. Fixing
the count fixes both problems with one piece of work.

---

## 6. The six-move skeleton

Reverse-engineered from the Hollaway F51 release. Five of the six moves are
facts, which is why the model cannot fill them.

| # | Move | Hollaway's version |
|---|---|---|
| 1 | Hook phrase, lifted from a person | "adrenaline building" |
| 2 | Scope plus a superlative or hard number | three skateparks; tallest climbing wall in the South East of England |
| 3 | Material, method and siting | concrete beacon shrouded in mesh, Folkestone Creative Quarter |
| 4 | Impact on place or user | transformed the landscape, architecturally and for the community |
| 5 | Wider programme or context | part of the seaside town regeneration |
| 6 | Third-party proof | awards; The Guardian's best architecture of 2022; "immaculately crafted" |

---

## 7. The release fact sheet

The deliverable Claude produces. Slots, never sentences.

```
RELEASE BRIEF — [project]

NEWS HOOK          what changed, and when
                   →

THE SIX MOVES
1 Hook phrase      a line someone actually said
                   →
2 Scope            number, size, first / largest / tallest
                   →
3 Material         what it is made of, where it sits
                   →
4 Impact           what changed for the place or the user
                   →
5 Wider context    the programme, the portfolio, the trend
                   →
6 Third-party      award, publication, named collaborator
                   →

QUOTES             verbatim, named, with job titles
  Client           →
  Designer         →
  Third party      →

FACT SHEET
  Dates            →
  Dimensions       →
  Materials        →
  Cost             → (if disclosable)
  Exact location   →
  Full credits     → architect, contractor, structural, lighting, landscape
  Photographer     → name + required credit line

ASSETS
  Images           → count, resolution, captions
  Press contact    → named human, direct line

SPECIFICITY TARGET   10 checkable facts per 100 words
EMPTY SLOTS          [n]
```

---

## 8. The client interview

Roughly forty minutes, twelve questions. Record it. The recording is the
source of the quotes and, frequently, the hook phrase.

1. What is the one thing about this project you tell people first?
2. What was the brief, in the client's own words?
3. What was the hardest problem, and how was it solved?
4. What is the number nobody expects? Size, span, count, duration.
5. Is anything here a first, a largest, or an only?
6. What materials, and why those?
7. Who else worked on it, and what did they contribute?
8. What changed for the people who use it?
9. What does this project belong to? A programme, a portfolio, a trend.
10. Has anyone external said anything about it? Award, press, peer.
11. What nearly went wrong?
12. What would you do differently?

Questions 4, 5 and 10 produce the specificity. Question 1 usually produces
the hook phrase. Question 11 produces the detail that makes a journalist call.

---

## 9. The division of labour

| Stage | Claude | Human |
|---|---|---|
| Angle options | proposes | decides |
| Interview questions | writes | asks |
| Fact sheet | structures, flags gaps | fills |
| **Prose** | **does not write** | **writes or dictates** |
| Gap analysis | scores and highlights | acts on |
| Headlines | proposes 10 | picks and rewrites |
| Pitch emails | drafts variants | personalises |
| Media list | builds and dedupes | approves |
| Follow-ups | schedules and drafts | sends |

---

## 10. Writing the prose

**Dictate it.** Talk through the completed fact sheet into a voice note, then
tidy the transcript. Speech produces uneven sentence length, abandoned clauses,
repetition and afterthoughts without any effort. It is also faster than typing.

**Leave the seams.** Resist tidying every sentence to the same length. The
instinct to smooth is the instinct that produces machine-shaped copy.

**Quote people verbatim**, including the awkward phrasing. Never generate a
quote, and never tidy one into fluency.

**Lead with the fact, not the interpretation.** "The tallest climbing wall in
the South East of England" beats "a facility that redefines what a leisure
centre is able to be."

---

## 11. The package

For architecture and design press the package usually decides it before the
prose does.

- High-resolution images with photographer credits and captions. Twelve
  properly credited images beats elegant writing with two low-resolution JPEGs.
- Full project credits: architect, contractor, structural engineer, lighting,
  landscape, photographer.
- A fact sheet: dates, dimensions, materials, costs where disclosable.
- Named people with job titles saying something other than "delighted".
- A named human who answers the phone.

---

## 12. Time

| Stage | Time | Automated |
|---|---|---|
| Client interview | 30–40 min | question set only |
| Fact and asset chase | 45–60 min | checklist and chasing |
| Writing or dictation | 30–60 min | **no** |
| Approvals | variable | yes |

Writing is roughly a quarter of the job. Doing the prose by hand costs 30 to
45 minutes per release against a fully generated draft.

The metric is **cost per placement**, not cost per release. A 45-minute release
with no pickups has infinite cost per placement.

---

## 13. Disclosure

Where a client asks, the honest description of this process is: *researched,
structured and fact-checked with AI assistance; written by October.* That
statement is true under this standard and false under a generate-then-edit
workflow. Keeping it true is the point of the standard.
