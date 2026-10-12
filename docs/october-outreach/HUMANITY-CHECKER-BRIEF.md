# Humanity Checker — Build Brief

**For:** the agent picking up the next October Outreach PR phase
**Plugin:** October Outreach (`dev/october-outreach`, v3.19.0)
**Docs home:** `docs/october-outreach/`
**Companion:** `docs/editorial/human-writing-standard.md` (the editorial standard this enforces)
**Author:** scoping pass, 2026-10-12

---

## 1. Why this exists

October's press releases are being written by Claude via
`OO_Claude::write_press_release_draft()`. Testing on 2026-10-12 against
Pangram 4.0 produced this:

| Sample | Origin | Words | Verdict |
|---|---|---|---|
| Agency prose about detectors | Claude | 64 | 100% AI |
| Hollaway Studio F51 release extract | Human | 118 | 100% Human |
| Indiewalls boilerplate, lightly hand-edited | Claude + edits | 68 | 100% AI |

The detector was correct three times out of three. The third result is the
important one: hand-editing a Claude draft did not move it. The signal is
structural, so sentence-level edits leave it intact.

This matters commercially, not just cosmetically. Newsroom screening of
AI-generated pitches is now routine, and a release suspected of being machine
generated reads as unverified, which makes it a liability to a journalist
rather than a shortcut. Low specificity is simultaneously the thing detectors
flag and the thing that stops a release being picked up.

**So the product change is not "detect and fix prose". It is "stop generating
prose, and tell the writer which facts are missing."**

---

## 2. What to build, and what NOT to build

### Do not build a classifier

Do not train or hand-roll an AI-text classifier. Pangram and its peers are
trained on enormous corpora; a bespoke one will be worse and will rot. Treat
third-party verdicts as an optional, cached, non-blocking input.

### Build two things

**A. `OO_Humanity` — a deterministic structural analyser (PHP, no API).**
Computes the markers in §4 against a release body. Fast, free, offline,
runs on every save. This is the half that produces actionable output.

**B. A brief builder that replaces prose generation.**
`OO_Claude::build_press_release_brief()` returns a **fact sheet with empty
slots**, not a release. The human fills the slots and writes the prose.

The analyser's primary output is **a list of empty slots and missing facts**,
ordered by impact. A numeric score is secondary. Do not lead the UI with a
score: the entire lesson here is that "you scored 62" is not actionable,
whereas "no named quote, no measurement, no third-party validation" is.

---

## 3. Integration points in the existing plugin

| Area | File | Change |
|---|---|---|
| Claude wrapper | `includes/class-oo-claude.php` | Add `build_press_release_brief()`. Keep `write_press_release_draft()` behind a setting, default off. |
| New class | `includes/class-oo-humanity.php` | The analyser. No external calls in the core path. |
| Schema | `includes/class-oo-database.php` | Extend `oo_press_releases`: `brief_json LONGTEXT`, `humanity_json LONGTEXT`, `humanity_checked_at DATETIME`. |
| UI | `admin/views/press.php` | Brief panel (slot form) + Humanity panel (gap list) beside the editor. |
| AJAX | `admin/class-oo-ajax.php` | `oo_analyse_humanity`, `oo_build_brief`. |
| REST | `includes/class-oo-rest.php` | Expose analysis on `oo/v1` so the OMI front end and Gmail add-on can read it. |
| Settings | `admin/views/settings.php` | Optional third-party detector API key; toggle for legacy draft generation. |

Phase 9 already ships the wizard (brief → draft → `draft/in_review/approved/sent`
→ client approval token). This work replaces the middle step and adds a gate
before `in_review`.

---

## 4. The metrics

All computed on the plain-text body (strip HTML, exclude the boilerplate
"About" paragraph and the press-contact block from the word count).

### 4.1 Specificity density — the primary metric

```
specificity_density = (checkable_tokens / word_count) * 100
```

A **checkable token** is any one of:

- A proper noun: capitalised word not in sentence-initial position, minus a
  stoplist (I, The, A, An, This, That, It, In, On, At, Working, Describing…).
- Any numeral, including dates, percentages, currency and measurements.
- A unit match: `mm|cm|m|km|sq ft|sqft|ft|m2|m²|£|\$|€|%`.
- A direct quotation with an adjacent attribution.

**Observed values (n=3, 2026-10-12):**

| Sample | Checkable | Words | Per 100 |
|---|---|---|---|
| Hollaway F51 (human) | ~15 | 118 | **12.7** |
| Indiewalls (AI) | ~2 | 68 | **2.9** |
| Agency prose (AI) | ~2 | 64 | **3.1** |

Starting threshold: **flag below 6, target 10 or above.** See §6 on
calibration before trusting these numbers.

