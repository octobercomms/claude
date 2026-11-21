# Archie — Words & Voice

Studio-editable layer over Archie's wording. Added in plugin v0.7.42. Admin page:
**Archie → Words & Voice**. Code: `includes/class-yaa-words.php` (`YAA_Words`).

## The idea

Archie's replies come from two places, and this feature hands both to the studio:

- **Scripted strings** — exact text used as-is (greetings, the tappable answer
  buttons, a few fixed acknowledgements, the finishing line, the browser-side
  quote-ready message + agree button). These are editable fields.
- **AI-phrased replies** — everything else, generated live. Not individually
  editable, but steered by a free-text **house voice** box appended to every
  prompt (tone + standing rules).

The deterministic flow (chips + scripted prompts) handles the on-script path; the
AI drops in for off-script moments.

## How it's wired

- One option, `yaa_words`. `YAA_Words::all()` merges saved overrides over
  `defaults()`. **A blank field always falls back to the default** (the default
  *is* the current live wording, so nothing changes until something is edited).
- Accessors: `greeting($variant)`, `line($key, $tokens=[])`, `chip($key)`,
  `chip_list($key)`, `voice()`, `get($key)`.
- **Tokens**: some lines carry `{tokens}` substituted at use — `{advice}` (the
  advice button's label) in `line_after_postcode`; `{terms}` / `{privacy}`
  (links) in the quote-ready message. `line()` always injects `{advice}`.

## Tappable buttons are a single source of truth

The chip labels (`chip_*`) are read in **both** places that must agree:
`YAA_Archie::suggested_options()` (renders the buttons) and
`YAA_Archie::record_tap_answer()` (matches a tapped label back to the state
field). Both call `YAA_Words::chip()/chip_list()`, so **editing a label cannot
desync the button from the logic** — which is why label editing is safe. The
`projectType` list treats its **last line** as the "something else" catch-all
(tapped, it isn't stored as the project type).

The *service* buttons are not here — they come from **Pricing & Services**
(service labels). The "no survey" and "unsure about structural" reassurance lines
are also on the Pricing page (`answers`), left there to keep pricing-related copy
together.

## What's editable vs AI-phrased

Editable scripted fields: both greetings; postcode ask; after-postcode
service-choice prompt; service-picked prompt; email-first re-ask; finishing
nudge; quote-ready message + agree button; all the answer buttons; listed /
conservation guidance.

AI-phrased (steer via house voice): the add-ons, survey, structural, timeframe,
name, email and phone *questions* are asked by the model (they adapt — e.g. the
site visit is only offered inside the M25, add-ons are woven in naturally). Their
**buttons** are scripted/editable; their **wording** is the model's. Pinning that
wording to fixed strings was considered and deliberately not done — it would lose
the adaptivity that makes Archie beat a static form.

## Front end

`class-yaa-shortcode.php` localises `yaaData.words = { submitReady, agreeBtn }`;
`assets/js/archie.js` uses them in `showSubmitReady()` (tokens → links), falling
back to built-in defaults if absent. Admin input is `sanitize_textarea_field`'d
on save (tags stripped), so the browser injection carries no HTML risk.
