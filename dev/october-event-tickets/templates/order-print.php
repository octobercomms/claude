<?php
/**
 * Order print template — all tickets for an order on one page.
 *
 * Variables:
 *   $order      object
 *   $tickets    array of DB objects
 *   $event      WP_Post
 *   $event_meta array
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

$site_name       = get_bloginfo('name');
$currency_symbol = \OctoberTickets\Settings::get_instance()->get_currency_symbol();
$logo_url        = '';
$custom_logo_id  = get_theme_mod('custom_logo');
if ($custom_logo_id) {
    $logo_src = wp_get_attachment_image_src($custom_logo_id, 'medium');
    if ($logo_src) {
        $logo_url = $logo_src[0];
    }
}
$event_date  = !empty($event_meta['event_date']) ? date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($event_meta['event_date'])) : '';
$event_venue = !empty($event_meta['event_venue']) ? $event_meta['event_venue'] : '';
?>
<!DOCTYPE html>
<html lang="<?php echo esc_attr(get_locale()); ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html($site_name . ' — ' . $event->post_title . ' — All Tickets'); ?></title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    background: #f4f4f4;
    padding: 40px 20px;
    color: #222;
  }
  .order-page-header {
    text-align: center;
    margin-bottom: 32px;
    background: #fff;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,.08);
    max-width: 680px;
    margin-left: auto;
    margin-right: auto;
  }
  .order-page-header h1 { font-size: 24px; margin-bottom: 8px; }
  .order-page-header p { color: #666; font-size: 14px; }
  .ticket-card {
    max-width: 680px;
    margin: 0 auto 40px;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,.15);
    page-break-inside: avoid;
  }
  .t-header {
    background: #1a1a1a;
    color: #fff;
    padding: 24px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .t-header .site-name { font-size: 20px; font-weight: 700; }
  .t-header .event-cat { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #C8A96E; margin-top: 3px; }
  .t-header .logo img { height: 40px; filter: brightness(0) invert(1); }
  .t-header .badge {
    background: #C8A96E; color: #1a1a1a; font-size: 12px; font-weight: 700;
    padding: 6px 14px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px;
  }
  .t-event-name { padding: 24px 32px 0; }
  .t-event-name h2 { font-size: 28px; font-weight: 900; color: #1a1a1a; line-height: 1.1; }
  .t-body {
    display: flex;
    gap: 28px;
    padding: 20px 32px 24px;
    align-items: flex-start;
  }
  .t-details { flex: 1; }
  .t-qr { flex: 0 0 160px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .t-qr img { width: 160px; height: 160px; border: 4px solid #f0f0f0; border-radius: 6px; }
  .t-qr .ql { font-size: 10px; color: #aaa; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
  .d-row { display: flex; flex-direction: column; margin-bottom: 14px; }
  .d-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #aaa; margin-bottom: 2px; }
  .d-value { font-size: 15px; font-weight: 600; color: #1a1a1a; }
  .d-value.name { font-size: 20px; font-weight: 800; }
  .d-value.type { color: #C8A96E; font-size: 16px; }
  .t-tear { position: relative; height: 20px; display: flex; align-items: center; }
  .t-tear::before, .t-tear::after {
    content: ''; position: absolute;
    width: 16px; height: 16px; background: #f4f4f4;
    border-radius: 50%; border: 1px solid #e0e0e0;
  }
  .t-tear::before { left: -1px; }
  .t-tear::after { right: -1px; }
  .t-tear hr { width: 100%; border: none; border-top: 2px dashed #e0e0e0; margin: 0 16px; }
  .t-footer {
    background: #fafafa;
    padding: 16px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-top: 1px solid #f0f0f0;
  }
  .t-token { font-family: monospace; font-size: 10px; color: #ccc; word-break: break-all; flex: 1; }
  .t-scan-text { font-size: 11px; color: #999; text-align: right; flex-shrink: 0; }
  .print-bar {
    text-align: center;
    padding: 24px;
    max-width: 680px;
    margin: 0 auto 32px;
  }
  .print-bar button {
    background: #1a1a1a; color: #fff; border: none;
    padding: 12px 32px; font-size: 15px; font-weight: 600;
    border-radius: 6px; cursor: pointer;
  }
  @media print {
    body { background: none; padding: 0; }
    .order-page-header, .print-bar { display: none; }
    .ticket-card { box-shadow: none; border-radius: 0; margin: 0 0 0 0; max-width: 100%; }
    @page { size: A4 portrait; margin: 10mm; }
  }
</style>
</head>
<body>

<div class="order-page-header">
  <h1><?php echo esc_html($event->post_title); ?></h1>
  <p><?php echo esc_html(sprintf(
    /* translators: %1$d order ID, %2$s email */
    __('Order #%1$d · %2$s', 'october-event-tickets'),
    $order->id,
    $order->email
  )); ?></p>
