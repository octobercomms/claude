# Browser drives

## Why these are in the repo

On 1 November a session wrote eighteen Playwright drives, roughly 200
assertions, and they caught three bugs that the diff looked clean for:

- Results showed two emphasised tiles as soon as `warm` was non-zero
- An untailored SOSTAC crashed on a missing `progress` counter
- `.search-row` collided with the global palette's class of the same name

None of those are visible by reading the change. All three were found by
loading the built app and looking at it.

Every one of those drives lived in a session scratchpad, which is deleted
when the container is reclaimed. So does every drive from every earlier
session. The CI guards survive; the drives did not, which meant each new
agent either rewrote them or skipped the step that caught the most.

They are here now. Add to them rather than starting again.

## Running one

```sh
cd dev/platform/frontend && npx vite build     # the drives use the real bundle
node dev/platform/drives/stub-server.js &      # a fake backend on :4599
node dev/platform/drives/drive-tenders.mjs
```

The stub serves `frontend/dist`, so a drive exercises the shipped build and
not a dev server. Build before you drive, or you are looking at the last
build.

`pw.mjs` finds Playwright and Chromium: the container's copy under
`/opt/node-tools`, then an ordinary `playwright` install. Import from it,
never from an absolute path, or the drive silently fails to start anywhere
but the machine it was written on.

## The per-PR drives

Most drives are named after a screen (`drive-tenders.mjs`, `drive-hook-vault.mjs`)
and stay useful indefinitely. Three are named after a pull request instead,
because they exist to verify one change set end to end:

| file | what it drives | assertions |
|---|---|---|
| `drive-pr1.mjs` | six styles below the upload, Library tools gone, Video/Edit explainers, the cross-site Funnel health read | 18 |
| `drive-pr2.mjs` | the nav session: Make, Email as a section, Improve inside Learn, Models under Costs, the tools kebab in the page header | 27 |
| `drive-pr3.mjs` | every maintenance job on one tab, the pointers left behind, Add publication and its duplicate check | 25 |
| `drive-pr4.mjs` | the multi-clip drop target (one file to the editor, several to the library), a named rejection, a filed design's link back to its set | 18 |
| `drive-pr5.mjs` | the three browser facts the audio gain graph rests on, measured rather than assumed | 9 |

Keep running them. Each one is a regression check on a change that reached
production, and PR 2 re-ran PR 1's before pushing. They are cheap: all three
take under a minute together.

## What a drive is for

A guard asserts about source text. A drive asserts about a rendered page.
They catch different things and neither replaces the other.

Write a drive when the answer depends on layout, on what is actually on
screen, or on a sequence of clicks:

- is this button in the header, or further down? (compare bounding boxes)
- does the empty state say the right one of its four sentences?
- does ticking this box change the request the page sends?
- does the page reload itself? (`page.on('load')` and count)

Two traps that have cost this project time:

- **`indexOf` returns -1, and -1 is less than everything.** An ordering
  assertion (`a.indexOf(x) < a.indexOf(y)`) passes when `x` is missing
  entirely. Check both are present first. This showed up three times in one
  day, in three different guards.
- **A locator or an indexOf on an element name matches a longer name too.**
  `makeAReel.indexOf('<ClipDrop')` still finds `<ClipDropX`, so a rename slips
  straight past it. Pin the attribute: `<ClipDrop clientId=`.
- **`text-transform: uppercase` has caught three browser drives.** The DOM
  holds "Releases" and the screen shows "RELEASES". Compare case-insensitively.
- **A probe that passes under clean conditions proves nothing** about the
  conditions the bug needs. The login-flicker probe passed with storage
  cleared, because a cleared session is exactly where that loop cannot
  happen. Reproduce the state, then test.

## The stub

`stub-server.js` answers the shapes the real API answers. Some fixtures look
odd on purpose, because they reproduce a case that was once live:

- `STUB_META_SPEND=0` — Falcon's connected Meta account that spent nothing,
  which printed a "Combined" strip identical to the Google one
- `STUB_SUBS=1` — the subreddit list already populated
- `STUB_BACKFILL=all|none|some` — the Launch step's three outcomes

It imports the real `adsCurrency` resolver rather than a copy, so a drive
checks the shipped rule.

For anything the stub does not serve, intercept in the drive instead of
teaching the stub a one-off:

```js
await p.route('**/api/tender/notices', r => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
}));
```

That is how the four tender empty-state branches are driven, and it keeps a
one-case fixture out of a file every other drive depends on.
