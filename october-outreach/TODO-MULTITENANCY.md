# Multi-Tenancy Roadmap

**Goal:** Allow multiple clients to log in to a single WordPress install at
`outreach.octobercomms.com` and each see only their own data — contacts,
campaigns, sequences, settings, API keys. Zero data bleed between accounts.

**Business model this enables:**
- Tier 1: Download the plugin and self-host (existing)
- Tier 2: Hosted SaaS login at outreach.octobercomms.com (new)

**Estimated effort:** 3–4 weeks  
**Risk level:** Medium — the pattern is mechanical but touches every file

---

## Architecture Decision

Use **user-scoped single install** (not WordPress Multisite).

Every database table gets a `user_id` column. Every query is scoped to
`get_current_user_id()`. Settings move from site-wide `wp_options` to per-user
`wp_usermeta`. One WordPress install, one database, one codebase.

---

## 1. Database Schema Changes

File: `includes/class-oo-database.php`

Add `user_id bigint(20) NOT NULL DEFAULT 0` and `KEY user_id (user_id)` to
**all six tables**:

- `oo_contacts`
- `oo_campaigns`
- `oo_sequences`
- `oo_sends`
- `oo_coupons`
- `oo_press_releases`

`oo_campaign_contacts` is a junction table — it doesn't need `user_id` directly
because both `campaign_id` and `contact_id` are already scoped to a user.

**Migration note:** Existing rows should get `user_id = 1` (the main admin) so
no data is lost. Add this to `maybe_update()`:

```php
// After dbDelta — backfill existing rows to user 1
$wpdb->query( "UPDATE {$wpdb->prefix}oo_contacts   SET user_id = 1 WHERE user_id = 0" );
$wpdb->query( "UPDATE {$wpdb->prefix}oo_campaigns  SET user_id = 1 WHERE user_id = 0" );
// ... etc for all tables
```

---

## 2. Settings — Move from Site Options to User Meta

**Currently:** All 23 settings (API keys, licence key, email provider config)
are stored in one `wp_options` row: `get_option( 'oo_settings' )`.

**Change to:** `get_user_meta( get_current_user_id(), 'oo_settings', true )`

Files that call `get_option( 'oo_settings' )` — **every one of these needs updating**:

| File | Lines (approx) |
|------|----------------|
| `includes/class-oo-database.php` | set_defaults() |
| `includes/class-oo-hunter.php` | __construct() |
| `includes/class-oo-icypeas.php` | __construct() |
| `includes/class-oo-claude.php` | __construct() |
| `includes/class-oo-mailer.php` | __construct() |
| `includes/class-oo-serper.php` | __construct() |
| `includes/class-oo-airtable.php` | __construct() |
| `includes/class-oo-license.php` | is_active(), get_status_label() |
| `admin/class-oo-admin.php` | save_settings(), enqueue_assets() |
| `admin/views/settings.php` | top of file |
| `admin/views/dashboard.php` | top of file |
| `admin/views/wizard.php` | top of file |
| `admin/views/contact-finder.php` | top of file |
| `admin/views/contacts.php` | Airtable button check |

**Recommended helper** — add to `class-oo-database.php` or a new
`class-oo-settings.php`:

```php
class OO_Settings {
    public static function get( $key = null, $default = '' ) {
        $uid      = get_current_user_id();
        $settings = get_user_meta( $uid, 'oo_settings', true ) ?: array();
        if ( $key === null ) return $settings;
        return $settings[ $key ] ?? $default;
    }

    public static function update( $data ) {
        $uid      = get_current_user_id();
        $existing = get_user_meta( $uid, 'oo_settings', true ) ?: array();
        update_user_meta( $uid, 'oo_settings', array_merge( $existing, $data ) );
    }
}
```

Then everywhere you currently have `get_option( 'oo_settings', array() )`,
replace with `OO_Settings::get()`.

---

## 3. All Database Queries — Add user_id Scoping