</div>

<div class="print-bar">
  <button onclick="window.print()"><?php esc_html_e('Print All Tickets', 'october-event-tickets'); ?></button>
</div>

<?php foreach ($tickets as $ticket) :
    $qr = \OctoberTickets\Lib\QRCodeGenerator::generateDataUri($ticket->token, 200);
?>
<div class="ticket-card">

  <div class="t-header">
    <div>
      <?php if ($logo_url) : ?>
        <div class="logo"><img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr($site_name); ?>"></div>
      <?php else : ?>
        <div class="site-name"><?php echo esc_html($site_name); ?></div>
      <?php endif; ?>
      <div class="event-cat"><?php esc_html_e('Event Ticket', 'october-event-tickets'); ?></div>
    </div>
    <div class="badge"><?php echo esc_html(sprintf(
      __('Ticket %1$d of %2$d', 'october-event-tickets'),
      $ticket->ticket_number,
      $ticket->total_in_order
    )); ?></div>
  </div>

  <div class="t-event-name">
    <h2><?php echo esc_html($event->post_title); ?></h2>
  </div>

  <div class="t-body">
    <div class="t-details">

      <?php if ($ticket->attendee_name) : ?>
        <div class="d-row">
          <span class="d-label"><?php esc_html_e('Attendee', 'october-event-tickets'); ?></span>
          <span class="d-value name"><?php echo esc_html($ticket->attendee_name); ?></span>
        </div>
      <?php endif; ?>

      <div class="d-row">
        <span class="d-label"><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></span>
        <span class="d-value type"><?php echo esc_html($ticket->ticket_type_label); ?></span>
      </div>

      <?php if ($event_date) : ?>
        <div class="d-row">
          <span class="d-label"><?php esc_html_e('Date & Time', 'october-event-tickets'); ?></span>
          <span class="d-value"><?php echo esc_html($event_date); ?></span>
        </div>
      <?php endif; ?>

      <?php if ($event_venue) : ?>
        <div class="d-row">
          <span class="d-label"><?php esc_html_e('Venue', 'october-event-tickets'); ?></span>
          <span class="d-value"><?php echo esc_html($event_venue); ?></span>
        </div>
      <?php endif; ?>

      <div class="d-row">
        <span class="d-label"><?php esc_html_e('Amount Paid', 'october-event-tickets'); ?></span>
        <span class="d-value"><?php echo esc_html($currency_symbol . number_format((float) $order->total, 2) . ' ' . strtoupper($order->currency)); ?></span>
      </div>

    </div>
    <div class="t-qr">
      <img src="<?php echo esc_attr($qr); ?>" alt="<?php esc_attr_e('QR Code', 'october-event-tickets'); ?>">
      <div class="ql"><?php esc_html_e('Scan for entry', 'october-event-tickets'); ?></div>
    </div>
  </div>

  <div class="t-tear"><hr></div>

  <div class="t-footer">
    <div class="t-token"><?php echo esc_html($ticket->token); ?></div>
    <div class="t-scan-text"><?php esc_html_e('Present QR code at entrance', 'october-event-tickets'); ?></div>
  </div>

</div><!-- .ticket-card -->
<?php endforeach; ?>

</body>
</html>
