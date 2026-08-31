# Section 4 — JetEngine data model (the actual structure — corrects several brief assumptions)

## Major correction: no relations, no taxonomies, no separate asset CPT
Checked directly in JetEngine admin:
- **Relations list is EMPTY** — "relation ID 6" from the brief does not exist. (Possibly confused
  with `brevo_list_id = 6` from Section 2 — same digit, different thing.)
- **Taxonomies list is EMPTY** — there is no Fees/How it works/Process/Decisions taxonomy.
- **Only 2 Custom Post Types exist**: `Studio` (slug `studio`) and `Advice Hub` (slug `learn`).
  No separate asset/guide CPT.

## The real structure: one repeater field per category, on the Advice Hub post itself
Each "Advice Hub" post (see below — there are 7, one per client) has a JetEngine meta box with 4
tabs: **Hub Content**, **Assets Repeater**, **Fonts & Colors**, **Scripts** — mirroring the
Studio post's pattern (this confirms Studio and Advice Hub are sibling CPTs with the same
JetEngine-meta-box design language, not related via a formal JetEngine "Relation").

The **Assets Repeater** tab holds FOUR repeater fields, one per category, named:
- `hub_assets_fees`
- `hub_assets_how` (→ "How it works")
- presumably `hub_assets_process` and `hub_assets_decisions` (not yet opened, but the naming
  pattern is unambiguous from the two confirmed)

Each repeater has 5 rows (matching the 5-per-category count from Section 5's content table).

### Fields inside one repeater row (confirmed on "How architects charge for home projects", the
first row of `hub_assets_fees`) — field name prefix matches the parent repeater, e.g.
`hub_assets_fees_*`:
| Field | Name | Type | Example value |
|---|---|---|---|
| Gated state | `hub_assets_fees_gated` | radio: **FREE / Gated / Image** (3 options — "Image" is a third state not seen anywhere on the front-end; worth asking Daniel what it's for, may be unused/legacy) | `FREE` |
| Title | `hub_assets_fees_title` | text | "How architects charge for home projects" |
| Standfirst | `hub_assets_fees_standfirst` | text | "Common fee structures and what architectural fees usually cover at each stage." |
| Body | `hub_assets_fees_body` | WYSIWYG (visual/code editor) | the AI-generation-brief-style text seen in the popup (see section1-popups-forms.md) |
| Type | `hub_assets_fees_type` | radio: PDF / Video | `PDF` |
| Time label | `hub_assets_fees_time` | text | "6 min read" |
| File/video URL | `hub_assets_fees_file` | text/URL | `https://nvelope.co/wp-content/uploads/2026/02/1-Turn-Leads-Into-Qualified-Projects.pdf` |
| Image | `hub_assets_fees_image` | media | (empty on this row) |
| UID | `asset_uid` (NOT prefixed per-category — shared field name across all 4 repeaters) | text | `fees-001` |

**Interesting detail**: the actual PDF filename (`1-Turn-Leads-Into-Qualified-Projects.pdf`)
doesn't match the guide title at all ("How architects charge for home projects") — strongly
suggests the dummy/demo PDFs are reused/placeholder files rather than individually authored per
guide. Don't assume file naming reflects content when seeding "October Serious Buyer"'s own demo
data — generate matching placeholder filenames instead.

`asset_uid` pattern = `{category-slug}-{3-digit sequence}`, e.g. `fees-001`. Confirms a stable
per-asset identifier exists independent of the WP repeater row index (useful for deep-linking /
analytics).

## The "Advice Hub" CPT has MULTIPLE posts — one per client (this is a template, not a singleton)
7 published "Advice Hub" posts exist, matching real October Comms clients from Daniel's own
client roster:
1. LOLO
2. Andrew Paine Architecture
3. Manolo Design Studio
4. Tiam Architects
5. S G / D
6. **nvelope Architects** (our reference site)
7. Forgeworks

This confirms the "Studio" + "Advice Hub" pair is Daniel's existing multi-tenant funnel
template — nvelope is just the one being used as the live reference/demo. **This is extremely
relevant**: "October Serious Buyer" as a plugin should probably follow the same one-post-per-client
pattern (each client gets their own Studio + Advice Hub post, both carrying JetEngine repeater/
meta-box data) rather than inventing a new architecture — the reference implementation to copy is
already proven across 7 real clients.

## Studio Quiz URL field
Noticed on the Advice Hub "Hub Content" tab: `Studio Quiz URL` (name: `studio_quiz_url`), value
`nvelope` on this post — this is what links an Advice Hub post back to its matching Studio (by
slug, as a plain text field, not a JetEngine relation). Confirms cross-linking between the two
CPTs is done via a slug-matching text field, not a formal relation.

## Listing Grid queries (brief's ask)
Not applicable in the way the brief assumed — since there's no relation/taxonomy-driven Listing
Grid widget query, the Advice Hub page template must render each of the 4 repeaters directly
(likely via JetEngine "Dynamic Repeater" or "Listing Grid injections" module — this module was
seen ENABLED in JetEngine → Dashboard → Modules screenshot). No separate "query per section" to
document — it's "render repeater field X in category-labeled block X", one-to-one.

## Still to check
- [ ] Confirm `hub_assets_process` / `hub_assets_decisions` field name pattern (very likely, not
      yet opened directly)
- [ ] Studio post's own meta box likely has an equivalent structure worth a quick diff (About/How
      We Work/Projects repeaters — field names already listed in section2-design-tokens.md)
- [ ] JetEngine "Listing Grid injections" module (confirmed ON) — check its config for how the
      repeater is actually rendered into the front-end grid, if Daniel wants that level of detail
