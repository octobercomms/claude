<?php
/**
 * Printable ticket with a QR for check-in (§2 Tickets).
 *
 * @var int[] $ids  Resolved ticket id(s) from the token lookup.
 */
defined('ABSPATH') || exit;
use ADF\Tickets;

$ticket_id = (int) $ids[0];
$number    = (string) get_post_meta($ticket_id, '_adf_ticket_number', true);
$event     = get_the_title((int) get_post_meta($ticket_id, '_adf_event_id', true));
$name      = (string) get_post_meta($ticket_id, '_adf_purchaser_name', true);
$payload   = Tickets::qr_payload($ticket_id);
$checked   = (bool) get_post_meta($ticket_id, '_adf_checked_in', true);
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo esc_html($number); ?></title>
    <style>
        body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:0;background:#f6f6f4;color:#111}
        .ticket{max-width:420px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08)}
        .ticket header{background:#111;color:#fff;padding:24px}
        .ticket header h1{margin:0;font-size:20px}
        .ticket .body{padding:24px;text-align:center}
        .qr{margin:16px auto;width:220px;height:220px}
        .num{font-family:ui-monospace,Menlo,monospace;letter-spacing:1px}
        .badge{display:inline-block;padding:4px 10px;border-radius:6px;background:#e8f5e9;color:#1a7f37;font-size:13px}
        .badge.in{background:#fdecea;color:#b32d2e}
    </style>
    <!-- QR rendered client-side; bundled locally to avoid external CDN for core (§12). -->
    <script src="<?php echo esc_url(ADF_URL . 'assets/js/qrcode.min.js'); ?>"></script>
</head>
<body>
    <div class="ticket">
        <header><h1><?php echo esc_html($event); ?></h1></header>
        <div class="body">
            <p><strong><?php echo esc_html($name); ?></strong></p>
            <div class="qr" id="qr"></div>
            <p class="num"><?php echo esc_html($number); ?></p>
            <p><span class="badge <?php echo $checked ? 'in' : ''; ?>"><?php echo $checked ? esc_html__('Checked in', 'adf-festival') : esc_html__('Valid', 'adf-festival'); ?></span></p>
        </div>
    </div>
    <script>
        (function () {
            if (window.QRCode) {
                new QRCode(document.getElementById('qr'), {
                    text: <?php echo wp_json_encode($payload); ?>,
                    width: 220, height: 220
                });
            } else {
                document.getElementById('qr').textContent = <?php echo wp_json_encode($number); ?>;
            }
        })();
    </script>
</body>
</html>
<?php exit; ?>
