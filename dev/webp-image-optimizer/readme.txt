===  WebP Image Optimizer ===
Contributors:      octobercomms
Tags:              webp, image, optimize, compress, performance
Requires at least: 6.0
Tested up to:      6.7
Requires PHP:      8.1
Stable tag:        1.1.2
License:           GPL-2.0-or-later

Automatically converts uploaded images to WebP, scales them, and serves them transparently — no paid subscription required.

== Description ==

**WebP Image Optimizer** converts your JPG, PNG, and GIF uploads to WebP format on the fly, typically reducing file size by 25–35 % with no visible quality loss.

Features:

* Auto-converts every new upload (full size + all thumbnail sizes).
* Scales images down to a configurable maximum dimension on upload.
* Serves WebP two ways: rewrites image URLs in the page HTML to the .webp file when it exists, and (on Apache) serves .webp transparently via mod_rewrite. Browsers that don't support WebP continue to receive the original file.
* Keeps originals alongside .webp files (safe fallback).
* Bulk converter: process your entire existing Media Library in batches with a progress bar. Built to handle very large libraries (10,000+ images) reliably.
* Works with either **Imagick** (preferred) or **GD** — no external service required.
* Zero recurring costs.

== Installation ==

1. Upload the `webp-image-optimizer` folder to `/wp-content/plugins/`.
2. Activate the plugin from **Plugins → Installed Plugins**.
3. Go to **Settings → WebP Optimizer** to configure quality and max dimensions.
4. For existing images, use the **Bulk Convert** button on the settings page.

== Requirements ==

Your PHP installation must have either:
* **Imagick** extension with WebP support, **or**
* **GD** extension compiled with `--with-webp`

Most modern hosting providers (including WP Engine, Kinsta, SiteGround, Cloudways) include one of these. Check the settings page to see which is available on your server.

== Frequently Asked Questions ==

= Will this break my site if a browser doesn't support WebP? =

No. URLs are only rewritten to the .webp version when that file actually exists on disk, and the Apache .htaccess rule only serves .webp when the browser sends `Accept: image/webp`. Originals are kept as a fallback.

= I'm on Nginx, not Apache — will it work? =

Yes. The HTML URL-rewriting layer works on any server because the browser requests the .webp file by name. The .htaccess transparent-swap rule is Apache-only; on Nginx you can translate the equivalent logic into your server block (the settings page shows it).

= Can I re-run the bulk converter after changing quality/dimension settings? =

Yes. Tick **Re-convert images that already have a WebP file** before clicking **Start Bulk Convert** — it will re-encode everything with your current settings. Left unticked, the bulk converter skips images that are already done, so an interrupted run picks up where it left off instead of starting over.

= The bulk converter stops with a "network error" on a large library. What do I do? =

Just click **Start Bulk Convert** again — with "Re-convert" left unticked it resumes from where it stopped. As of 1.1.2 the converter is also far more resilient: it recovers from a failed batch automatically (retrying with backoff, isolating one image at a time, and skipping any single image that can't be processed) rather than halting the whole run, and it raises the PHP time/memory limits while it works. These errors typically stem from a single very large image hitting the server's memory limit, or a server request timeout.

== Changelog ==

= 1.1.2 =
* Bulk converter now handles very large media libraries (10,000+ images) reliably — fixes the "network error / not valid JSON" that halted long runs.
* Removed a costly full-library count (`posts_per_page => -1`) that reloaded every attachment ID on every batch; the total now comes from the batch query itself.
* Resilient batches: a failed batch retries with backoff, shrinks to one image to isolate a problem file, and skips a single unprocessable image instead of stopping the whole run. Non-JSON/timeout responses are handled gracefully.
* Resumable: skips images that already have an up-to-date WebP file, so an interrupted run continues where it left off. New "Re-convert existing" option forces a full re-encode.
* Raises PHP time/memory limits during conversion (only ever raising, never lowering a host's higher limit) and keeps the earlier output-buffering guard against stray output.

= 1.1.1 =
* Initial hardening of the bulk converter (output buffering, higher memory/time limits, per-image try/catch). Superseded by the more complete fix in 1.1.2.

= 1.1.0 =
* Added on-the-fly HTML URL rewriting: `src`/`srcset` in page output point directly at .webp files when they exist, so WebP is served without relying solely on the Apache .htaccess rule (works on Nginx too).

= 1.0.0 =
* Initial release.
