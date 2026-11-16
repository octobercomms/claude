# Social Review

Client sign-off previews for Instagram carousels and reels. Upload the files,
send the link, the client sees the post as it will appear in the feed. Nothing
reaches Sprout Social until it has been signed off by email.

Code lives in `dev/social-review`. No build step, no framework.

---

## What it does

- **Upload only.** Drop MP4s and JPGs. No captions to type, no metadata forms.
  Captions stay in the content schedule where they already live.
- **Real crop.** The mockup applies Instagram's own rules, so the client judges
  what they will actually get, not a square approximation.
- **Carousels swipe.** Arrows, dots, keyboard, and touch, with the slide counter.
- **Reels play.** Muted autoplay on scroll, tap the corner for sound, seekable.
- **Safe zones.** Shades where Instagram's buttons and caption sit over a reel.
- **Grid view.** The profile grid, so a set of posts can be judged together.
- **Crop warnings, team side only.** The admin flags slides that will be cropped
  and videos that are the wrong shape. Clients never see these.

Approvals are deliberately absent. The client emails as they always have.

---

## How the team uses it

1. Go to `/admin`, enter the shared password.
2. **Create review**, named for the client and month, e.g. "Hillcroft Gardens November".
3. Drop files into **Add a post**:
   - Each **video** becomes its own reel.
   - **Images dropped together** become one carousel, ordered by filename.
     Name them `01-…`, `02-…` and the order looks after itself.
   - Drop again for the next post.
4. Set the Instagram handle so the mockup carries the client's name, and add a
   profile picture if you want the header to look right.
5. Reorder or remove posts, check the crop warnings, then **Copy link**.
6. Send the link. The client needs no login and no account.

Review links carry a random suffix (`/r/hillcroft-gardens-november-k3f9qa`), so
they cannot be found by guessing a client name.

---

## Deploying it

Needs a Cloudflare account. Everything below sits inside the free tier.

```bash
cd dev/social-review
npm install
```

Create the bucket that holds media and manifests:

```bash
npx wrangler r2 bucket create october-social-review
```

Create and deploy the Pages project:

```bash
npx wrangler pages project create october-social-review --production-branch main
npx wrangler pages deploy
```

Set the two secrets. The first is the password the team types, the second signs
the session cookie and is never typed by anyone:

```bash
npx wrangler pages secret put TEAM_PASSWORD --project-name october-social-review
```

```bash
openssl rand -base64 32
```

```bash
npx wrangler pages secret put AUTH_SECRET --project-name october-social-review
```

Confirm the R2 binding. `wrangler.toml` declares `MEDIA`, and a Git-connected
project should pick it up. If `/admin` reports an error after signing in, add it
by hand: **Workers & Pages → october-social-review → Settings → Bindings → R2
bucket**, variable name `MEDIA`, bucket `october-social-review`.

Add a custom domain under **Custom domains**, for example
`review.octobercomms.com`, so links sent to clients carry October's domain
rather than `pages.dev`.

### Deploying from Git instead

**Workers & Pages → Create → Pages → Connect to Git**, pick the repo, then set
**Root directory** to `dev/social-review`, build command empty, output directory
`public`. Set the two secrets as above in the dashboard.

---

## Running it locally

```bash
cd dev/social-review
printf 'TEAM_PASSWORD=local-pw\nAUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > .dev.vars
npx wrangler pages dev
```

Opens on `http://127.0.0.1:8788`. R2 is simulated on disk under `.wrangler`, so
uploads survive a restart. `.dev.vars` is gitignored.

---

## What it costs

| Resource | Free allowance | What this app uses |
|---|---|---|
| Pages static requests | Unlimited | The HTML, CSS and JS |
| Pages Functions | 100,000 requests/day | One per media file, plus the API calls |
| R2 storage | 10 GB | Roughly 500 reels at 20 MB |
| R2 egress | Free, no cap | Every video the client watches |

R2 charging nothing for egress is why video sits here rather than on a host that
bills bandwidth. Clear out old reviews once a client has signed off; **Delete
review** removes the manifest and every file under it.

---

## Limits worth knowing

- **95 MB per file.** Cloudflare caps a request body at 100 MB on the free plan.
  A 60-second reel at sensible bitrate lands near 15 MB, so this rarely bites.
- **Use MP4, H.264.** MOV uploads are accepted and flagged, but Safari and
  Chrome disagree about which ones play. Export MP4 and the question goes away.
- **Safe zones are approximate.** They follow Instagram's published guidance,
  14% off the top and 20% off the bottom. Instagram moves its own UI from time
  to time, so treat them as a margin, not a measurement.
- **One shared password.** No per-user accounts, no audit of who uploaded what.
  That is the trade for keeping this free and small.
- **No approval state.** By design. Sign-off is the client's email.

---

## Notes for whoever touches this next

Four things already cost time. They are solved in the code; leave them solved.

1. **`_redirects` cannot serve `/r/<slug>`.** A line like `/r/* /review.html 200`
   comes back as a 308 to `/review` and drops the slug, so every share link dies
   silently. `functions/r/[slug].js` serves the page instead.
2. **Do not add `functions/admin.js`.** Pages serves HTML at its extensionless
   URL, so `/admin` already resolves to `admin.html`. A function at `/admin`
   fetches `/admin.html`, gets a 308 back to `/admin`, and loops until it 500s.
3. **Restart wrangler after deleting a function.** The build cache keeps the old
   route and you will debug a file that no longer exists.
4. **Range requests are not optional.** `functions/m/[[path]].js` returns 206
   responses because Safari and iOS refuse to play video without them, and
   nobody can scrub a reel without them either.

Crop logic lives in `cropWarnings()` in `public/assets/ig.js`. Compare each
slide's own ratio against the container shape; clamping a slide's ratio before
comparing makes a 9:16 slide look identical to a 4:5 one and the warning never
fires.

R2 keys are namespaced `media/<slug>/…`, and the media route always prefixes
`media/`, so manifests and the review index cannot be reached through `/m/`.
Keep it that way.
