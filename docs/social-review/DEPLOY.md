# Putting Social Review online

A guide for doing this yourself, in Terminal, from a standing start.

Read step 0 first. After that, run one command at a time and check what it
printed before moving on.

---

## 0. What you need to know first

**There is nothing to undo.** Earlier attempts left nothing behind. The storage
buckets they created have been deleted again and no Pages project was ever
created. You are starting from nothing.

**`omi-recordings` is a different project's bucket.** No step here touches it.

**Ignore Cloudflare's "connect to Git" option.** This repository is already
claimed by a Pages project on a different Cloudflare account, so that route
refuses to save, whatever the project is called. It cannot be unblocked from
the October Communications account. Everything below skips GitHub entirely.

**What you end up with:** a site at `https://socialfly.pages.dev`. You sign in
at `/admin` with a password you choose in step 7. Clients open links you send
them and need no login.

**How long:** about ten minutes. Afterwards, one command.

---

## 1. Open Terminal in the project folder

```bash
cd ~/claude/dev/social-review
```

If that errors with "No such file or directory", the repository is somewhere
else. Use that path instead, with `/dev/social-review` on the end.

If you have not cloned the repository at all:

```bash
cd ~ && git clone https://github.com/octobercomms/claude.git && cd claude/dev/social-review
```

## 2. Get the current code

```bash
git checkout main && git pull
```

**Expect:** "Already up to date", or a list of changed files. Both fine.

## 3. Sign in to Cloudflare

```bash
npx --yes wrangler@4 login
```

**Expect:** a browser tab opens asking you to allow Wrangler access. Approve
it, then return to Terminal, which should say you are logged in.

You only do this once on this machine.

## 4. Create the storage bucket

This holds the uploaded videos and images.

```bash
npx --yes wrangler@4 r2 bucket create socialfly
```

**Expect:** a line confirming the bucket was created.

**If it says R2 is not enabled:** turn it on at dash.cloudflare.com under R2,
then run this again.

## 5. Create the project

```bash
npx --yes wrangler@4 pages project create socialfly --production-branch main
```

**Expect:** a line confirming the project was created, mentioning
`socialfly.pages.dev`.

**If it says the name is unavailable:** someone else has taken it. Stop, pick
another name, change the `name =` line in `wrangler.toml` to match, and use
that name everywhere `socialfly` appears below.

## 6. Upload the site

```bash
npm run deploy
```

**Expect:** files uploading, then a success line with the URL.

The site is live but will not let you in yet. That is correct. Step 8 fixes it.

## 7. Set the two passwords

The first is what your team types to sign in. Choose something you are happy to
keep in the shared password manager.

```bash
npx --yes wrangler@4 pages secret put TEAM_PASSWORD --project-name socialfly
```

**Expect:** a prompt asking for the value. Type the password and press enter.
Nothing appears on screen as you type. That is normal.

The second is a long random string that signs the login cookie. Nobody ever
types it or needs to remember it. Generate one:

```bash
openssl rand -base64 32
```

**Expect:** a line of random characters. Copy it.

```bash
npx --yes wrangler@4 pages secret put AUTH_SECRET --project-name socialfly
```

Paste the random string at the prompt and press enter.

## 8. Upload again

```bash
npm run deploy
```

Passwords set in step 7 only reach the site on the next upload, which is why
this runs twice. Skipping it is the most common way this looks broken.

## 9. Check it works

1. Open `https://socialfly.pages.dev/admin`. You should see a password box.
   - If it says the passwords are not set, step 8 was skipped.
2. Type a wrong password. It should say "Wrong password".
3. Type the real one. You should see the review list.
4. Create a review called `Test`.
5. Drag any image into **Add a post**. It should appear in a phone frame.
   - If the upload fails, see Troubleshooting.
6. Press **Copy link** at the top, open it in a private window. It should load
   with no password prompt.
7. Open the `Test` review and press **Delete review**.

Working. You are done.

---

## Every time after this

Whenever the tool changes, two commands:

```bash
cd ~/claude/dev/social-review && git checkout main && git pull
```

```bash
npm run deploy
```

No sign-in, no passwords, no dashboard. `npm run deploy` carries the right
settings, including `--branch main`; without that flag wrangler names the
deployment after your current git branch and the upload lands as a preview
rather than the live site, while still reporting success.

---

## Making it automatic later, if it is worth it

The tool can redeploy itself whenever a change is merged, so you never run a
command. It needs a Cloudflare API token, about five minutes to set up once.

Cloudflare's own Git integration cannot do this, because of the repository
claim in step 0. A GitHub Actions workflow using an API token is not subject to
that claim, which is how `october-platform` already deploys from this repo.

Worth doing if this tool outlives its stopgap phase. Ask and it can be set up.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `TEAM_PASSWORD and AUTH_SECRET are not set` on the admin page | Passwords set but not yet uploaded | Run step 8 |
| Sign-in works, uploading a file fails | The storage binding is missing | Dashboard: Workers & Pages, socialfly, Settings, Bindings. Add an R2 bucket binding, variable name `MEDIA`, bucket `socialfly`. Then run step 8 |
| Every page shows 404 | Upload ran from the wrong folder | `cd ~/claude/dev/social-review`, then step 6 |
| The site loads but looks unstyled | Same cause | Same fix |
| A Cloudflare login screen instead of the password box | Wrong site, or an Access policy is on the project | Check the address is exactly `socialfly.pages.dev` |
| `project name is not available` at step 5 | Someone else has the name | Pick another and change `wrangler.toml` to match |
| Anything mentioning a different Cloudflare account | You are on the Git route, not this one | No step here touches GitHub. Re-read step 0 |

---

## What the pieces are

- **Cloudflare Pages** serves the site. The project is `socialfly`, so the
  address is `socialfly.pages.dev`.
- **Cloudflare R2** stores the uploaded videos and images, in a bucket also
  called `socialfly`. There is no database. The two can share a name because
  they are separate namespaces.
- **`TEAM_PASSWORD`** is what your team types. **`AUTH_SECRET`** signs the
  login cookie and is never typed by anyone.
- Client links look like `socialfly.pages.dev/r/caro-november-k3f9qa`, and each
  post also has its own link ending `/p_7x2mq9ab`. The random ending is why
  clients need no login: the link cannot be guessed.

Full documentation of the tool itself is in `README.md` beside this file.
