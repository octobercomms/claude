<?php
/**
 * Email confirmation template.
 *
 * Variables:
 *   $order              object
 *   $tickets            array of objects (DB rows)
 *   $event              WP_Post
 *   $event_meta         array
 *   $ticket_print_urls  array  [token => url]
 *   $qr_codes           array  [token => data-uri]
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

$site_name       = get_bloginfo('name');
$site_url        = home_url();
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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html(sprintf(__('Your tickets for %s', 'october-event-tickets'), $event->post_title)); ?></title>
<style>
  body { margin: 0; padding: 0; background: #f4f4f4; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .email-wrapper { max-width: 620px; margin: 0 auto; }
  .email-header {
    background: #1a1a1a;
    text-align: center;
    padding: 32px 24px;
  }
  .email-header img { height: 50px; filter: brightness(0) invert(1); }
  .email-header .site-name { color: #fff; font-size: 22px; font-weight: 700; }
  .email-body { background: #fff; padding: 40px 32px; }
  .email-body h1 {
    font-size: 28px; font-weight: 900; color: #1a1a1a;
    margin: 0 0 8px;
  }
  .email-body .subtitle { color: #666; font-size: 15px; margin-bottom: 32px; }
  .order-summary {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 20px 24px;
    margin-bottom: 32px;
  }
  .order-summary h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin-bottom: 16px; }
  .summary-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 15px;
  }
  .summary-row.total {
    border-top: 1px solid #ddd;
    padding-top: 10px;
    margin-top: 8px;
    font-weight: 700;
    font-size: 17px;
    color: #1a1a1a;
  }
  .summary-row .label { color: #666; }
  .summary-row .value { color: #1a1a1a; font-weight: 600; }
  .tickets-heading {
    font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: #999;
    margin-bottom: 16px;
  }
  .ticket-preview {
    border: 1px solid #eee;
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .tp-header {
    background: #1a1a1a;
    color: #fff;
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .tp-header .event-name { font-size: 15px; font-weight: 700; }
  .tp-header .badge {
    background: #C8A96E; color: #1a1a1a;
    font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .tp-body {
    padding: 16px 20px;
    display: flex;
    gap: 20px;
    align-items: center;
  }
  .tp-info { flex: 1; }
  .tp-info .attendee { font-size: 18px; font-weight: 800; color: #1a1a1a; margin-bottom: 4px; }
  .tp-info .type { font-size: 14px; color: #C8A96E; font-weight: 600; margin-bottom: 10px; }
  .tp-info .meta { font-size: 12px; color: #999; line-height: 1.6; }
  .tp-qr img { width: 120px; height: 120px; border: 3px solid #f0f0f0; border-radius: 6px; }
  .tp-footer {
    background: #fafafa;
    padding: 12px 20px;
    border-top: 1px solid #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .print-btn {
    display: inline-block;
    background: #1a1a1a;
    color: #fff !important;
    text-decoration: none;
    padding: 10px 22px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  .tp-token { font-family: monospace; font-size: 9px; color: #ccc; word-break: break-all; flex: 1; margin-right: 12px; }
  .event-details {
    background: #f9f9f9;
    border: 1px solid #eee;
    border-radius: 8px;
    padding: 20px 24px;
    margin-top: 32px;
    margin-bottom: 32px;
  }
  .event-details h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin-bottom: 14px; }
  .event-details .ed-row { margin-bottom: 8px; font-size: 14px; color: #444; }
  .event-details .ed-row strong { color: #1a1a1a; }
  .email-footer {
    background: #1a1a1a;
    color: #aaa;
    text-align: center;
    padding: 24px;
    font-size: 12px;
    line-height: 1.6;
  }
  .email-footer a { color: #C8A96E; text-decoration: none; }
</style>
</head>
<body>
<div class="email-wrapper">

  <!-- Header -->
  <div class="email-header">
    <?php if ($logo_url) : ?>
      <img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr($site_name); ?>">
    <?php else : ?>
      <div class="site-name"><?php echo esc_html($site_name); ?></div>
    <?php endif; ?>
  </div>

  <!-- Body -->
  <div class="email-body">
    <h1><?php esc_html_e('Your tickets are confirmed!', 'october-event-tickets'); ?></h1>
    <p class="subtitle">
      <?php echo esc_html(sprintf(
        /* translators: %s: attendee name or email */
        __('Hi %s — here are your tickets. Bring them (printed or on your phone) to the venue.', 'october-event-tickets'),
        $order->name ?: $order->email
      )); ?>
    </p>

    <!-- Order Summary -->
    <div class="order-summary">
      <h2><?php esc_html_e('Order Summary', 'october-event-tickets'); ?></h2>

      <div class="summary-row">
        <span class="label"><?php esc_html_e('Event', 'october-event-tickets'); ?></span>
        <span class="value"><?php echo esc_html($event->post_title); ?></span>
      </div>
      <div class="summary-row">
        <span class="label"><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></span>
        <span class="value"><?php echo esc_html($order->ticket_type_label); ?></span>
      </div>
      <div class="summary-row">
        <span class="label"><?php esc_html_e('Quantity', 'october-event-tickets'); ?></span>
        <span class="value">×<?php echo esc_html((string) $order->qty); ?></span>
      </div>
      <?php if ((float) $order->discount_amount > 0) : ?>
        <div class="summary-row">
          <span class="label"><?php echo esc_html(sprintf(__('Promo Code (%s)', 'october-event-tickets'), $order->promo_code)); ?></span>
          <span class="value" style="color:#2d9e44">−<?php echo esc_html($currency_symbol . number_format((float) $order->discount_amount, 2)); ?></span>
        </div>
      <?php endif; ?>
      <div class="summary-row total">
        <span class="label"><?php esc_html_e('Total Paid', 'october-event-tickets'); ?></span>
        <span class="value"><?php echo esc_html($currency_symbol . number_format((float) $order->total, 2) . ' ' . strtoupper($order->currency)); ?></span>
      </div>

      <div class="summary-row" style="margin-top:12px">
        <span class="label"><?php esc_html_e('Payment Method', 'october-event-tickets'); ?></span>
        <span class="value"><?php echo esc_html(ucfirst($order->payment_method)); ?></span>
      </div>
      <div class="summary-row">
        <span class="label"><?php esc_html_e('Order #', 'october-event-tickets'); ?></span>
        <span class="value"><?php echo esc_html((string) $order->id); ?></span>
      </div>
    </div>

    <!-- Tickets -->
    <div class="tickets-heading"><?php esc_html_e('Your Tickets', 'october-event-tickets'); ?></div>

    <?php foreach ($tickets as $ticket) :
        $token    = is_object($ticket) ? $ticket->token : $ticket['token'];
        $print_url = $ticket_print_urls[$token] ?? home_url('/oct-ticket/' . $token . '/');
        $qr_uri   = $qr_codes[$token] ?? \OctoberTickets\Lib\QRCodeGenerator::generateDataUri($token, 150);
        $t_name   = is_object($ticket) ? $ticket->attendee_name : ($ticket['attendee_name'] ?? '');
        $t_type   = is_object($ticket) ? $ticket->ticket_type_label : ($ticket['ticket_type_label'] ?? '');
        $t_num    = is_object($ticket) ? (int) $ticket->ticket_number : (int) ($ticket['ticket_number'] ?? 1);
        $t_total  = is_object($ticket) ? (int) $ticket->total_in_order : (int) ($ticket['total_in_order'] ?? 1);
    ?>
    <div class="ticket-preview">
      <div class="tp-header">
        <span class="event-name"><?php echo esc_html($event->post_title); ?></span>
        <span class="badge"><?php echo esc_html(sprintf(__('Ticket %1$d of %2$d', 'october-event-tickets'), $t_num, $t_total)); ?></span>
      </div>
      <div class="tp-body">
        <div class="tp-info">
          <?php if ($t_name) : ?>
            <div class="attendee"><?php echo esc_html($t_name); ?></div>
          <?php endif; ?>
          <div class="type"><?php echo esc_html($t_type); ?></div>
          <div class="meta">
            <?php if ($event_date) : ?>
              <?php echo esc_html($event_date); ?><br>
            <?php endif; ?>
            <?php if ($event_venue) : ?>
              <?php echo esc_html($event_venue); ?><br>
            <?php endif; ?>
          </div>
        </div>
        <?php if ($qr_uri) : ?>
          <div class="tp-qr">
            <img src="<?php echo esc_attr($qr_uri); ?>" alt="QR Code">
          </div>
        <?php endif; ?>
      </div>
      <div class="tp-footer">
        <div class="tp-token"><?php echo esc_html($token); ?></div>
        <a href="<?php echo esc_url($print_url); ?>" class="print-btn" target="_blank"><?php esc_html_e('View &amp; Print', 'october-event-tickets'); ?></a>
      </div>
    </div>
    <?php endforeach; ?>

    <!-- Event Details -->
    <?php if ($event_date || $event_venue) : ?>
    <div class="event-details">
      <h2><?php esc_html_e('Event Details', 'october-event-tickets'); ?></h2>
      <?php if ($event_date) : ?>
        <div class="ed-row"><strong><?php esc_html_e('Date:', 'october-event-tickets'); ?></strong> <?php echo esc_html($event_date); ?></div>
      <?php endif; ?>
      <?php if ($event_venue) : ?>
        <div class="ed-row"><strong><?php esc_html_e('Venue:', 'october-event-tickets'); ?></strong> <?php echo esc_html($event_venue); ?></div>
      <?php endif; ?>
    </div>
    <?php endif; ?>

  </div><!-- .email-body -->

  <!-- Footer -->
  <div class="email-footer">
    <p><?php echo esc_html($site_name); ?> &middot; <a href="<?php echo esc_url($site_url); ?>"><?php echo esc_html(str_replace(['http://', 'https://'], '', $site_url)); ?></a></p>
    <p style="margin-top:8px"><?php esc_html_e('Questions? Reply to this email and we\'ll help you out.', 'october-event-tickets'); ?></p>
  </div>

</div><!-- .email-wrapper -->
</body>
</html>
