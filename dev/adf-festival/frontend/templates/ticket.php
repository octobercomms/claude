<?php
/**
 * Printable ticket with a QR for check-in.
 *
 * @var object $ticket  Row from the adf_tickets table (resolved by token).
 */
defined('ABSPATH') || exit;
use ADF\Ticketing\Orders;

$number  = (string) $ticket->ticket_number . ' / ' . (string) $ticket->total_in_order;
$event   = get_the_title((int) $ticket->event_id);
$name    = (string) $ticket->attendee_name;
$type    = (string) $ticket->ticket_type_label;
$payload = Orders::ticket_url($ticket->token);
$checked = Orders::checked_in((int) $ticket->id);
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo esc_html($event); ?></title>
    <style>
        body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:0;background:#ece8df;color:#14110e}
        .ticket{max-width:420px;margin:40px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)}
        .ticket header{background:#14110e;color:#fff;padding:24px}
        .ticket header h1{margin:0;font-size:20px;font-weight:800}
        .ticket .body{padding:24px;text-align:center}
        .qr{margin:16px auto;width:220px;height:220px}
        .meta{color:#6f6a60;font-size:14px}
        .badge{display:inline-block;padding:4px 12px;border-radius:999px;background:#e3f5e9;color:#1a7f37;font-size:13px;font-weight:600}
        .badge.in{background:#fde7e3;color:#b23218}
        @media print{.noprint{display:none}}
    </style>
    <script src="<?php echo esc_url(ADF_URL . 'assets/js/qrcode.min.js'); ?>"></script>
</head>
<body>
    <div class="ticket">
        <header><h1><?php echo esc_html($event); ?></h1></header>
        <div class="body">
            <p><strong><?php echo esc_html($name ?: $type); ?></strong><br>
               <span class="meta"><?php echo esc_html($type); ?> · <?php echo esc_html($number); ?></span></p>
            <div class="qr" id="qr"></div>
            <p><span class="badge <?php echo $checked ? 'in' : ''; ?>"><?php echo $checked ? esc_html__('Checked in', 'adf-festival') : esc_html__('Valid', 'adf-festival'); ?></span></p>
            <p class="noprint"><button onclick="window.print()">Print</button></p>
        </div>
    </div>
    <script>
        (function () {
            if (window.QRCode) {
                new QRCode(document.getElementById('qr'), { text: <?php echo wp_json_encode($ticket->token); ?>, width: 220, height: 220 });
            } else {
                document.getElementById('qr').textContent = <?php echo wp_json_encode($ticket->token); ?>;
            }
        })();
    </script>
</body>
</html>
<?php exit; ?>
