<?php
/**
 * Front-end "Submit your event" form (logged-in organisers).
 *
 * @var string $action  admin-post.php URL
 * @var string $nonce   pre-rendered nonce field
 * @var string $notice  status flag from the last submit (ok|missing|baddate|error)
 */
defined('ABSPATH') || exit;
?>
<div class="oe-submit">
    <?php if ($notice === 'ok') : ?>
        <div class="oe-submit-note oe-submit-note--ok">
            <strong><?php esc_html_e('Thanks — your event has been submitted.', 'october-events'); ?></strong>
            <p><?php esc_html_e('We review each event before it goes live. You’ll hear from us shortly. You can submit another below.', 'october-events'); ?></p>
        </div>
    <?php elseif ($notice === 'missing') : ?>
        <div class="oe-submit-note oe-submit-note--err"><?php esc_html_e('Please fill in the event name, description and date.', 'october-events'); ?></div>
    <?php elseif ($notice === 'baddate') : ?>
        <div class="oe-submit-note oe-submit-note--err"><?php esc_html_e('That date didn’t look right — please pick a start date and time.', 'october-events'); ?></div>
    <?php elseif ($notice === 'toomany') : ?>
        <div class="oe-submit-note oe-submit-note--err"><?php esc_html_e('You have several events awaiting review already. Please wait for those before submitting more.', 'october-events'); ?></div>
    <?php elseif ($notice === 'error') : ?>
        <div class="oe-submit-note oe-submit-note--err"><?php esc_html_e('Sorry, something went wrong saving your event. Please try again.', 'october-events'); ?></div>
    <?php endif; ?>

    <form class="oe-submit-form" method="post" action="<?php echo $action; // phpcs:ignore WordPress.Security.EscapeOutput -- esc_url()'d in the controller ?>">
        <input type="hidden" name="action" value="oe_submit_event">
        <?php echo $nonce; // phpcs:ignore WordPress.Security.EscapeOutput -- wp_nonce_field() output ?>

        <label class="oe-submit-field">
            <span class="oe-submit-label"><?php esc_html_e('Event name', 'october-events'); ?> <em>*</em></span>
            <input type="text" name="oe_title" required maxlength="160" placeholder="<?php esc_attr_e('e.g. Open Studio: Ceramics at Sylvan Circle', 'october-events'); ?>">
        </label>

        <label class="oe-submit-field">
            <span class="oe-submit-label"><?php esc_html_e('Description', 'october-events'); ?> <em>*</em></span>
            <textarea name="oe_description" rows="6" required placeholder="<?php esc_attr_e('What’s on, who it’s for, and what to expect.', 'october-events'); ?>"></textarea>
        </label>

        <div class="oe-submit-row">
            <label class="oe-submit-field">
                <span class="oe-submit-label"><?php esc_html_e('Starts', 'october-events'); ?> <em>*</em></span>
                <input type="datetime-local" name="oe_start" required>
            </label>
            <label class="oe-submit-field">
                <span class="oe-submit-label"><?php esc_html_e('Location', 'october-events'); ?></span>
                <input type="text" name="oe_location" maxlength="200" placeholder="<?php esc_attr_e('Venue or address', 'october-events'); ?>">
            </label>
        </div>

        <label class="oe-submit-field">
            <span class="oe-submit-label"><?php esc_html_e('Tickets or info link', 'october-events'); ?></span>
            <input type="url" name="oe_url" placeholder="https://…">
            <span class="oe-submit-hint"><?php esc_html_e('Where people go to book or find out more (Eventbrite, your own page, etc.).', 'october-events'); ?></span>
        </label>

        <p class="oe-submit-actions">
            <button type="submit" class="oe-submit-btn"><?php esc_html_e('Submit event for review', 'october-events'); ?></button>
        </p>
        <p class="oe-submit-hint"><?php esc_html_e('We review every event before it’s published. An image can be added during review for now.', 'october-events'); ?></p>
    </form>
</div>
