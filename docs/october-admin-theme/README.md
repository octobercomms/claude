# October Admin Theme

A WordPress plugin that makes the wp-admin backend feel calm and
Squarespace-simple for clients: a **monochrome black/white/grey skin** (no
colour — the only "accent" is an underline), generous whitespace, a white
left-nav, and a **short sidebar** that folds all the technical clutter into a
collapsible **"Advanced"** section.

It also bundles two things so you don't need separate plugins:

- **Classic editor** — Gutenberg is disabled site-wide; the classic TinyMCE
  editor is used everywhere. (Drop the standalone Classic Editor plugin.)
- **No WordPress toolbar** — it's removed entirely. In wp-admin it's hidden and
  its space reclaimed; **"View Site"** and **"Log Out"** move to the bottom of
  the sidebar. On the front end it's replaced with a small floating
  **"Dashboard"** link for logged-in users.

The sidebar itself is **grouped** like Squarespace: a header-less Dashboard at
the top, then labelled sections (**Website Content**, **Analytics**,
**Settings**), then the collapsible **Advanced** group, then the utility links —
with bigger nav text, smaller sub-nav, and real spacing between groups.

Code lives in `dev/october-admin-theme/`. This folder holds the docs.

## Look & feel

Pure monochrome, Squarespace-style:

- **Palette:** white canvas, white sidebar, greys for muted text and borders,
  black for buttons and active states. No colour anywhere.
- **Underline accents:** links are underlined; the active/hovered sidebar item
  underlines its label (the Squarespace tell) rather than changing colour.
- **Notices** are greyscale, distinguished only by the weight of a grey
  left-border (error darkest → info lightest). *If a client needs the usual
  green/red semantic notice colours back, that's a one-block change — say so.*
- **Typography:** OS system font stack (San Francisco / Segoe UI), no web font.

## Can you really override *all* of the WordPress design?

Honest answer: **no — and you shouldn't try.** You can reliably reskin ~90–95%
of WordPress *core* admin (menu, toolbar, list tables, forms, settings pages,
dashboard) because it's server-rendered HTML with stable IDs and classes. What
you can't reliably win:

1. **Third-party plugin screens.** WooCommerce Analytics, Site Kit, and the
   Elementor editor are their own React apps; JetEngine/Crocoblock, Gravity
   Forms etc. ship their own admin CSS that loads *after* ours and at higher
   specificity. A pure CSS skin leaves these half-styled — which is the
   "inconsistent / broken" look v1 produced.
2. **The block editor (Gutenberg)** is a React SPA. You can theme its chrome,
   but deep restyling is brittle and breaks on WordPress updates.
3. **Markup churn.** Core HTML changes between versions, so giant `!important`
   selector piles rot over time.

So the winning strategy is a **hybrid**, and it's what this plugin does:

- **Skin the core chrome** clients see daily (done with a tight CSS layer).
- **Reduce the surface area** instead of restyling everything — the Advanced
  section hides the screens clients never touch, so there's far less to style
  and far less to break. *Squarespace is simple because it has few screens, not
  because every screen is individually beautiful.*
- **Own a page or two outright** — the custom welcome panel is markup + CSS we
  fully control.

## Why v1 looked broken (and what changed in v2)

| v1 problem | v2 fix |
|---|---|
| `@import` of Google Fonts inside the CSS — render-blocking, and often blocked entirely so the font silently fell back | System-font stack (zero network cost); optional self-hosted `.woff2` via `OCTOBER_ADMIN_FONT_URL`, preloaded |
| `.claude-theme * { font-family: … !important }` — a universal rule that overrides **icon fonts** (Dashicons, Elementor eicons, WooCommerce, Font Awesome) → rows of "tofu" boxes | Font scoped to text surfaces only; icon fonts explicitly re-asserted |
| Sidebar branding + menu tweaks injected by JS on `DOMContentLoaded` → flash of the un-themed menu, then a jump | Branding and the whole Advanced reorganization done in **PHP**, so the menu arrives correct |
| `admin-style.css` registered twice (once enqueued, once as a "color scheme") | Single enqueue, single body class |
| Nothing actually hidden — still the full cluttered menu | Collapsible Advanced section |

## Architecture

```
dev/october-admin-theme/
├── october-admin-theme.php          # loader: defines constants, boots classes
├── includes/
│   ├── class-october-assets.php     # enqueue CSS/JS, fonts, cache-busting
│   ├── class-october-menu.php       # grouped sidebar + Advanced group
│   ├── class-october-dashboard.php  # dashboard tidy-up + welcome panel
│   ├── class-october-cleanup.php    # front-end Dashboard link, footer
│   └── class-october-editor.php     # classic editor (Gutenberg off)
└── assets/
    ├── admin-style.css              # the skin
    ├── admin-script.js              # Advanced toggle + utility hrefs (~1.5 KB)
    └── login-style.css              # login screen
```

## Performance

This is built to load fast:

- **One CSS file, one JS file.** No framework, no build step.
- **No external network requests.** System fonts by default; no Google Fonts.
- **JS is ~1.5 KB** — the Advanced toggle plus setting the utility links. The
  skin, grouping, and branding are server-rendered, so there's no layout shift.
- **Front end stays light.** The only front-end addition is a small inline
  "Dashboard" link for logged-in users; block-library CSS is dequeued.
- **Aggressive caching** via `filemtime` (dev) / version (prod) cache-busting.
- *Recommended before release:* minify `admin-style.css` (~26 KB → ~9 KB).

## Customising per site

Everything is filterable — nothing is hard-deleted, so power users keep full
access via the Advanced section.

```php
// Define the sidebar groups (label + ordered slugs). Anything not listed
// falls into the collapsible "Advanced" group automatically.
add_filter( 'october_admin_menu_groups', function ( $groups ) {
	// e.g. add the Architourian CPTs to the Website Content group:
	$groups[1]['slugs'][] = 'edit.php?post_type=tour';
	$groups[1]['slugs'][] = 'edit.php?post_type=travel_tip';
	return $groups;
} );

// Remove specific top-level items entirely (not just fold into Advanced) —
// handy for vendor labels you never want, e.g. a Crocoblock divider slug.
add_filter( 'october_admin_remove_menus', function ( $slugs ) {
	$slugs[] = 'jet-dashboard';
	return $slugs;
} );

// Turn the menu simplification off entirely (e.g. for developer accounts).
add_filter( 'october_admin_simplify_menu', '__return_false' );

// Keep Gutenberg / the block editor on (don't force the classic editor).
add_filter( 'october_admin_disable_block_editor', '__return_false' );

// Use a custom self-hosted font instead of the system stack.
define( 'OCTOBER_ADMIN_FONT_URL', plugins_url( 'assets/inter.woff2', __FILE__ ) );
// …then add 'Inter' to the front of --cl-font in admin-style.css.
```

## Roadmap / open decisions

- **Role-based simplification** — option to show the full menu to admins and the
  simplified one only to editors/clients.
- **Self-hosted Inter** subset bundled in (vs. system stack) — pending the
  font decision.
- **Per-site group presets** for each client build (incl. the right CPT slugs).
- **Monochrome login screen** — `login-style.css` is still the warm palette.
