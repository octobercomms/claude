# Section 1 / 6 — Popups & forms (Advice Hub)

## Free asset popup (e.g. "How architects charge for home projects")
Trigger: click "Download PDF" / "Watch video" on a non-gated card.
Structure: a first modal shows title, standfirst, and a longer "body" paragraph — but that body
text reads like an AI-generation BRIEF, not finished copy, e.g. for this asset:

> "Create a clear, homeowner-friendly guide explaining how architects charge for residential
> projects. Explain percentage fees, fixed fees, hourly fees, and staged fees. Focus on what
> homeowners are actually paying for at each stage and why fees vary. Include simple diagrams
> showing fee structures across a typical project timeline."

That first modal's own "Download PDF" button is itself an Elementor/Raven popup trigger:
`#elementor-action:action=raven_popup_848:open&settings={"id":"848","toggle":false}`
→ **Raven popup ID 848** — matches the brief's Section 3 note about popup template IDs. This is
almost certainly the actual PDF-serving or secondary popup. Need to export this template in
Section 3 (Templates → Saved Templates / Theme Builder, filter by ID 848).

Important implication for the content model: the JetEngine "body" meta field is being used to
store a **content-generation prompt** for each asset, not the final guide copy — the actual PDF
content is generated/stored separately. Flag this to Daniel: the plugin's dummy seed content
should probably use finished copy, but the live model appears to store prompts in that field.

## Gated asset popup (e.g. "What's included in an architect's fee")
Trigger: click "Download PDF" on a salmon/pink card (has the lock icon + "Email required").
Opens directly to the "Unlock the full library" modal (not the asset-detail modal first):

- Heading: "Unlock the full library"
- Copy: "This is part of the locked resource library. Enter your email to unlock all guides and
  videos for this session. After you submit, this page will refresh and you can open any locked
  resource without entering your details again. We'll also send you the link, so you can find it
  again later."
- Field: email input, required, placeholder "your@email.com" / "EMAIL"
- Checkbox: "I agree to receive your newsletters and accept the data privacy statement." (appears
  unchecked by default, not pre-ticked)
- Small print: "You may unsubscribe at any time using the link in our newsletter."
- Brevo badge/disclosure: "We use Brevo as our marketing platform. By submitting this form you
  agree that the personal data you provided will be transferred to Brevo for processing in
  accordance with Brevo's Privacy Policy." (links to Brevo's own privacy policy)
- Button: "UNLOCK"

**This form is a Brevo-hosted embed, not a native WP form** — it's an `<iframe>` pointed at:
`https://83f71eb9.sibforms.com/serve/MUIFAIa6AegodYdkKNvdCQJNWvkNpY7el5aeFeueNcRf0fjH3Ay9SFM2-Ay7ljF_xhZhCsCqIpjvMxSOviMNGdJpZm-u7F3lmisg69bBSXBEeK_xxl9yLRGhAk-tISjPfcqqjmAHAcaQ92xyk8cbI1Ex6Q1cxI5v-zyEuKYuMtiuANqHHdyiVhkZbP0IeUI6IXs5cmNB5a3AdCy-8g==`

That's `studio_brevo_form_uid` — the `83f71eb9` subdomain is the Brevo account id, and the long
token after `/serve/` is the specific form's public embed UID (this is a public embed identifier,
not the API key — safe to record, unlike the key at the top of the brief).

Unlock mechanism: per the copy, submitting sets some session-level unlock state and the URL
gains a `?u=1` param (confirmed working — Daniel pointed out you can just append `?u=1` directly
to skip the live form submission, see below).

## Unlocked state (`?u=1`)
Navigating to `/learn/nvelope/?u=1` and reopening a previously-gated card: [to confirm in next
pass — see screenshot in rendered/advice-hub-desktop/]

## Cookie/consent banner
Plugin confirmed via DOM class names: **Complianz** (`cmplz-cookiebanner`, `cmplz-eu`,
`cmplz-optin`, `cmplz-functional` categories seen on `<body>`). Banner id
`cmplz-cookiebanner-1-optin`, style `banner-1 banner-a`, position `cmplz-bottom`. Default state
on a fresh visit (no prior consent) = shown; after Accept/Deny it gets class `cmplz-dismissed`.

## Remind-me bar
Confirmed element: `#remind-bar`, classes include `raven-sticky raven-sticky--active
raven-sticky--effects` (a Raven/Elementor sticky section, not a separate plugin widget).
`position: fixed; top: 32px` (i.e. sits directly under the WP admin bar when logged in, at the
very top for logged-out visitors) — **this IS the bar visible at the top of every single
screenshot in this harvest**: "Send this page to me: [email input] [→]". It's always-on, not
triggered by scroll/time/exit-intent — no separate capture needed, it's in every screenshot
already taken. Behaviour on submit (does it just email the current URL via Brevo transactional
template?) still to confirm in Section 4/6 form review — likely wired to the same Brevo
list/template ids as the email gate.
