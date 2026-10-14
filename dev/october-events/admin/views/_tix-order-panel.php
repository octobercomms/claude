<?php
/**
 * Order control-center slide-in (Tickets, UI-SPEC §3). Loaded over AJAX into the
 * shared right slide-in. Read view + the order actions, each posting to the
 * existing money handlers (resend, refund, cancel, delete); the refund dropdown
 * reuses admin/views/_refund-panel.php. No inline <script> (injected HTML won't
 * run it) — interactions are native <details>, onsubmit confirms and the
 * document-level row-click delegate on the Tickets page.
 *
 * @var object      $order        Orders::get()
 * @var string      $currency
 * @var string      $pid          Stripe payment id ('' for manual/comp)
 * @var array|null  $inv          OrderInvoice::for_payment() (payment-level totals)
 * @var array       $tickets      active tickets in the payment/order
 * @var string      $event_title
 * @var string      $invoice_url
 * @var bool        $is_stripe
 */
defined('ABSPATH') || exit;

$cur_sym  = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$currency] ?? ($currency . ' ');
$oid      = (int) $order->id;
$back     = admin_url('admin.php?page=oe-tickets');
$placed   = $order->created_at ? (strtotime((string) $order->created_at . ' UTC') ?: 0) : 0;
$subtotal = $inv ? (float) $inv['subtotal'] : ((float) $order->total + (float) ($order->discount_amount ?? 0));
$discount = $inv ? (float) $inv['discount'] : (float) ($order->discount_amount ?? 0);
$total    = $inv ? (float) $inv['total'] : (float) $order->total;
$promos   = $inv ? (array) $inv['promos'] : ((string) ($order->promo_code ?? '') !== '' ? [(string) $order->promo_code] : []);
$money    = static fn(float $n): string => $cur_sym . number_format_i18n($n, 2);
$items    = [];
if ($inv && ! empty($inv['lines'])) {
    foreach ($inv['lines'] as $ln) { $items[] = (int) $ln['qty'] . ' × ' . (string) $ln['label']; }
} else {
    foreach ($tickets as $tk) { $items[] = (string) ($tk->ticket_type_label ?: '—'); }
}
$status_pill = ['paid' => 'pos', 'refunded' => 'warn', 'cancelled' => 'neu', 'comp' => 'info'][strtolower((string) $order->status)] ?? 'neu';
?>
<div class="oe-slide-head">
    <div><h2><?php echo esc_html(sprintf(__('Order #%d', 'october-events'), $oid)); ?></h2>
        <p class="oe-tixp-sub"><?php echo esc_html(trim((string) $order->name)) ?: esc_html__('No name', 'october-events'); ?><?php echo $placed ? ' · ' . esc_html(sprintf(__('placed %s', 'october-events'), wp_date('M j, Y', $placed))) : ''; ?></p>
    </div>
    <button type="button" class="oe-slide-x" data-oe-slide-close aria-label="<?php esc_attr_e('Close', 'october-events'); ?>">×</button>
