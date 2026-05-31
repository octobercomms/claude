# Hillcroft Garden Designer — Install & Updates

How the plugin is installed once and then updates itself, so we never hand-upload zips again.

## One-time install

1. Build (or download) the zip:
   - Locally: `dev/hillcroft-gardens/bin/build-zip.sh` → produces
     `releases/hillcroft-garden-designer-<version>.zip`.
   - Or download the zip asset from the matching **GitHub Release** (built automatically — see
     below).
2. In WordPress: **Plugins → Add New → Upload Plugin** → choose the zip → **Install** →
   **Activate**.
3. Go to **Hillcroft → Settings** and fill in:
   - **API keys** (Claude, Gemini, Google Maps, Plant.id, Stripe) — added as features land.
   - **Updates** section:
     - **Repository**: `octobercomms/claude`
     - **GitHub access token**: a fine-grained token (see below)
     - **Release tag prefix**: `hgd-v` (default)
     - Optionally tick **Enable automatic background updates**.

That's the only manual upload ever needed.

## The GitHub access token

The repo is private, so the self-updater needs a token to read releases and download the zip.

- Create a **fine-grained personal access token** scoped to **only** the `octobercomms/claude`
  repository, with **Contents: Read-only** permission.
- Paste it into **Hillcroft → Settings → Updates → GitHub access token**. It's stored on the
  site and masked in the UI thereafter.
- Rotate it any time by pasting a new one; leaving the field blank keeps the existing token.

## Shipping a new version (the dev workflow)

1. Make changes under `dev/hillcroft-gardens/`.
2. Bump the version in **both**:
   - the plugin header `Version:` in `hillcroft-garden-designer.php`, and
   - `Stable tag:` in `readme.txt`.
   - Add a `== Changelog ==` entry.
3. Merge to `main`.
4. Tag the release: `git tag hgd-v<version> && git push origin hgd-v<version>`
   (the tag version **must** match the header version — the Action checks this).
5. The **GitHub Action** (`.github/workflows/hillcroft-garden-designer-release.yml`) builds
   `hillcroft-garden-designer-<version>.zip` and publishes a GitHub Release with it attached.
6. Within a few hours (or immediately on a manual "Check for updates"), Donna's site shows the
   update under **Dashboard → Updates** and installs it with one click — or silently if
   auto-update is on.

## How the updater picks the right release

The site looks at the repo's releases, ignores drafts/pre-releases, and considers only tags
starting with `hgd-v`. It takes the highest version above the installed one and offers its
`.zip` asset. The `hgd-v` prefix keeps it isolated from any other app's releases in this
monorepo.

## Notes

- Release zips are **gitignored** — distribution is via GitHub Release assets, not committed
  files.
- Tables (plant catalogue, usage log) are preserved across deactivate/reactivate and even
  uninstall, so client data is never lost accidentally.
