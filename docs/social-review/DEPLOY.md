# Deploy brief: Social Review

A task brief for an agent working in a browser. Everything here is done in the
Cloudflare dashboard and on GitHub. No terminal is needed and none is available.

---

## Fill this in before handing the brief over

| Field | Value |
|---|---|
| `TEAM_PASSWORD` | `________` (the password the October team will type to sign in) |

Leave nothing else to decide. Every other choice is settled below.

---

## What you are setting up

A small web app called **Social Review**. The October team uploads Instagram
carousels and reels to it; clients open a link and see each post rendered as it
will appear in the feed, then approve by email. It is a temporary tool while a
permanent solution is built.

The code already exists and is merged. It lives in the GitHub repository
`octobercomms/claude`, in the folder `dev/social-review`. You are not writing
or changing any code. You are connecting it to Cloudflare and deploying it.

## What it runs on

**Cloudflare Pages** serves the app. **Cloudflare R2** stores the uploaded
videos and images. Both sit inside Cloudflare's free tier at this volume.

Use the Cloudflare account the browser is already signed in to. If more than
one is listed, choose **October Communications**. **Do not create a new
Cloudflare account.**

R2 is already enabled on that account, so step 1 below should pass straight
through. A bucket named `omi-recordings` already exists there and belongs to a
different project. Leave it alone.

## Decisions already made

Do not revisit these. They are settled.

- **Project name:** `social-review`
- **R2 bucket name:** `social-review-media`
- **Deployment method:** connect to Git, not Direct Upload. Cloudflare watches
  the repository and redeploys on each push to `main`.
- **Production branch:** `main`
- **Root directory:** `dev/social-review`
- **Build command:** none, leave it empty. There is no build step.
- **Build output directory:** `public`
- **Custom domain:** none. The `social-review.pages.dev` address is fine. Skip
  any prompt offering to add a domain.

---

## Rules

- **Never enter payment card details.** If Cloudflare asks for a payment method
  and none is on file, stop and report that. Do not proceed past it.
- **Never put `TEAM_PASSWORD` or `AUTH_SECRET` into a file, a commit, a GitHub
  field, or a chat message.** They go only into Cloudflare's secret fields.
- **Do not change anything else in the account.** The `omi-recordings` bucket
  and any other project belong to separate work. Only create and touch
  `social-review` and `social-review-media`.
- **Do not change any code**, open a pull request, or push to the repository.
- If the dashboard's wording differs from this brief, the labels have moved
  rather than the task changing. Match on meaning. If you cannot find the
  equivalent, stop and report rather than guessing at something destructive.

---

## Steps

### 1. Confirm R2 is on

Go to `dash.cloudflare.com`, pick the account noted above, and open **R2** in
the left sidebar.

- If a bucket list appears, R2 is on. Go to step 2.
- If a sign-up or "Purchase R2" screen appears, you are in the wrong account.
  Check the account switcher. If R2 genuinely is not enabled, Cloudflare
  requires a payment method on file before enabling it, even though the
  allowance used here costs nothing. **Stop and report that.** Do not enter
  card details yourself.

### 2. Create the bucket

In **R2**, choose **Create bucket**.

- Name: `social-review-media`
- Location: leave as the default or Automatic
- Storage class: leave as the default (Standard)

Create it. If a bucket named `social-review-media` already exists, leave it as
it is and continue. Do not rename, empty or delete `omi-recordings` or any
other bucket.

### 3. Create the Pages project

Go to **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.

If GitHub is not yet authorised, follow the prompt to install or authorise the
Cloudflare GitHub app and grant it access to the `octobercomms/claude`
repository. This may need an organisation owner to approve.

**Expect friction here.** A Cloudflare Pages Git connection already exists on
this repository, owned by a different Cloudflare account, and it deploys a
project called `october-platform`. The GitHub app may therefore appear already
installed while not being linked to the account you are in. If the repository
does not appear in the list, or the connection is refused, or you would have to
change or remove an existing installation to proceed, **stop and report what
you see. Do not remove or reconfigure the existing connection**, which would
break someone else's deployment. There is a fallback that needs no GitHub
connection at all, and the person who gave you this brief can run it.

Select the repository `octobercomms/claude`, then set:

| Setting | Value |
|---|---|
| Project name | `social-review` |
| Production branch | `main` |
| Framework preset | None |
| Build command | leave empty |
| Build output directory | `public` |
| Root directory | `dev/social-review` |

