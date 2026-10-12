# The checker bench

Temporary. Built to answer one question, and deleted when it has.

## The question

Does October's deterministic humanity checker predict anything a trained
detector agrees with, on October's own writing?

The evidence that prompted it: one 678-word Indiewalls release, run through four
detectors on 12 October 2026.

| Tool | Verdict |
|------|---------|
| Pangram | 82% AI |
| GPTZero | human-written and AI-polished (mixed 99%) |
| ZeroGPT | 29.1% AI, "most likely human" |
| QuillBot | 0% AI, 100% human |
| OMI's own checker | 94 out of 100 |

Four trained classifiers spanning 0% to 82% on one text. Our own panel sat with
the two most generous. That spread is the reason the bench exists: nobody
currently knows whether OMI's number means anything, including the person who
wrote it.

## What it is

`/lab/checker`, under Settings in the sidebar, admin only.

- **Specimens**, loaded by pasting. Each carries a label saying how the text was
  really produced: written cold, AI draft rewritten, AI draft edited,
  essentially AI, not sure. Four levels rather than two, because a binary label
  throws away the middle, and the middle is where October's work actually sits.
- **October's score**, computed on load and recomputable in bulk. Free.
- **The detector's score**, one specimen per button press. Billed.
- **A scatter plot** of one against the other, with the Pearson correlation.
- **CSV export** of the pairs plus the component features (density, bare
  percentage, tell count, named quotes).

## How a calibration round runs

1. Load twenty to thirty releases, roughly balanced between written cold and
   AI-produced. An unbalanced corpus makes any accuracy figure meaningless:
   twenty cold and three AI means "always say human" scores 87%.
2. Run the detector over each one. About $10 at $0.05 per 100 words.
3. Export the CSV and commit it to the repo, which is how the data reaches a
   development session. Production Postgres is not reachable from one, and
   making it reachable for a twice-yearly task is a bad trade.
4. The weights and thresholds in `dev/platform/shared/humanity.mjs` change in a
   commit, visible and reviewable. Nothing self-tunes.
5. Press **Re-score all** and read the correlation again.

## What it will not do

It does not train anything. Thirty specimens against ten hand-set weights
overfits so badly the result would be noise wearing a confidence interval. The
bench supports measurement and threshold-setting. A learned classifier would
need several hundred labelled examples and would still be a poor imitation of
what Pangram already does.

Nothing self-tunes, by design. A dial that changed its answer on the same text
without anyone touching it would lose the one property that makes it useful day
to day.

## The standing objection

Tuning OMI's checker to agree with Pangram makes it better at predicting Pangram
and no better at getting coverage. The component that would lose weight is
specificity, because it moves slowest, and specificity is the only part a
journalist cares about.

The bench is also the test of whether that objection matters. If cutting empty
sentences and adding checkable facts turns out to move the detector down, then
the editorial standard and the detector want the same thing and there is no
trade-off to manage. That is the useful finding, and it is cheap to get.

## Cost control

Pangram runs under the `detector_check` task budget, $25 a month, same machinery
as the Claude task caps. It is never automatic, one call per press, and a
re-check of unchanged text is served from the stored result rather than
re-billed. Spend is logged to `api_cost_events` under the `pangram_detect`
feature, so the monthly figure in Settings stays the whole truth.

## Configuration

**Settings → Keys → Outreach finders → AI detection (Pangram)**, stored
encrypted in `platform_settings` like every other API key. `PANGRAM_API_KEY` in
the server environment also works, since `getSetting` falls back to the
environment for the same name. Without a key the bench works and the detector
column stays empty.

The setting name is `PANGRAM_API_KEY` in capitals, exactly as the Settings page
writes it. An earlier version of the service asked `getSetting` for
`pangram_api_key` in lower case, which meant a key typed into Settings was
stored, encrypted, and then never read by anything.

`PANGRAM_API_URL` overrides the endpoint. The response parser tries several
documented field names and stores the raw body whole, because the development
environment cannot reach pangram.com and the field names have not been seen
against a live response. A wrong guess costs a display value, never the data.

## The ongoing use, which is not the bench

The same detector runs from the Releases editor, as a second reading under
October's own dial: one button, the price quoted beside it, the answer stored on
the release with the OMI score at that moment. That part stays after the bench
goes, and migration 196 (`pr_press_releases.pangram_*`) belongs to it rather
than to the bench.

The two readings are deliberately presented differently. October's is a dial
with bands and inline highlighting. The detector's is one plain number with no
ramp, because dressing it to match would imply an agreement that one real
release (94 here, 82% there) does not support.

## Removal

When the thresholds are set, four things go together: the sidebar link in
`Layout.jsx`, the route in `App.jsx`, `CheckerBenchPage.jsx`, `routes/lab.js`,
and a migration dropping `checker_samples`. Nothing in the Releases editor
changes, which is why the bench was built outside it.
