# OC Drag & Drop Post Reorder

A small, self-contained utility that adds **drag-and-drop reordering** to the
WordPress admin list tables for posts, pages and custom post types — and makes
that manual order the default sort order on the front end too.

Code lives in [`dev/post-reorder/post-reorder.php`](../../dev/post-reorder/post-reorder.php).

## What it does

- On any `edit.php` list screen (Posts, Pages, or a CPT) you can grab a row by
  its title and drag it up or down.
- The new order is saved instantly over AJAX into WordPress's built-in
  `menu_order` field — no extra database tables.
- `pre_get_posts` then orders those post types by `menu_order` (then title)
  everywhere, so archives, custom `WP_Query` loops and the admin list all
  reflect the hand-picked order.

## Installing

You have two options.

### Option 1 — as a plugin (recommended)

1. Copy `post-reorder.php` into `wp-content/plugins/` (or a subfolder).
2. Go to **Plugins → Installed Plugins** and activate **OC Drag & Drop Post
   Reorder**.

### Option 2 — pasted into `functions.php`

1. Open your (child) theme's `functions.php`.
2. Paste everything from the file **below the `/** Plugin Name … */` header
   block** — i.e. from `if ( ! defined( 'ABSPATH' ) )` down to the end.
   Removing the plugin header stops WordPress from mistaking it for a plugin.

Either way the behaviour is identical.

## Configuring which post types are reorderable

By default **every post type with an admin UI** becomes reorderable (posts,
pages and public CPTs; attachments are excluded). To restrict it, use the
`oc_reorder_post_types` filter:

```php
add_filter( 'oc_reorder_post_types', function () {
    return array( 'post', 'product', 'team_member' );
} );
```

There's a commented-out copy of this filter at the bottom of the PHP file.

## Notes & gotchas

- **Dragging is only enabled on an unfiltered, default-sorted list.** If you
  search, filter by author, sort by a different column, or view page 2+, the
  visual order no longer maps 1:1 onto `menu_order`, so the script shows a hint
  instead of letting you drag (this mirrors how 10up's *Simple Page Ordering*
  behaves). Clear the filters to reorder.
- Pagination is handled: the offset of the first visible row is factored in so
  ordering stays correct across pages.
- Capability-checked on both ends — enqueue and the AJAX save verify
  `edit_posts` for the type and `edit_post` per row, behind a nonce.
- Only `menu_order` is written, and rows already in the right position are
  skipped, so saves are cheap and don't spam revisions.
- If you want the front end to keep its previous order for a given loop, pass an
  explicit `orderby` to that `WP_Query` — the plugin only sets a default when
  none was requested.

## Uninstalling

Deactivate the plugin (or remove the snippet). The `menu_order` values remain in
the database but are harmless; the front-end reordering simply stops applying.
