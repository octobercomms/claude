# Putting Social Review online

A guide for doing this yourself, in Terminal, from a standing start.

Read the whole of step 0 first. After that, run one command at a time and
check what it printed before moving on.

---

## 0. What you need to know first

**There is nothing to undo.** Earlier attempts created one thing, an R2 storage
bucket called `social-review-media` in the October Communications Cloudflare
account. That bucket is wanted and is used below. Nothing else was created and
nothing was changed.

**Ignore Cloudflare's "connect to Git" option.** This repository is already
claimed by a Pages project on a different Cloudflare account, so that route
refuses to save, whatever the project is called. It cannot be unblocked from
the October Communications account. The method below skips GitHub entirely and
is unaffected.

**What you will end up with:** a site at `https://socialfly.pages.dev`. You
sign in at `/admin` with a password you choose in step 5. Clients open links
you send them and need no login.

**How long:** about ten minutes the first time. Afterwards, one command.

---

## 1. Open Terminal in the project folder

```bash
cd ~/claude/dev/social-review
```

If that errors with "No such file or directory", the repository is somewhere
else. Find it, and use that path instead with `/dev/social-review` on the end.

If you have not cloned the repository at all:

```bash
cd ~ && git clone https://github.com/octobercomms/claude.git && cd claude/dev/social-review
```

## 2. Get the current code

```bash
git checkout main && git pull
```

**Expect:** either "Already up to date" or a list of changed files. Both fine.

## 3. Sign in to Cloudflare

```bash
npx --yes wrangler@4 login
```

**Expect:** a browser tab opens asking you to allow Wrangler access. Approve
it, then return to Terminal, which should say you are logged in.

You only ever do this once on this machine.

## 4. Create the project

```bash
npx --yes wrangler@4 pages project create socialfly --production-branch main
```

**Expect:** a line confirming the project was created, mentioning
`socialfly.pages.dev`.

**If it says the name is unavailable:** someone else has taken it. Stop and
pick another name. Whatever you choose must also be changed in `wrangler.toml`
on the `name =` line, and used in place of `socialfly` in steps 5 and 6.

## 5. Upload the site

```bash
npx --yes wrangler@4 pages deploy --branch main
```

**Expect:** a list of files uploading, then a success line with the URL.

The site is now live but will not let you in yet. That is correct. Step 6
fixes it.

## 6. Set the two passwords

The first is the password your team will type to sign in. Choose something you
are happy to keep in the shared password manager.

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

## 7. Upload again

```bash
npx --yes wrangler@4 pages deploy --branch main
```

Passwords set in step 6 only reach the site on the next upload, which is why
this runs twice. Skipping it is the single most common way this appears
broken.

## 8. Check it works

1. Open `https://socialfly.pages.dev/admin`. You should see a password box.
   - If it says the passwords are not set, step 7 was skipped. Run it again.
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

That is the whole update process. No sign-in, no passwords, no dashboard.
`npm run deploy` is the same upload as step 5, with the right settings built
in.

---

## Making it automatic later, if it is worth it

The tool can redeploy itself whenever a change is merged, so you never run a
command at all. It needs a Cloudflare API token, which takes about five
minutes to set up once.

Cloudflare's own Git integration cannot do this, because of the repository
claim described in step 0. A GitHub Actions workflow using an API token is not
affected by that claim, and `october-platform` in this repo already deploys
that way.

Worth doing if this tool outlives its stopgap phase. Not worth it for a few
weeks of use. Ask and it can be set up.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `TEAM_PASSWORD and AUTH_SECRET are not set` on the admin page | Passwords were set but not yet uploaded | Run step 7 |
| Sign-in works, uploading a file fails | The storage binding is missing | In the Cloudflare dashboard: Workers & Pages, socialfly, Settings, Bindings. Add an R2 bucket binding, variable name `MEDIA`, bucket `social-review-media`. Then run step 7 |
| Every page shows 404 | The upload ran from the wrong folder | `cd ~/claude/dev/social-review` and run step 5 again |
| The site loads but looks unstyled | Same cause as above | Same fix |
| A Cloudflare login screen appears instead of the password box | An Access policy is on the project, or you are looking at the wrong site | Check the address is exactly `socialfly.pages.dev`. If it is, remove the Access policy in Zero Trust |
| `project name is not available` at step 4 | Someone else has the name | Pick another, and change it in `wrangler.toml` too |
| Anything mentioning a different Cloudflare account | You are on the Git route, not this one | None of steps 1 to 8 touch GitHub. Re-read step 0 |

---

## What the pieces are

- **Cloudflare Pages** serves the site. The project is `socialfly`, so the
  address is `socialfly.pages.dev`.
- **Cloudflare R2** stores the uploaded videos and images, in the bucket
  `social-review-media`. There is no database.
- **`TEAM_PASSWORD`** is what your team types. **`AUTH_SECRET`** signs the
  login cookie and is never typed by anyone.
- Client links look like `socialfly.pages.dev/r/caro-november-k3f9qa`, and each
  post also has its own link ending `/p_7x2mq9ab`. The random ending is why
  clients need no login: the link cannot be guessed.

Full documentation of the tool itself is in `README.md` beside this file.
