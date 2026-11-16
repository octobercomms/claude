# Social Review

Client sign-off previews for Instagram carousels and reels. Upload the files,
send the link, the client sees the post as it will appear in the feed. Nothing
reaches Sprout Social until it has been signed off by email.

Deliberately unbranded, so one deployment fronts every client. Code lives in
`dev/social-review`. No build step, no framework, no database.

---

## What it does

- **Upload only.** Drop MP4s and JPGs. No captions to type, no metadata forms.
  Captions stay in the content schedule where they already live.
- **Real crop.** The mockup applies Instagram's own rules, so the client judges
  what they will actually get, not a square approximation.
- **Carousels swipe.** Arrows, dots, keyboard and touch, with the slide counter.
- **Reels play.** Muted autoplay on scroll, speaker button for sound, seekable.
- **Safe zones.** Shades where Instagram's buttons and caption sit over a reel.
- **Grid view.** The profile grid, so a set of posts can be judged together.
- **A link per post.** Each post has its own permanent URL for pasting beside
  its caption in the content schedule.
- **Crop warnings, team side only.** The admin flags slides that will be cropped
  and videos that are the wrong shape. Clients never see these.

Approvals are deliberately absent. The client emails as they always have.

---

## How the team uses it

1. Go to `/admin`, enter the shared password.
2. **Create review**, named for the client and month, e.g. "Caro November".
3. Drop files into **Add a post**:
   - Each **video** becomes its own reel.
   - **Images dropped together** become one carousel, ordered by filename.
     Name them `01-…`, `02-…` and the order looks after itself.
   - Drop again for the next post.
4. Set the Instagram handle so the mockup carries the client's name, and add a
   profile picture if you want the header to look right.
5. Reorder or remove posts and read the crop warnings.
6. Send the links:
   - **Copy link** at the top gives the whole review, one URL for the month.
   - **Copy all post links** gives one numbered line per post, ready to paste
     into the content schedule beside the captions:

     ```
     1. Carousel (3 slides) — https://review.example.com/r/caro-november-k3f9qa/p_7x2mq9ab
     2. Reel — https://review.example.com/r/caro-november-k3f9qa/p_m4t8wzld
     ```

   - **Copy link** on a single post gives just that one.

A post link opens that post on its own, with a line back to the full set. The
id is tied to the post, not its position, so reordering the review does not
break a link already sitting in a document.

Review links carry a random suffix (`/r/caro-november-k3f9qa`), so they cannot
be found by guessing a client name. Clients need no login and no account.

---

## Deploying it

**There is a step by step walkthrough in `DEPLOY.md`** next to this file,
written so it can be handed to someone, or to an agent, who has no context.
What follows is the summary.

October already has a Cloudflare account, the same one that serves
`october-platform` from this repo. This is a new project inside it, not a new
account.

| Setting | Value |
|---|---|
| Pages project | `social-review` |
| R2 bucket | `social-review-media` |
| Deploy method | Connect to Git, production branch `main` |
| Root directory | `dev/social-review` |
| Build command | none |
| Build output | `public` |

Then two secrets on the project, both type Secret, Production environment:

| Name | What it is |
|---|---|
| `TEAM_PASSWORD` | What the team types at `/admin` |
| `AUTH_SECRET` | 32+ random characters, signs the session cookie, never typed |

Three things bite, in order of how often:

1. **R2 needs a payment method on file** before Cloudflare will enable it, even
   though this stays inside the free allowance. The failure if you skip it does
   not explain itself.
2. **Root directory must be `dev/social-review`.** It hides behind an Advanced
   toggle. Miss it and every page 404s.
3. **Secrets apply on the next build, not the one already run.** Add them, then
   redeploy, or the admin reports that they are not set.

The live address is `social-review.pages.dev`. No custom domain is attached,
which is deliberate while this is a temporary tool. Adding one later does not
break links already sent, since the `pages.dev` address keeps working.

To deploy by hand instead of through Git:

```bash
cd dev/social-review && npx wrangler login && npx wrangler pages deploy
```

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

Five things already cost time. They are solved in the code; leave them solved.

1. **`_redirects` cannot serve `/r/<slug>`.** A line like `/r/* /review.html 200`
   comes back as a 308 to `/review` and drops the slug, so every share link dies
   silently. `functions/r/[[path]].js` serves the page instead, and the same
   catch-all handles `/r/<slug>/<postId>`.
2. **Do not add `functions/admin.js`.** Pages serves HTML at its extensionless
   URL, so `/admin` already resolves to `admin.html`. A function at `/admin`
   fetches `/admin.html`, gets a 308 back to `/admin`, and loops until it 500s.
3. **Restart wrangler after deleting a function.** The build cache keeps the old
   route and you will debug a file that no longer exists.
4. **Range requests are not optional.** `functions/m/[[path]].js` returns 206
   responses because Safari and iOS refuse to play video without them, and
   nobody can scrub a reel without them either.
5. **`[hidden]` needs the global override.** Several components set an explicit
   `display`, which beats the attribute. `[hidden] { display: none !important }`
   near the top of `ig.css` is load-bearing.

Crop logic lives in `cropWarnings()` in `public/assets/ig.js`. Compare each
slide's own ratio against the container shape; clamping a slide's ratio before
comparing makes a 9:16 slide look identical to a 4:5 one and the warning never
fires.

R2 keys are namespaced `media/<slug>/…`, and the media route always prefixes
`media/`, so manifests and the review index cannot be reached through `/m/`.
Keep it that way.

Post ids (`p_…`) are permanent once issued and appear in links that live in
client documents. Do not regenerate them on reorder.
