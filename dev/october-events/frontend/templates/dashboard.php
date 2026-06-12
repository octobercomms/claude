<?php
/**
 * Account dashboard shell (§2). Hydrated by assets/js/dashboard.js.
 *
 * @var int $account_id
 */
defined('ABSPATH') || exit;
?>
<div class="oe-dashboard" id="oe-dashboard">
    <nav class="oe-tabs" role="tablist">
        <button class="oe-tab is-active" data-tab="overview"><?php esc_html_e('Overview', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="listings"><?php esc_html_e('My Listings', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="submit"><?php esc_html_e('Submit New', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="tickets"><?php esc_html_e('Tickets', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="volunteer"><?php esc_html_e('Volunteer', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="invoices"><?php esc_html_e('Invoices', 'october-events'); ?></button>
        <button class="oe-tab" data-tab="settings"><?php esc_html_e('Account', 'october-events'); ?></button>
    </nav>

    <section class="oe-panel is-active" data-panel="overview">
        <h2><?php esc_html_e('Overview', 'october-events'); ?></h2>
        <div class="oe-cards" id="oe-overview-cards"><p class="oe-loading"><?php esc_html_e('Loading…', 'october-events'); ?></p></div>
    </section>

    <section class="oe-panel" data-panel="listings">
        <h2><?php esc_html_e('My Listings', 'october-events'); ?></h2>
        <div class="oe-subtabs" id="oe-listing-filter"></div>
        <div id="oe-listings"></div>
    </section>

    <section class="oe-panel" data-panel="submit">
        <h2><?php esc_html_e('Submit a new listing', 'october-events'); ?></h2>
        <form id="oe-submit-form" class="oe-form">
            <label><?php esc_html_e('Listing type', 'october-events'); ?>
                <select name="type" id="oe-submit-type" required></select>
            </label>
            <label><?php esc_html_e('Title / name', 'october-events'); ?>
                <input type="text" name="title" required>
            </label>
            <label><?php esc_html_e('Description', 'october-events'); ?>
                <textarea name="content" rows="5"></textarea>
            </label>
            <div id="oe-type-fields"></div>
            <label><?php esc_html_e('Tier', 'october-events'); ?>
                <select name="tier" id="oe-submit-tier"></select>
            </label>
            <div id="oe-payment" class="oe-payment" hidden>
                <div id="oe-card-element"></div>
                <div id="oe-card-errors" role="alert"></div>
            </div>
            <button type="submit" class="oe-btn oe-btn-primary" id="oe-submit-btn"><?php esc_html_e('Submit', 'october-events'); ?></button>
            <div id="oe-submit-result" class="oe-result"></div>
        </form>
    </section>

    <section class="oe-panel" data-panel="tickets">
        <h2><?php esc_html_e('My Tickets', 'october-events'); ?></h2>
        <div id="oe-tickets"></div>
    </section>

    <section class="oe-panel" data-panel="volunteer">
        <h2><?php esc_html_e('Volunteer', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Your shifts are listed below. You will receive email (and SMS, if you opted in) reminders before each shift.', 'october-events'); ?></p>
        <div id="oe-volunteer-commitments"></div>
        <p><a class="oe-btn" href="<?php echo esc_url(home_url('/volunteer/')); ?>"><?php esc_html_e('Browse volunteer opportunities', 'october-events'); ?></a></p>
    </section>

    <section class="oe-panel" data-panel="invoices">
        <h2><?php esc_html_e('Invoices', 'october-events'); ?></h2>
        <div id="oe-invoices"></div>
    </section>

    <section class="oe-panel" data-panel="settings">
        <h2><?php esc_html_e('Account settings', 'october-events'); ?></h2>
        <form id="oe-account-form" class="oe-form">
            <label><?php esc_html_e('Organisation', 'october-events'); ?><input type="text" name="organisation_name"></label>
            <label><?php esc_html_e('Contact name', 'october-events'); ?><input type="text" name="contact_name"></label>
            <label><?php esc_html_e('Phone', 'october-events'); ?><input type="text" name="phone"></label>
            <label><?php esc_html_e('Billing address', 'october-events'); ?><textarea name="billing_address" rows="3"></textarea></label>
            <button type="submit" class="oe-btn"><?php esc_html_e('Save', 'october-events'); ?></button>
            <div id="oe-account-result" class="oe-result"></div>
        </form>
    </section>
</div>