</div>
<div class="oe-slide-body oe-tixp">
    <div class="oe-tixp-actions">
        <?php if ((string) $order->email !== '') : ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="oe_resend_confirmation">
            <input type="hidden" name="id" value="<?php echo (int) $oid; ?>">
            <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
            <?php wp_nonce_field('oe_resend_confirmation'); ?>
            <button type="submit" class="button oe-tixp-act"><?php esc_html_e('Resend all tickets', 'october-events'); ?></button>
        </form>
        <?php endif; ?>
        <?php if ($invoice_url !== '') : ?>
        <a class="button oe-tixp-act" href="<?php echo esc_url($invoice_url); ?>" target="_blank" rel="noopener"><?php esc_html_e('Invoice (PDF)', 'october-events'); ?></a>
        <?php endif; ?>
        <?php if ($pid !== '' && $is_stripe && $tickets) :
            $panel_order_id = $oid; $panel_tickets = $tickets; $panel_label = __('Refund…', 'october-events');
            $panel_summary_class = 'button oe-tixp-act'; $panel_block = true;
            include OE_DIR . 'admin/views/_refund-panel.php';
        endif; ?>
        <details class="oe-tixp-confirm">
            <summary class="button oe-tixp-act"><?php esc_html_e('Cancel order', 'october-events'); ?></summary>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('<?php echo esc_js(__('Cancel this order and void its tickets? The holder is emailed.', 'october-events')); ?>');">
                <input type="hidden" name="action" value="oe_cancel_order">
                <input type="hidden" name="id" value="<?php echo (int) $oid; ?>">
                <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
                <?php wp_nonce_field('oe_cancel_order'); ?>
                <?php if ($pid !== '' && $is_stripe) : ?>
                    <label class="oe-tixp-check"><input type="checkbox" name="refund" value="1"> <?php esc_html_e('Also refund the full amount to the card', 'october-events'); ?></label>
                <?php endif; ?>
                <button type="submit" class="button button-primary"><?php esc_html_e('Cancel this order', 'october-events'); ?></button>
            </form>
        </details>
        <details class="oe-tixp-confirm">
            <summary class="button oe-tixp-act oe-tixp-danger"><?php esc_html_e('Delete', 'october-events'); ?></summary>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return (prompt('<?php echo esc_js(__('Type DELETE to permanently remove this order, its tickets and scans. No refund is issued.', 'october-events')); ?>') === 'DELETE');">
                <input type="hidden" name="action" value="oe_delete_order">
                <input type="hidden" name="id" value="<?php echo (int) $oid; ?>">
                <input type="hidden" name="_wp_http_referer" value="<?php echo esc_attr($back); ?>">
                <?php wp_nonce_field('oe_delete_order'); ?>
                <p class="description" style="margin:6px 0"><?php esc_html_e('For test data. Take money back with Refund or Cancel first.', 'october-events'); ?></p>
                <button type="submit" class="button oe-tixp-danger"><?php esc_html_e('Delete permanently', 'october-events'); ?></button>
            </form>
        </details>
    </div>

    <div class="oe-tixp-label"><?php esc_html_e('Summary', 'october-events'); ?></div>
    <div class="oe-tixp-group">
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Event', 'october-events'); ?></span><span class="oe-tixp-v"><strong><?php echo esc_html($event_title); ?></strong></span></div>
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Items', 'october-events'); ?></span><span class="oe-tixp-v"><?php echo esc_html($items ? implode(', ', $items) : '—'); ?></span></div>
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Subtotal', 'october-events'); ?></span><span class="oe-tixp-v"><?php echo esc_html($money($subtotal)); ?></span></div>
        <?php if ($discount > 0) : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Discount', 'october-events'); ?></span><span class="oe-tixp-v">−<?php echo esc_html($money($discount)); ?></span></div><?php endif; ?>
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Total', 'october-events'); ?></span><span class="oe-tixp-v"><strong><?php echo esc_html($money($total)); ?></strong></span></div>
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Status', 'october-events'); ?></span><span class="oe-tixp-v"><span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($status_pill); ?>"><?php echo esc_html(ucfirst((string) $order->status)); ?></span></span></div>
    </div>

    <?php
    $card = isset($card) && is_array($card) ? $card : [];
    $has_card = ($card['brand'] ?? '') !== '' || ($card['last4'] ?? '') !== '';
    // Method line: "Visa •••• 4242" when we have the card, else the gateway name.
    if ($has_card) {
        $method_label = trim(($card['brand'] ?? '') . ' •••• ' . ($card['last4'] ?? ''));
        if (($card['wallet'] ?? '') !== '') {
            $method_label = ucfirst(str_replace('_', ' ', (string) $card['wallet'])) . ' · ' . $method_label;
        }
    } else {
        $method_label = ucfirst((string) ($order->payment_method ?: '—'));
    }
    $risk = (string) ($card['risk'] ?? '');
    $risk_pill = ['normal' => 'pos', 'elevated' => 'warn', 'highest' => 'warn'][$risk] ?? 'neu';
    ?>
    <div class="oe-tixp-label"><?php esc_html_e('Payment', 'october-events'); ?></div>
    <div class="oe-tixp-group">
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Method', 'october-events'); ?></span><span class="oe-tixp-v"><strong><?php echo esc_html($method_label); ?></strong></span></div>
        <?php if (($card['exp'] ?? '') !== '') : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Expiry', 'october-events'); ?></span><span class="oe-tixp-v"><?php echo esc_html((string) $card['exp']); ?></span></div><?php endif; ?>
        <?php if (($card['name'] ?? '') !== '') : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Name on card', 'october-events'); ?></span><span class="oe-tixp-v"><?php echo esc_html((string) $card['name']); ?></span></div><?php endif; ?>
        <?php if ($pid !== '') : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Stripe', 'october-events'); ?></span><span class="oe-tixp-v" style="word-break:break-all"><?php echo esc_html($pid); ?></span></div><?php endif; ?>
        <?php if (($card['avs'] ?? '') !== '' || ($card['cvc'] ?? '') !== '') : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('AVS / CVC', 'october-events'); ?></span><span class="oe-tixp-v"><?php echo esc_html(trim((string) ($card['avs'] ?: '—')) . ' / ' . trim((string) ($card['cvc'] ?: '—'))); ?></span></div><?php endif; ?>
        <?php if ($risk !== '') : ?><div class="oe-tixp-row"><span class="oe-tixp-k"><?php esc_html_e('Risk', 'october-events'); ?></span><span class="oe-tixp-v"><span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($risk_pill); ?>"><?php echo esc_html(ucfirst($risk)); ?></span></span></div><?php endif; ?>
    </div>

    <?php if ($promos) : ?>
    <div class="oe-tixp-label"><?php esc_html_e('Promo code', 'october-events'); ?></div>
    <div class="oe-tixp-group">
        <div class="oe-tixp-row"><span class="oe-tixp-k"><?php echo esc_html(implode(', ', array_map('strval', $promos))); ?></span><span class="oe-tixp-v">−<?php echo esc_html($money($discount)); ?></span></div>
    </div>
    <?php endif; ?>

    <div class="oe-tixp-label"><?php echo esc_html(sprintf(__('Tickets in this order (%d)', 'october-events'), count($tickets))); ?></div>
    <div class="oe-tixp-group">
        <?php if ($tickets) : foreach ($tickets as $tk) : ?>
            <a href="#" class="oe-tixp-trow" data-oe-detail="attendee" data-id="<?php echo (int) $tk->id; ?>">
                <span><strong><?php echo esc_html((string) ($tk->ticket_type_label ?: '—')); ?></strong><?php echo (string) $tk->attendee_name !== '' ? ' · ' . esc_html((string) $tk->attendee_name) : ''; ?></span>
                <span class="oe-tixp-when"><?php esc_html_e('Open →', 'october-events'); ?></span>
            </a>
        <?php endforeach; else : ?>
            <p class="description" style="margin:0"><?php esc_html_e('No active tickets.', 'october-events'); ?></p>
        <?php endif; ?>
    </div>

    <div class="oe-tixp-label"><?php esc_html_e('History', 'october-events'); ?></div>
    <div class="oe-tixp-timeline">
        <?php if (in_array(strtolower((string) $order->status), ['refunded', 'cancelled'], true)) : ?>
            <div class="oe-tixp-tl"><span class="oe-tixp-dot oe-tixp-dot--warn"></span><span><?php echo esc_html(ucfirst((string) $order->status)); ?></span><span></span></div>
        <?php endif; ?>
        <div class="oe-tixp-tl"><span class="oe-tixp-dot oe-tixp-dot--pos"></span><span><?php esc_html_e('Tickets issued', 'october-events'); ?></span><span class="oe-tixp-when"><?php echo $placed ? esc_html(wp_date('M j', $placed)) : ''; ?></span></div>
        <div class="oe-tixp-tl"><span class="oe-tixp-dot"></span><span><?php esc_html_e('Order placed', 'october-events'); ?></span><span class="oe-tixp-when"><?php echo $placed ? esc_html(wp_date('M j, g:i A', $placed)) : ''; ?></span></div>
    </div>
</div>
