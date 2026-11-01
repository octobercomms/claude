# Review archive — 1 November 2026

The page-by-page review audit as it stood before the list was cleared.

On 1 November Daniel had worked through all 110 items and marked 96 done, then
asked for the list cleaned up. The live artefact now carries only the 14 that
are still open. This directory is the full record of the other 96, kept because
it holds decisions and their reasoning, including several he reversed once the
mechanics were explained.

| file | what it is |
|---|---|
| `review-audit-2026-11-01-full.html` | the page with all 110 items, as published (version 9) |
| `marks-2026-11-01.json` | every mark: his tick, his comment, and the full thread per item |

Two things worth knowing if this is ever restored or mined:

- **Keys are positional in the old page.** An item's id is `slug(page)-index`,
  the index being its place in the array. That is why clearing the list had to
  pin each surviving item's key explicitly: deleting 96 items renumbers the
  rest, and every comment is stored against the key it was written under.
- **The marks are the conversation, not just the status.** 22 items carry a
  back-and-forth. Several record a decision being changed — the Shared
  autopilot and Earned Measure were both first marked "delete" and both
  reversed once the explanation existed.