Root directory is the one that is easy to miss and it is often behind an
**Advanced** or **Root directory (advanced)** toggle. Without it the deploy
publishes the wrong folder and the site 404s.

Save and deploy. The first build takes a minute or two. It will succeed but the
app will not work yet, because the secrets in step 4 are missing. That is
expected.

### 4. Set the two secrets

Go to **Workers & Pages** → **social-review** → **Settings**, and find the
variables and secrets section.

Add both for the **Production** environment, each with type **Secret** and not
plain text:

| Name | Value |
|---|---|
| `TEAM_PASSWORD` | The value filled in at the top of this brief |
| `AUTH_SECRET` | A random string you generate: at least 32 characters, mixed letters and digits. Nobody needs to know it or ever types it. Do not report it back. |

Save.

### 5. Check the R2 binding

On the same Settings page, find **Bindings**.

The project's `wrangler.toml` declares an R2 binding named `MEDIA` pointing at
`social-review-media`, and the build should have applied it.

- If a binding named `MEDIA` is listed, nothing to do.
- If it is not listed and the dashboard lets you add one, add: type **R2
  bucket**, variable name `MEDIA`, bucket `social-review-media`.
- If the dashboard says bindings are managed by the project's configuration
  file and will not let you add one, that is fine. It means `wrangler.toml` is
  in charge. Continue and rely on the test in step 7 to confirm.

This binding is what lets uploads reach storage. Without it the team can sign
in and then every upload fails.

### 6. Redeploy

The secrets from step 4 are picked up on the next build, not the one already
run.

Go to **Workers & Pages** → **social-review** → **Deployments**, find the most
recent deployment, and choose **Retry deployment** or **Redeploy**. Wait for it
to report success.

Note the URL it gives you. It should be `https://social-review.pages.dev`.

### 7. Test it end to end

This is the part that proves the setup, so do all of it.

1. Open `https://social-review.pages.dev/admin`. A password box should appear.
2. Enter a deliberately wrong password. It should say "Wrong password".
   - If it instead says `TEAM_PASSWORD and AUTH_SECRET are not set`, step 4 did
     not take effect. Redo step 6 and try again.
3. Enter the real password. A list of reviews should appear.
4. Create a review named `Deployment test`.
5. In **Add a post**, upload any single image file, such as a JPG or PNG.
   - If the upload fails, the R2 binding from step 5 is the cause. Report that.
6. Confirm the image appears as a post, rendered inside a phone frame.
7. Copy the client link using **Copy link** at the top of the page.
8. Open that link in a private or incognito window. It should load with **no
   password prompt** and show the image in the phone frame.
9. Return to the admin, open the `Deployment test` review, and choose **Delete
   review** to clean up.
10. Choose **Sign out**.

---

## What to report back

- The live URL, which should be `https://social-review.pages.dev`
- Whether each of steps 1 to 7 succeeded, and the exact wording of any error
- Whether the `MEDIA` binding was already present or you added it
- Whether the end to end test in step 7 passed, naming any step that did not
- Confirmation that the test review was deleted

Do not include `TEAM_PASSWORD` or `AUTH_SECRET` in your report.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Admin says `TEAM_PASSWORD and AUTH_SECRET are not set` | Secrets added after the last build | Redeploy, step 6 |
| Sign-in works, uploads fail | R2 binding missing | Step 5, then redeploy |
| Site shows 404 on every page | Root directory not set to `dev/social-review` | Settings → Builds, correct it, redeploy |
| Site loads but has no styling | Build output directory is not `public` | Settings → Builds, correct it, redeploy |
| Client link asks for a password | A Cloudflare Access policy is on the project | Remove it. Client links are meant to be open |
| R2 page asks to purchase | R2 not enabled on the account | Stop and report. Do not enter card details |

---

## Background, for context only

Nothing below needs doing. It is here so the setup makes sense.

Client links look like `https://social-review.pages.dev/r/caro-november-k3f9qa`,
and each individual post also has its own link ending in `/p_7x2mq9ab`. The
random suffix means links cannot be found by guessing a client name, which is
why clients need no login.

The app is deliberately unbranded so one deployment can front every client. The
header text comes from a `BRAND_NAME` value in the project's `wrangler.toml` and
reads `Content Review`. Do not change it.

Media and review data both live in the R2 bucket. There is no database.

Full documentation is at `docs/social-review/README.md` in the repository.
