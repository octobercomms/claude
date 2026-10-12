---
name: human-writing
description: Produce a reporting brief and fact sheet for a press release, case study, award entry, bylined article or any copy issued in a client's name, instead of generating the prose. Use whenever the user wants a press release written or drafted, mentions "press release", "PR", "media release", "case study", "award entry", "byline", "pitch a story", "announcement for a client", or asks why their copy reads as AI / fails an AI detector / isn't getting coverage. Also use when reviewing existing copy for specificity and the AI fingerprint. Enforces the October Human Writing Standard - Claude does research, structure, questions and gap analysis; the human writes the sentences.
metadata:
  version: 1.0.0
---

# Human Writing

The full standard is `docs/editorial/human-writing-standard.md`. Read it before
a first use in a session. This file is the operating summary.

## The rule

**Do not write the prose of a release.** Produce the fact sheet with empty
slots and the questions needed to fill them. The human writes the sentences.

Why: Pangram 4.0 testing on 12 October 2026 flagged a Claude draft at 100% AI,
flagged the same draft at 100% AI again after hand-editing, and correctly
cleared a human-written release. The fingerprint is structural, so editing at
sentence level does not shift it. The only lever is where the prose originates.

The commercial reason is the same reason: releases get binned by journalists
for vagueness, and vagueness is exactly what the detector reads. One piece of
work fixes both.

## What to produce

The fact sheet in §7 of the standard. Slots, never sentences. If you have
written a sentence of body copy, you have done the wrong thing.

Hard constraint: **never invent a fact, quote, name, measurement, date or
award.** An unknown slot stays empty. Fabricated specifics about a real client
are a worse failure than copy that reads AI-written.

## The six moves every release fills

1. Hook phrase, lifted from something a person said
2. Scope: a number, a size, a first / largest / tallest
3. Material, method, siting
4. Impact on the place or the user
5. Wider programme or context
6. Third-party proof: award, publication, named collaborator

Five of the six are facts. That is why they are the user's to supply.

## The specificity count

Checkable items per 100 words: proper nouns, numbers, dates, measurements,
currency, named materials, awards, publications, attributed quotations.

- Human benchmark (Hollaway F51 release): **12.7**
- AI benchmark (two flagged samples): **2.9 and 3.1**
- **Target 10+. Below 6 the release is not ready.**

Report this count whenever reviewing copy.

## The AI fingerprint, when reviewing

Coordinate lists with Oxford commas; perfect parallelism in lists; every
sentence resolving cleanly; abstraction in place of checkable detail; a closing
participial benefit clause; even information density; no errors; uniform
register.

Point at the offending text. Never fix it by rewriting.

## Never do this

- Rewrite, paraphrase or "humanise" copy to lower a detector score. It does not
  work and it misrepresents authorship to clients and journalists.
- Manufacture errors, clumsy repetition or faux-rough phrasing. Detectors are
  trained on roughened AI prose.
- Generate a quote, or tidy a real one into fluency.

## What to automate instead

Angle options, the interview question set (§8 of the standard), the fact and
asset chase checklist, gap analysis, ten headline options, pitch email
variants, media list building, follow-up scheduling.

## Handing back

Close with: the completed slots, the empty ones, the interview questions that
fill them, and the current specificity count. Then suggest dictation: talking
through the fact sheet into a voice note and tidying the transcript produces
human sentence rhythm with no effort and beats typing for speed.
