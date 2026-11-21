# nvelope.co — platform audit brief

For Claude in Chrome, run while logged into the nvelope.co WordPress admin.

The output comes back to the OMI build session, which is scoping how to drive
nvelope.co from inside OMI: launching a client's landing page, generating and
attaching branded PDFs, and running the ad optimisation loop against it. The
code in git (`dev/oc-forms`, `docs/nvelope/*`) covers the forms plugin and the
campaign strategy. Everything else lives in the WordPress database and plugin
settings, which is what this audit is for.

---

## The brief to paste

```
You are auditing a live WordPress site I own, nvelope.co, from inside its
admin. It is a lead-generation site: hidden landing pages and advice hub pages
for my clients (architecture and design studios), reached from paid ads. The
homepage deliberately says nothing. It runs JupiterX, Crocoblock/JetEngine and
a custom forms plugin called October Forms.

I am scoping how to drive this site from another system, so I need an accurate
inventory of how it is built, not a design review.

RULES
- Read only. Do not create, edit, publish, delete, activate, deactivate or
  save anything, including "no-op" saves. If a screen has no read-only view,
  describe what you can see and move on.
- Record identifiers verbatim: post type slugs, meta field keys, taxonomy
  names, template IDs, form IDs. These become an API contract, so "a field for
  the client name" is useless and `client_name` is what I need.
- Never copy an API key, token, password or secret into your output. Say that
  one exists and where it is set, nothing more.
- Where you cannot see something or are unsure, say so explicitly. A gap I
  know about is worth more than a guess I cannot tell from a fact.
- Do not comment on styling, colours or visual design. I need structure.

WORK THROUGH THESE IN ORDER. If you run short, finishing the early sections
properly beats skimming all of them.

1. INSTALLED STACK
   Plugins (Plugins > Installed Plugins): name, version, active or not, and
   one line on what each is doing here. Flag anything that looks like it
   handles membership, access control, caching, tracking or redirects.
   Theme and any child theme, with version.

2. CONTENT MODEL  — the most important section
   JetEngine > Post Types: every custom post type, its slug, and how many
   entries it has.
   JetEngine > Meta Boxes: for each one, which post type it attaches to and
   every field, with its key and type. This is the bit I need in full.
   JetEngine > Relations and > Taxonomies: what connects to what.
   Then say in plain terms: what is the unit that represents one client, and
   what hangs off it.

3. A REAL LANDING PAGE, THREE TIMES OVER
   Find three client landing pages that are actually live. For each: its URL,
   its post type, and the values of the fields from section 2.
   Then the question that matters: what differs between the three, and what is
   identical? I am trying to work out what is template and what is per-client
   data. Be specific about which fields vary.

4. THE ADVICE HUB AND ITS PDFs
   How is an advice hub page structured, and how does it relate to a client's
   landing page?
   How are PDFs attached: media library uploads, a repeater field, a separate
   post type? Where do the files live?
   How is access gated? Look for JetEngine Dynamic Visibility, a membership
   plugin, a cookie or URL token, or logic inside October Forms. Describe the
   actual mechanism, and what a visitor has to do to get past it.
   Roughly how many PDFs exist, and do several clients share the same ones or
   does each have its own copy?

5. FORMS
   October Forms: how many forms, their IDs and names, and which pages use
   which form. For one representative form, list its fields and steps.
   Where do submissions go: stored in WordPress, emailed, sent to Brevo, or
   all three? Name the destinations, not the credentials.

6. TRACKING AS ACTUALLY INSTALLED
   Find where Google, Meta, X and Microsoft Clarity tags are injected: theme
   header, a plugin, Google Tag Manager, JupiterX custom code. Name the file
   or screen.
   List the conversion events that actually fire and what triggers each.
   Note anything that is configured but looks broken or orphaned.
   Do not copy pixel IDs or measurement IDs.

7. TEMPLATES
   JetEngine Listings, Elementor or JupiterX templates, and Crocoblock
   template conditions. Which template renders which post type, and under what
   condition. I want to know how a new client page gets its layout.

8. WHAT LOOKS MANUAL
   Based on everything above, list what a person appears to have to do by hand
   to launch one new client, in order, from creating the entry to the page
   being live. Mark anything that looks copy-pasted between clients, and
   anything that looks like it would be easy to get wrong.

DELIVERABLE
A structured document following the sections above. Favour tables and lists of
exact identifiers over prose. End with:
  - the five things you are least sure about
  - anything you found that I probably do not know is there, such as orphaned
    pages, disabled plugins still carrying config, or duplicate fields
```

---

## Why each section is there

| Section | What it unblocks |
|---|---|
| 1 | Knowing which plugin owns which behaviour before we automate around it |
| 2 | The content model is the API contract. Nothing can be pushed into the site without it |
| 3 | Separating template from per-client data is what makes a one-click launch possible |
| 4 | The PDF generator has to know where to put a file and how it gets gated |
| 5 | Confirms what the existing read-only `october_forms` connector actually sees |
| 6 | The ad loop optimises against these events. What is documented and what is installed may differ |
| 7 | How a new page gets a layout without a human opening the editor |
| 8 | The automation targets, and the steps where mistakes currently happen |

## What to do with the output

Paste it back into the OMI session. It feeds three things already scoped:

1. The two-way connector, replacing today's read-only one-directional pull.
2. Branded PDF generation from `brand_assets`, published to the advice hub.
3. The ad optimisation loop, which needs the conversion events in section 6 to
   be real before it can be trusted with a budget.
