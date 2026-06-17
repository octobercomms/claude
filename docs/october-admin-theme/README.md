# October Admin Theme

A WordPress plugin that makes the wp-admin backend feel calm and
Squarespace-simple for clients: generous whitespace, refined typography, a warm
palette, and — most importantly — a **short sidebar** that folds all the
technical clutter into a collapsible **"Advanced"** section.

Code lives in `dev/october-admin-theme/`. This folder holds the docs.

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
│   ├── class-october-menu.php       # the Advanced section (menu reorg)
│   ├── class-october-dashboard.php  # dashboard tidy-up + welcome panel
│   └── class-october-cleanup.php    # footer text, admin-bar trim
└── assets/
    ├── admin-style.css              # the skin
    ├── admin-script.js              # Advanced toggle only (~1 KB)
    └── login-style.css              # login screen
```

## Performance

This is built to load fast:

- **One CSS file, one JS file.** No framework, no build step.
- **No external network requests.** System fonts by default; no Google Fonts.
- **JS is ~1 KB** and only handles the Advanced toggle. The skin, menu order,
  and branding are server-rendered, so there's no repaint or layout shift.
- **Admin-only.** Nothing enqueues on the front end.
- **Aggressive caching** via `filemtime` (dev) / version (prod) cache-busting.
- *Recommended before release:* minify `admin-style.css` (~26 KB → ~9 KB).

## Customising per site

Everything is filterable — nothing is hard-deleted, so power users keep full
access via the Advanced section.

```php
// Which top-level menu items stay visible (everything else → Advanced).
add_filter( 'october_admin_essentials', function ( $slugs ) {
	$slugs[] = 'edit.php?post_type=tour';        // Architourian: Tours
	$slugs[] = 'edit.php?post_type=travel_tip';  // Architourian: Travel Tips
	return $slugs;
} );

// Turn the menu simplification off entirely (e.g. for developer accounts).
add_filter( 'october_admin_simplify_menu', '__return_false' );

// Use a custom self-hosted font instead of the system stack.
define( 'OCTOBER_ADMIN_FONT_URL', plugins_url( 'assets/inter.woff2', __FILE__ ) );
// …then add 'Inter' to the front of --cl-font in admin-style.css.
```

## Roadmap / open decisions

- **Role-based simplification** — option to show the full menu to admins and the
  simplified one only to editors/clients.
- **Self-hosted Inter** subset bundled in (vs. system stack) — pending the
  font decision.
- **Per-site essentials presets** for each client build.
