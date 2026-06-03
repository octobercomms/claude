<?php
/** Ad booking form shell — hydrated by assets/js/ad-booking.js. @var array $formats */
defined('ABSPATH') || exit;
?>
<form class="adf-form adf-adbook" id="adf-adbook-form">
    <h3><?php esc_html_e('Book an ad', 'adf-festival'); ?></h3>

    <label><?php esc_html_e('Campaign name', 'adf-festival'); ?> *<input type="text" name="campaign_name" required></label>
    <label><?php esc_html_e('Company / advertiser', 'adf-festival'); ?><input type="text" name="company"></label>
    <label><?php esc_html_e('Email', 'adf-festival'); ?> *<input type="email" name="email" required></label>
    <label><?php esc_html_e('Destination URL', 'adf-festival'); ?> *<input type="url" name="destination_url" required placeholder="https://"></label>

    <div class="adf-adbook-dates">
        <label><?php esc_html_e('Start', 'adf-festival'); ?><input type="date" name="start_date"></label>
        <label><?php esc_html_e('End', 'adf-festival'); ?><input type="date" name="end_date"></label>
    </div>

    <fieldset>
        <legend><?php esc_html_e('Ad creatives (at least one)', 'adf-festival'); ?></legend>
        <?php foreach ($formats as $key => $f) : ?>
            <label><?php echo esc_html($f['label'] . ' (' . $f['w'] . '×' . $f['h'] . ')'); ?>
                <input type="file" name="image_<?php echo esc_attr($key); ?>" accept="image/jpeg,image/png,image/gif,image/webp"></label>
        <?php endforeach; ?>
    </fieldset>

    <label><?php esc_html_e('Package', 'adf-festival'); ?> *
        <select name="package_name" id="adf-adbook-package" required></select></label>

    <label><?php esc_html_e('Promo code', 'adf-festival'); ?>
        <span class="adf-co-promo">
            <input type="text" name="promo_code" id="adf-adbook-promo">
            <button type="button" class="adf-btn" id="adf-adbook-promo-apply"><?php esc_html_e('Apply', 'adf-festival'); ?></button>
        </span>
        <span class="adf-result" id="adf-adbook-promo-msg"></span>
    </label>

    <div class="adf-co-summary" id="adf-adbook-summary"></div>

    <div class="adf-payment"><div id="adf-adbook-card"></div><div id="adf-adbook-card-errors"></div></div>
    <button type="submit" class="adf-btn adf-btn-primary" id="adf-adbook-pay"><?php esc_html_e('Pay', 'adf-festival'); ?></button>
    <div class="adf-result" id="adf-adbook-result"></div>

    <div class="adf-co-success" id="adf-adbook-success" hidden>
        <p><?php esc_html_e('Payment received — thank you! Your booking is under review and will go live once approved.', 'adf-festival'); ?></p>
    </div>
</form>
