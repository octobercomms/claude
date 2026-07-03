<?php
/**
 * Printable ticket with a QR for check-in. Print-first design: square corners,
 * near-monochrome (the numbered circle is the only colour — the brand accent),
 * a per-event logo top-left and the QR top-right.
 *
 * @var object $ticket  Row from the oe_tickets table (resolved by token).
 */
defined('ABSPATH') || exit;

use OE\Ticketing\Orders;
use OE\Ticketing\TicketTypes;
use OE\Ticketing\Ics;
use OE\Planning\Events;

$event_id = (int) $ticket->event_id;
$event    = get_the_title($event_id) ?: (string) ($ticket->event_label ?? '');
$logo     = TicketTypes::logo_url($event_id);
$when     = $event_id ? Ics::when_label($event_id) : '';
$type     = (string) $ticket->ticket_type_label;
$name     = (string) $ticket->attendee_name;
$num      = str_pad((string) (int) $ticket->ticket_number, 2, '0', STR_PAD_LEFT);
$of       = (int) ($ticket->total_in_order ?? 1);
$checked  = isset($ticket->id) && (int) $ticket->id > 0 ? Orders::checked_in((int) $ticket->id) : false;

// Description + price, matched from the event's ticket types by label.
$order    = (! empty($ticket->order_id)) ? Orders::get((int) $ticket->order_id) : null;
$currency = strtoupper((string) ($order->currency ?? \OE\Settings::get('currency', 'usd')));
$desc = ''; $price = null;
if ($event_id) {
    foreach (TicketTypes::types($event_id) as $t) {
        if ((string) ($t['label'] ?? '') === $type) {
            $desc  = (string) ($t['description'] ?? '');
            $price = TicketTypes::effective_price($t);
            break;
        }
    }
}
$sym       = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');
$price_str = $price === null ? '' : $sym . number_format((float) $price, 2) . ' ' . $currency;

// Accent for the number badge — the single touch of colour (configurable).
$accent    = (string) \OE\Settings::get('theme_accent', '') ?: '#1a1a1a';
$accent_on = (string) \OE\Settings::get('theme_accent_on', '') ?: '#ffffff';
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo esc_html($event); ?></title>
    <style>
        *{box-sizing:border-box}
        body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;margin:0;background:#eceae6;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .wrap{max-width:460px;margin:32px auto;padding:0 16px}
        .topbar{background:#111;color:#fff;text-align:center;font-weight:700;font-size:14px;padding:13px 16px}
        .card{border:2px solid #111;border-top:0;background:#fff;padding:26px}
        .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;min-height:120px}
        .logo img{max-width:230px;max-height:118px;display:block}
        .logo .brand{font-weight:800;font-size:20px;line-height:1.1}
        .qr{flex:0 0 auto}
        .qr #qr{width:120px;height:120px}
        .qr #qr img,.qr #qr canvas{width:120px !important;height:120px !important;display:block}
        .rule{border:0;border-top:3px solid #111;margin:20px 0}
        h1.ev{font-size:22px;font-weight:800;line-height:1.18;margin:0 0 6px}
        .date{font-size:14px;color:#222;margin:0 0 22px}
        .type{font-size:20px;font-weight:800;margin:0 0 4px}
        .desc{font-size:14px;color:#333;margin:0;line-height:1.5}
        .foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px;gap:12px}
        .who .k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin:0}
        .who .v{font-size:15px;font-weight:700}
        .status{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#1a7f37}
        .status.in{color:#b23218}
        .num{flex:0 0 auto;width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:600}
        .printbtn{text-align:center;margin-top:16px}
        .printbtn button{font:inherit;border:2px solid #111;background:#fff;padding:9px 20px;cursor:pointer;font-weight:600}
        @media print{.noprint{display:none}body{background:#fff}.wrap{margin:0 auto}}
    </style>
    <script src="<?php echo esc_url(OE_URL . 'assets/js/qrcode.min.js'); ?>"></script>
</head>
<body>
    <div class="wrap">
        <div class="topbar"><?php esc_html_e('Print and bring this ticket with you to the event', 'october-events'); ?></div>
        <div class="card">
            <div class="head">
                <div class="logo">
                    <?php if ($logo) : ?>
                        <img src="<?php echo esc_url($logo); ?>" alt="<?php echo esc_attr($event); ?>">
                    <?php else : ?>
                        <div class="brand"><?php echo esc_html((string) \OE\Settings::get('brand_name', get_bloginfo('name'))); ?></div>
                    <?php endif; ?>
                </div>
                <div class="qr"><div id="qr"></div></div>
            </div>
            <hr class="rule">
            <h1 class="ev"><?php echo esc_html($event); ?></h1>
            <?php if ($when) : ?><p class="date"><?php echo esc_html($when); ?></p><?php endif; ?>
            <p class="type"><?php echo esc_html($type); ?></p>
            <p class="desc">
                <?php if ($desc) : ?><?php echo nl2br(esc_html($desc)); ?><br><?php endif; ?>
                <?php if ($price_str) : ?><?php echo esc_html($price_str); ?><?php endif; ?>
                <?php if ($of > 1) : ?><br><?php echo esc_html(sprintf(__('Ticket %1$s of %2$d', 'october-events'), (string) (int) $ticket->ticket_number, $of)); ?><?php endif; ?>
            </p>
            <div class="foot">
                <div class="who">
                    <?php if ($name) : ?>
                        <p class="k"><?php esc_html_e('Attendee', 'october-events'); ?></p>
                        <div class="v"><?php echo esc_html($name); ?></div>
                    <?php endif; ?>
                    <div class="status <?php echo $checked ? 'in' : ''; ?>"><?php echo $checked ? esc_html__('Checked in', 'october-events') : esc_html__('Valid ticket', 'october-events'); ?></div>
                </div>
                <div class="num" style="background:<?php echo esc_attr($accent); ?>;color:<?php echo esc_attr($accent_on); ?>"><?php echo esc_html($num); ?></div>
            </div>
        </div>
        <div class="printbtn noprint"><button type="button" onclick="window.print()"><?php esc_html_e('Print ticket', 'october-events'); ?></button></div>
    </div>
    <script>
        (function () {
            var token = <?php echo wp_json_encode($ticket->token); ?>;
            if (window.QRCode) {
                new QRCode(document.getElementById('qr'), { text: token, width: 120, height: 120 });
            } else {
                document.getElementById('qr').textContent = token;
            }
        })();
    </script>
</body>
</html>
<?php exit; ?>
