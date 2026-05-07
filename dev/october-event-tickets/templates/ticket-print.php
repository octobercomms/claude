<?php
/**
 * Ticket print template — single ticket.
 *
 * Variables available:
 *   $ticket    object  — row from oct_tickets
 *   $order     object  — row from oct_orders
 *   $event     WP_Post — the event post
 *   $event_meta array  — ticket_types, venues, event_date, event_venue, etc.
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

$qr_data_uri = \OctoberTickets\Lib\QRCodeGenerator::generateDataUri($ticket->token, 250);
$site_name   = get_bloginfo('name');
$logo_url    = '';
$custom_logo_id = get_theme_mod('custom_logo');
if ($custom_logo_id) {
    $logo_src = wp_get_attachment_image_src($custom_logo_id, 'medium');
    if ($logo_src) {
        $logo_url = $logo_src[0];
    }
}

$event_date  = !empty($event_meta['event_date']) ? date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($event_meta['event_date'])) : '';
$event_venue = !empty($event_meta['event_venue']) ? $event_meta['event_venue'] : '';
$currency_symbol = \OctoberTickets\Settings::get_instance()->get_currency_symbol();
?>
<!DOCTYPE html>
<html lang="<?php echo esc_attr(get_locale()); ?>">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html($site_name . ' — ' . $event->post_title . ' — Ticket ' . $ticket->ticket_number . ' of ' . $ticket->total_in_order); ?></title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    background: #f4f4f4;
    color: #222;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 40px 20px;
  }

  .ticket-wrapper {
    width: 100%;
    max-width: 680px;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.18);
  }

  /* ---- Header ---- */
  .ticket-header {
    background: #1a1a1a;
    color: #fff;
    padding: 28px 36px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .ticket-header .site-logo img {
    height: 48px;
    width: auto;
    filter: brightness(0) invert(1);
    object-fit: contain;
  }

  .ticket-header .site-name {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #fff;
  }

  .ticket-header .event-category {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #C8A96E;
    margin-top: 4px;
  }

  .ticket-header .ticket-count-badge {
    background: #C8A96E;
    color: #1a1a1a;
    font-size: 12px;
    font-weight: 700;
    padding: 6px 14px;
    border-radius: 20px;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 1px;
    flex-shrink: 0;
  }

  /* ---- Event Name ---- */
  .ticket-event-name {
    padding: 28px 36px 0;
  }

  .ticket-event-name h1 {
    font-size: 32px;
    font-weight: 900;
    color: #1a1a1a;
    line-height: 1.1;
    letter-spacing: -0.5px;
  }

  /* ---- Body ---- */
  .ticket-body {
    display: flex;
    gap: 32px;
    padding: 24px 36px 28px;
    align-items: flex-start;
  }

  .ticket-details {
    flex: 1 1 auto;
  }

  .ticket-qr {
    flex: 0 0 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .ticket-qr img {
    width: 180px;
    height: 180px;
    border: 4px solid #f0f0f0;
    border-radius: 8px;
  }

  .ticket-qr .qr-label {
    font-size: 10px;
    color: #999;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  /* ---- Details grid ---- */
  .detail-row {
    display: flex;
    flex-direction: column;
    margin-bottom: 16px;
  }

  .detail-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #999;
    margin-bottom: 3px;
  }

  .detail-value {
    font-size: 16px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .detail-value.attendee {
    font-size: 22px;
    font-weight: 800;
  }

  .detail-value.ticket-type {
    color: #C8A96E;
    font-size: 18px;
  }

  /* ---- Tear line ---- */
  .ticket-tear {
    position: relative;
    height: 24px;
    margin: 0;
    display: flex;
    align-items: center;
  }

  .ticket-tear::before {
    content: '';
    position: absolute;
    left: -1px;
    width: 18px;
    height: 18px;
    background: #f4f4f4;
    border-radius: 50%;
    border: 1px solid #e0e0e0;
  }

  .ticket-tear::after {
    content: '';
    position: absolute;
    right: -1px;
    width: 18px;
    height: 18px;
    background: #f4f4f4;
    border-radius: 50%;
    border: 1px solid #e0e0e0;
  }

  .ticket-tear-line {
    width: 100%;
    border: none;
    border-top: 2px dashed #e0e0e0;
    margin: 0 18px;
  }

  /* ---- Footer ---- */
  .ticket-footer {
    background: #fafafa;
    padding: 20px 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-top: 1px solid #f0f0f0;
  }

  .ticket-token {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    color: #bbb;
    word-break: break-all;
    flex: 1;
  }

  .ticket-footer .scan-text {
    font-size: 11px;
    color: #999;
    text-align: right;
    flex-shrink: 0;
  }

  /* ---- Print button (screen only) ---- */
  .print-bar {
    text-align: center;
    padding: 24px;
    background: #fff;
    border-top: 1px solid #eee;
  }

  .print-bar button {
    background: #1a1a1a;
    color: #fff;
    border: none;
    padding: 12px 32px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
    letter-spacing: 0.5px;
  }

  .print-bar button:hover {
    background: #333;
  }

  /* ---- Print media query ---- */
  @media print {
    body {
      background: none;
      padding: 0;
    }
    .ticket-wrapper {
      box-shadow: none;
      border-radius: 0;
      max-width: 100%;
      width: 100%;
    }
    .print-bar {
      display: none;
    }
    @page {
      size: A4 portrait;
      margin: 12mm;
    }
  }
</style>
</head>
<body>

<div class="ticket-wrapper">

  <!-- Header -->
  <div class="ticket-header">
    <div>
      <?php if ($logo_url) : ?>
        <div class="site-logo"><img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr($site_name); ?>"></div>
      <?php else : ?>
        <div class="site-name"><?php echo esc_html($site_name); ?></div>
      <?php endif; ?>
      <div class="event-category"><?php esc_html_e('Event Ticket', 'october-event-tickets'); ?></div>
    </div>
    <div class="ticket-count-badge">
      <?php echo esc_html(sprintf(
        /* translators: %1$d ticket number, %2$d total */
        __('Ticket %1$d of %2$d', 'october-event-tickets'),
        $ticket->ticket_number,
        $ticket->total_in_order
      )); ?>
    </div>
  </div>

  <!-- Event name -->
  <div class="ticket-event-name">
    <h1><?php echo esc_html($event->post_title); ?></h1>
  </div>

  <!-- Body: details + QR -->
  <div class="ticket-body">

    <div class="ticket-details">

      <?php if ($ticket->attendee_name) : ?>
        <div class="detail-row">
          <span class="detail-label"><?php esc_html_e('Attendee', 'october-event-tickets'); ?></span>
          <span class="detail-value attendee"><?php echo esc_html($ticket->attendee_name); ?></span>
        </div>
      <?php endif; ?>

      <div class="detail-row">
        <span class="detail-label"><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></span>
        <span class="detail-value ticket-type"><?php echo esc_html($ticket->ticket_type_label); ?></span>
      </div>

      <?php if ($event_date) : ?>
        <div class="detail-row">
          <span class="detail-label"><?php esc_html_e('Date & Time', 'october-event-tickets'); ?></span>
          <span class="detail-value"><?php echo esc_html($event_date); ?></span>
        </div>
      <?php endif; ?>

      <?php if ($event_venue) : ?>
        <div class="detail-row">
          <span class="detail-label"><?php esc_html_e('Venue', 'october-event-tickets'); ?></span>
          <span class="detail-value"><?php echo esc_html($event_venue); ?></span>
        </div>
      <?php endif; ?>

      <div class="detail-row">
        <span class="detail-label"><?php esc_html_e('Price Paid', 'october-event-tickets'); ?></span>
        <span class="detail-value"><?php echo esc_html($currency_symbol . number_format((float) $order->total / max(1, (int) $order->qty), 2)); ?></span>
      </div>

      <div class="detail-row">
        <span class="detail-label"><?php esc_html_e('Order #', 'october-event-tickets'); ?></span>
        <span class="detail-value" style="font-size:14px;color:#888"><?php echo esc_html((string) $order->id); ?></span>
      </div>

    </div><!-- .ticket-details -->

    <div class="ticket-qr">
      <img src="<?php echo esc_attr($qr_data_uri); ?>" alt="QR Code">
      <div class="qr-label"><?php esc_html_e('Scan for entry', 'october-event-tickets'); ?></div>
    </div>

  </div><!-- .ticket-body -->

  <!-- Tear line -->
  <div class="ticket-tear">
    <hr class="ticket-tear-line">
  </div>

  <!-- Footer -->
  <div class="ticket-footer">
    <div class="ticket-token"><?php echo esc_html($ticket->token); ?></div>
    <div class="scan-text"><?php esc_html_e('Present QR code at the entrance', 'october-event-tickets'); ?></div>
  </div>

  <!-- Print bar (screen only) -->
  <div class="print-bar">
    <button onclick="window.print()"><?php esc_html_e('Print Ticket', 'october-event-tickets'); ?></button>
  </div>

</div><!-- .ticket-wrapper -->

</body>
</html>
