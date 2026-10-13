<?php
/**
 * Attendee detail slide-in (Tickets, UI-SPEC §3). Loaded over AJAX into the
 * shared right slide-in; read view + quick actions that post to the existing
 * handlers (check-in, undo, transfer, resend). Self-contained header + close.
 *
 * @var object      $t            ticket row (Orders::ticket_get)
 * @var object|null $order        its order (Orders::get)
 * @var string      $currency
 * @var float       $price        per-ticket price
 * @var string      $event_title
 * @var array       $scans        [{venue_name, scanned_at}]
 * @var int         $ticket_id
 */
defined('ABSPATH') || exit;

$cur_sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$currency] ?? ($currency . ' ');
$name    = (string) ($t->attendee_name ?: ($order->name ?? '')) ?: __('Attendee', 'october-events');
$email   = (string) ($t->attendee_email ?: ($order->email ?? ''));
$checked = ! empty($scans);
$oid     = (int) $t->order_id;
$back    = admin_url('admin.php?page=oe-tickets');
$last_venue = $checked ? (string) end($scans)->venue_name : '';
$row = static function (string $label, string $value): void {
    echo '<div class="oe-tixp-row"><span class="oe-tixp-k">' . esc_html($label) . '</span><span class="oe-tixp-v">' . $value . '</span></div>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- value pre-escaped by caller
};
?>
<div class="oe-slide-head">
    <div><h2><?php echo esc_html($name); ?></h2>
        <?php if ($email !== '') : ?><p class="oe-tixp-sub"><?php echo esc_html($email); ?></p><?php endif; ?>
    </div>
    <button type="button" class="oe-slide-x" data-oe-slide-close aria-label="<?php esc_attr_e('Close', 'october-events'); ?>">×</button>
</div>
<div class="oe-slide-body oe-tixp">
    <div class="oe-tixp-group">
        <?php
        $row(__('Event', 'october-events'), '<strong>' . esc_html($event_title) . '</strong>');
        $row(__('Ticket', 'october-events'), '<strong>' . esc_html((string) $t->ticket_type_label ?: '—') . '</strong>');
        $row(__('Price', 'october-events'), $price > 0 ? '<strong>' . esc_html($cur_sym . number_format_i18n($price, 2)) . '</strong>' : '<span class="description">' . esc_html__('Free', 'october-events') . '</span>');
        $row(__('Status', 'october-events'), $checked
            ? '<span class="oe-ad-pill oe-ad-pill--pos">' . esc_html__('Checked in', 'october-events') . '</span>'
            : '<span class="oe-ad-pill oe-ad-pill--neu">' . esc_html__('Not in', 'october-events') . '</span>');
        ?>
    </div>

    <div class="oe-tixp-label"><?php esc_html_e('Order', 'october-events'); ?></div>
    <div class="oe-tixp-group">
        <?php
        $row(__('Order', 'october-events'), '<a href="#" class="oe-tixp-link" data-oe-detail="order" data-id="' . (int) $oid . '">#' . (int) $oid . '</a>');
        if ($order) {
            $paid = ucfirst((string) ($order->payment_method ?: '—'));
            $row(__('Paid', 'october-events'), '<strong>' . esc_html($paid) . '</strong> <span class="description">· ' . esc_html(ucfirst((string) $order->status)) . '</span>');
        }
        ?>
    </div>

    <div class="oe-tixp-label"><?php esc_html_e('Check-in history', 'october-events'); ?></div>
    <div class="oe-tixp-timeline">
        <?php if ($scans) : foreach (array_reverse($scans) as $s) :
            $ts = $s->scanned_at ? (strtotime((string) $s->scanned_at . ' UTC') ?: 0) : 0; ?>
            <div class="oe-tixp-tl"><span class="oe-tixp-dot oe-tixp-dot--pos"></span>
                <span><?php echo esc_html((string) ($s->venue_name ?: __('Scanned', 'october-events'))); ?></span>
                <span class="oe-tixp-when"><?php echo $ts ? esc_html(wp_date('M j, g:i A', $ts)) : ''; ?></span>
            </div>
        <?php endforeach; else : ?>
            <div class="oe-tixp-tl"><span class="oe-tixp-dot"></span><span class="description"><?php esc_html_e('No scans yet', 'october-events'); ?></span><span></span></div>
        <?php endif;
        $issued = $t->created_at ? (strtotime((string) $t->created_at . ' UTC') ?: 0) : 0; ?>
        <div class="oe-tixp-tl"><span class="oe-tixp-dot"></span><span><?php esc_html_e('Ticket issued', 'october-events'); ?></span><span class="oe-tixp-when"><?php echo $issued ? esc_html(wp_date('M j', $issued)) : ''; ?></span></div>
    </div>

    <details class="oe-tixp-xfer" style="margin-top:14px">
        <summary class="button"><?php esc_html_e('Transfer ticket', 'october-events'); ?></summary>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-tixp-form">
            <input type="hidden" name="action" value="oe_transfer_ticket">
            <input type="hidden" name="ticket_id" value="<?php echo (int) $ticket_id; ?>">
            <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
            <?php wp_nonce_field('oe_transfer_ticket'); ?>
            <label><?php esc_html_e('New attendee name', 'october-events'); ?><input type="text" name="attendee_name" value="<?php echo esc_attr((string) $t->attendee_name); ?>" required></label>
            <label><?php esc_html_e('New email', 'october-events'); ?><input type="email" name="attendee_email" placeholder="<?php echo esc_attr($email); ?>" required></label>
            <button type="submit" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Transfer this ticket and email the new attendee? The QR stays the same, so any earlier copy now belongs to the new person.', 'october-events')); ?>');"><?php esc_html_e('Transfer & email', 'october-events'); ?></button>
        </form>
    </details>
</div>
<div class="oe-slide-foot">
    <?php if ($order && (string) $order->email !== '') : ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
        <input type="hidden" name="action" value="oe_resend_confirmation">
        <input type="hidden" name="id" value="<?php echo (int) $oid; ?>">
        <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
        <?php wp_nonce_field('oe_resend_confirmation'); ?>
        <button type="submit" class="button"><?php esc_html_e('Resend', 'october-events'); ?></button>
    </form>
    <?php endif; ?>
    <?php if ($checked) : ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
        <input type="hidden" name="action" value="oe_checkin_undo">
        <input type="hidden" name="ticket_id" value="<?php echo (int) $ticket_id; ?>">
        <input type="hidden" name="event_id" value="<?php echo (int) $t->event_id; ?>">
        <input type="hidden" name="venue" value="<?php echo esc_attr($last_venue); ?>">
        <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
        <?php wp_nonce_field('oe_checkin_undo'); ?>
        <button type="submit" class="button" onclick="return confirm('<?php echo esc_js(__('Reverse this check-in?', 'october-events')); ?>');"><?php esc_html_e('Undo check-in', 'october-events'); ?></button>
    </form>
    <?php else : ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
        <input type="hidden" name="action" value="oe_ticket_checkin">
        <input type="hidden" name="ticket_id" value="<?php echo (int) $ticket_id; ?>">
        <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
        <?php wp_nonce_field('oe_ticket_checkin'); ?>
        <button type="submit" class="button button-primary"><?php esc_html_e('Check in', 'october-events'); ?></button>
    </form>
    <?php endif; ?>
</div>