### 4.2 Supporting markers

| Key | Definition | Starting flag |
|---|---|---|
| `coordinate_list_density` | `X, Y(, )? and Z` patterns per 100 words | ≥ 2 |
| `parallel_gerund_lists` | lists of ≥3 items all ending `-ing` | ≥ 1 |
| `sentence_length_cv` | stdev ÷ mean of sentence word counts | < 0.35 |
| `abstraction_markers` | wordlist hits per 100 words | ≥ 3 |
| `named_quote_count` | quotations with `said`/`according to` + proper noun | 0 |
| `closing_flourish` | final sentence is a participial benefit clause (`, giving…`, `, allowing…`, `, ensuring…`) or contains no proper noun or numeral | true |
| `proper_noun_variety` | distinct proper nouns in the body | < 4 |

Abstraction wordlist (seed, extend from October's own rejected drafts):
`approach, commitment, solutions, experience, journey, seamless, curated,
bespoke, innovative, passionate, dedicated, holistic, tailored, elevate,
crafted, weaves, vision, ethos, landscape (figurative), leverage, robust`.

Every flagged marker must return **the offending substring and its character
offset** so the editor highlights it in place. A marker that cannot point at
text is not worth shipping.

### 4.3 One semantic check, via Claude

Deterministic metrics cannot tell whether move 4 of the skeleton is filled.
A single Claude call does that well:

> Given this release and this six-move skeleton, list which moves are unfilled,
> and list every claim that is not supported by a named source, a number, or a
> date. Return JSON only.

Keep it separate from the statistical metrics, cache the result against a hash
of the body, and never block saving on it.

---

## 5. The brief builder

`build_press_release_brief( $project, $client, $known_facts, $angle )` returns
JSON matching the fact-sheet structure in
`docs/editorial/human-writing-standard.md` §7. It must:

- Return **slots, never prose.** No sentences, no draft paragraphs, no
  suggested phrasing. If the model writes a sentence, the implementation has
  failed.
- Mark each slot `filled` or `empty` against `$known_facts`.
- Generate the client interview question set needed to fill the empty slots.
- Never invent a fact, a quote, a name, a measurement or an award. Where
  something is unknown the slot stays empty. This is a hard constraint:
  fabricated specifics about a real client are a considerably worse failure
  than a release that reads AI-written.

The system prompt should state plainly that the model is building a reporting
checklist for a human writer, not drafting copy.

---

## 6. Calibration — do this before trusting any threshold

The numbers in §4 come from three samples. Before the gate blocks anything:

1. Assemble a corpus: 20 human-written releases that earned coverage (client
   archives, the Hollaway F51 release, published releases from practices
   October tracks) and 20 Claude-written ones.
2. Run `OO_Humanity` across both sets, dump the raw metric values.
3. Set each threshold at the point that separates the two populations, not at
   the guesses above.
4. Store the corpus results in `docs/october-outreach/` so the next agent can
   see what the thresholds were derived from.

Until calibration is done, ship the analyser in **advisory mode**: show the
gaps, do not block the `draft → in_review` transition.

---

## 7. Optional third-party verdict

Pangram offers an API on paid tiers (October holds an account). If wired in:

- Call on explicit user action only, never on save. Credits are metered.
- Cache against a SHA-256 of the body; never re-spend a credit on unchanged text.
- Store the verdict and the model version. Verdicts shift as detectors update.
- Treat it as one input beside the gap list, never as the headline.
- Degrade silently: no key, or an API error, must not break the editor.

---

## 8. Acceptance criteria

- [ ] `OO_Humanity::analyse( $html )` returns metrics, flags, and highlighted
      offsets with no network call.
- [ ] Running it on the Hollaway F51 extract returns specificity ≥ 10 and no
      more than one flag.
- [ ] Running it on the Indiewalls extract returns specificity < 4 and flags
      coordinate lists, abstraction and missing named quote.
- [ ] `build_press_release_brief()` returns zero sentences of body copy across
      20 varied test inputs.
- [ ] The press editor shows empty slots and flagged spans in place.
- [ ] Advisory mode by default; the blocking gate is behind a setting.
- [ ] No fabricated facts in any brief output. Spot-check 20 briefs by hand.
- [ ] Legacy `write_press_release_draft()` still works for existing releases.

---

## 9. Explicitly out of scope

- Any feature that rewrites, paraphrases or "humanises" existing copy to lower
  a detector score. It does not work (see the sample 3 result above) and it
  misrepresents authorship to clients and journalists. The analyser reports
  gaps; the human fills them.
- Removing or altering provenance metadata on any asset.
- Training a bespoke classifier.