Every `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the plugin's tables needs
`AND user_id = get_current_user_id()` (reads) or `'user_id' => get_current_user_id()`
(writes).

### `admin/class-oo-ajax.php` (~30 queries — largest file to change)

Go through every method and:
- **INSERTs**: add `'user_id' => get_current_user_id()` to the data array
- **SELECTs/UPDATEs/DELETEs**: add `AND user_id = %d` / `array( 'user_id' => get_current_user_id() )` to WHERE conditions

Methods that need touching:
- `wizard_save_meta()` — INSERT/UPDATE oo_campaigns
- `wizard_refine_audience()` — SELECT emails from oo_contacts
- `wizard_search_contacts()` — SELECT emails from oo_contacts (existing domains check)
- `wizard_save_contacts()` — delegates to OO_Hunter::save_contacts()
- `wizard_generate_emails()` — SELECT oo_campaigns, SELECT oo_contacts
- `wizard_save_sequence()` — DELETE + INSERT oo_sequences
- `wizard_launch()` — UPDATE oo_campaigns, SELECT oo_sequences, SELECT oo_campaign_contacts, INSERT oo_sends
- `wizard_filter_contacts()` — SELECT oo_contacts
- `wizard_link_contacts()` — INSERT oo_campaign_contacts
- `verify_emails()` — UPDATE oo_contacts
- `bulk_delete_dead()` — DELETE oo_contacts
- `enrich_locations()` — SELECT + UPDATE oo_contacts

### `includes/class-oo-hunter.php`

`save_contacts()` — add `'user_id' => get_current_user_id()` to INSERT and to
the duplicate-check SELECT.

`search_domains()` / `domain_search()` — no DB writes, no change needed.

### `includes/class-oo-airtable.php`

`push_all_contacts()` and `pull_contacts()` — add `AND user_id = get_current_user_id()`
to all contact queries.

### `admin/class-oo-admin.php`

- `save_contact()` — add user_id to INSERT/UPDATE
- `delete_contact()` — add user_id to DELETE WHERE
- `bulk_delete_contacts()` — add user_id to DELETE WHERE
- `save_campaign()` — add user_id to INSERT/UPDATE
- `delete_campaign()` — add user_id to DELETE WHERE
- `export_contacts_csv()` — add user_id to SELECT
- `import_contacts_csv()` — add user_id to INSERT and duplicate-check SELECT

### `october-outreach.php` (sequence processing handler)

`oo_process_sequences_handler()` runs as a background cron/Action Scheduler job.
It doesn't have a "current user" context. Two options:
1. Store `user_id` on the campaign and carry it through to sends — preferred
2. Run as WP admin (user 1) and query by campaign's user_id

The campaign's `user_id` is already in the DB after step 3 above. Pass it
explicitly rather than using `get_current_user_id()` in cron context.

---

## 4. Views — Scope Display Queries

Files: `admin/views/contacts.php`, `admin/views/campaigns.php`,
`admin/views/dashboard.php`, `admin/views/press.php`

All `SELECT * FROM {$wpdb->prefix}oo_contacts ...` etc. need
`AND user_id = {current_user_id}` in their WHERE clause. These are
straightforward — the pattern is the same in every view.

---

## 5. User Registration & Onboarding

WordPress has user registration built in. You need:

1. **Enable registration** — `wp-admin → Settings → General → Anyone can register`
   (or handle it programmatically)

2. **Custom registration page** at `outreach.octobercomms.com/register` —
   capture name, email, password. Use `wp_create_user()`.

3. **Onboarding redirect** — after first login, redirect new users to
   `?page=oo-settings` to enter their API keys before anything else.

4. **Role** — create a custom `oo_client` role with only the capabilities
   needed to use the plugin. Do NOT give clients `manage_options` or
   standard editor/author roles. Use `add_role()` on plugin activation.

5. **Hide WP admin bar and standard menus** — non-admin users should see
   only the Outreach menu. Add to `class-oo-admin.php`:
   ```php
   // Redirect non-admins away from standard WP admin
   add_action( 'admin_init', function() {
       if ( ! current_user_can( 'manage_options' ) && ! defined( 'DOING_AJAX' ) ) {
           wp_redirect( admin_url( 'admin.php?page=october-outreach' ) );
           exit;
       }
   } );
   ```

---

## 6. Billing & Plan Gating (optional at launch)

If you want to gate features by plan:

- Use a user meta field `oo_plan` = `'free' | 'starter' | 'pro'`
- Check it in `OO_License::is_active()` — the licence key mechanism already
  exists, you'd just swap the validation source
- For Stripe: use [Stripe Checkout](https://stripe.com/docs/checkout) with a
  webhook that sets `oo_plan` on successful subscription
- Alternatively: WooCommerce Subscriptions handles this with zero custom billing code

---

## 7. File Summary — What Changes

| File | Type of change |
|------|---------------|
| `includes/class-oo-database.php` | Add user_id to all table schemas + migration backfill |
| `includes/class-oo-hunter.php` | Add user_id to save_contacts() INSERT + SELECT |
| `includes/class-oo-claude.php` | Settings source change only |
| `includes/class-oo-icypeas.php` | Settings source change only |
| `includes/class-oo-mailer.php` | Settings source change only |
| `includes/class-oo-serper.php` | Settings source change only |
| `includes/class-oo-airtable.php` | Settings source change + user_id on queries |
| `includes/class-oo-license.php` | Settings source change only |
| `admin/class-oo-admin.php` | Settings save + all form handlers + redirect hook |
| `admin/class-oo-ajax.php` | ~30 queries — all need user_id scoping |
| `admin/views/*.php` | SELECT queries + settings reads |
| `october-outreach.php` | Cron handler — use campaign's stored user_id |
| **NEW** `includes/class-oo-settings.php` | Helper wrapping get/update user meta |
| **NEW** registration page template | WP page template for signup flow |

---

## Suggested Build Order

1. `class-oo-settings.php` helper — unblocks everything else
2. Schema migration (add user_id columns + backfill)
3. Update all `get_option`/`update_option` calls to use the helper
4. Scope all queries in `class-oo-ajax.php`
5. Scope all queries in form handlers (`class-oo-admin.php`)
6. Scope all queries in views
7. Fix cron handler to use stored user_id
8. User role + redirect + hide WP admin
9. Registration page + onboarding flow
10. Billing integration (can ship without this initially)

**Test after each step** — the data isolation is only as strong as the
weakest query. A single unscoped SELECT leaks data between accounts.
