<?php
/**
 * Account dashboard shell (§2). Hydrated by assets/js/dashboard.js.
 *
 * @var int $account_id
 */
defined('ABSPATH') || exit;
?>
<div class="adf-dashboard" id="adf-dashboard">
    <nav class="adf-tabs" role="tablist">
        <button class="adf-tab is-active" data-tab="overview"><?php esc_html_e('Overview', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="listings"><?php esc_html_e('My Listings', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="submit"><?php esc_html_e('Submit New', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="tickets"><?php esc_html_e('Tickets', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="volunteer"><?php esc_html_e('Volunteer', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="invoices"><?php esc_html_e('Invoices', 'adf-festival'); ?></button>
        <button class="adf-tab" data-tab="settings"><?php esc_html_e('Account', 'adf-festival'); ?></button>
    </nav>

    <section class="adf-panel is-active" data-panel="overview">
        <h2><?php esc_html_e('Overview', 'adf-festival'); ?></h2>
        <div class="adf-cards" id="adf-overview-cards"><p class="adf-loading"><?php esc_html_e('Loading…', 'adf-festival'); ?></p></div>
    </section>

    <section class="adf-panel" data-panel="listings">
        <h2><?php esc_html_e('My Listings', 'adf-festival'); ?></h2>
        <div class="adf-subtabs" id="adf-listing-filter"></div>
        <div id="adf-listings"></div>
    </section>

    <section class="adf-panel" data-panel="submit">
        <h2><?php esc_html_e('Submit a new listing', 'adf-festival'); ?></h2>
        <form id="adf-submit-form" class="adf-form">
            <label><?php esc_html_e('Listing type', 'adf-festival'); ?>
                <select name="type" id="adf-submit-type" required></select>
            </label>
            <label><?php esc_html_e('Title / name', 'adf-festival'); ?>
                <input type="text" name="title" required>
            </label>
            <label><?php esc_html_e('Description', 'adf-festival'); ?>
                <textarea name="content" rows="5"></textarea>
            </label>
            <div id="adf-type-fields"></div>
            <label><?php esc_html_e('Tier', 'adf-festival'); ?>
                <select name="tier" id="adf-submit-tier"></select>
            </label>
            <div id="adf-payment" class="adf-payment" hidden>
                <div id="adf-card-element"></div>
                <div id="adf-card-errors" role="alert"></div>
            </div>
            <button type="submit" class="adf-btn adf-btn-primary" id="adf-submit-btn"><?php esc_html_e('Submit', 'adf-festival'); ?></button>
            <div id="adf-submit-result" class="adf-result"></div>
        </form>
    </section>

    <section class="adf-panel" data-panel="tickets">
        <h2><?php esc_html_e('My Tickets', 'adf-festival'); ?></h2>
        <div id="adf-tickets"></div>
    </section>

    <section class="adf-panel" data-panel="volunteer">
        <h2><?php esc_html_e('Volunteer', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Your shifts are listed below. You will receive email (and SMS, if you opted in) reminders before each shift.', 'adf-festival'); ?></p>
        <div id="adf-volunteer-commitments"></div>
        <p><a class="adf-btn" href="<?php echo esc_url(home_url('/volunteer/')); ?>"><?php esc_html_e('Browse volunteer opportunities', 'adf-festival'); ?></a></p>
    </section>

    <section class="adf-panel" data-panel="invoices">
        <h2><?php esc_html_e('Invoices', 'adf-festival'); ?></h2>
        <div id="adf-invoices"></div>
    </section>

    <section class="adf-panel" data-panel="settings">
        <h2><?php esc_html_e('Account settings', 'adf-festival'); ?></h2>
        <form id="adf-account-form" class="adf-form">
            <label><?php esc_html_e('Organisation', 'adf-festival'); ?><input type="text" name="organisation_name"></label>
            <label><?php esc_html_e('Contact name', 'adf-festival'); ?><input type="text" name="contact_name"></label>
            <label><?php esc_html_e('Phone', 'adf-festival'); ?><input type="text" name="phone"></label>
            <label><?php esc_html_e('Billing address', 'adf-festival'); ?><textarea name="billing_address" rows="3"></textarea></label>
            <button type="submit" class="adf-btn"><?php esc_html_e('Save', 'adf-festival'); ?></button>
            <div id="adf-account-result" class="adf-result"></div>
        </form>
    </section>
</div>
