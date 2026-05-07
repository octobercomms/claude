<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Sends a reminder email 3 days before each event to all active ticket holders.
 * Runs once per day via WP Cron.
 */
class EventReminder {

    const CRON_HOOK     = 'oct_event_reminder_cron';
    const CRON_SCHEDULE = 'daily';

    private static ?EventReminder $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action(self::CRON_HOOK, [$this, 'send_reminders']);
    }

    // -------------------------------------------------------------------------
    // Scheduling
    // -------------------------------------------------------------------------

    public static function schedule(): void {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            // Run at 10 AM site time
            $site_offset = (float) get_option('gmt_offset', 0);
            $offset_secs = (int) ($site_offset * HOUR_IN_SECONDS);
            $target_hour = 10;
            $now_local   = time() + $offset_secs;
            $today_10am  = mktime($target_hour, 0, 0, (int)date('n', $now_local), (int)date('j', $now_local), (int)date('Y', $now_local)) - $offset_secs;
            if ($today_10am <= time()) {
                $today_10am += DAY_IN_SECONDS;
            }
            wp_schedule_event($today_10am, self::CRON_SCHEDULE, self::CRON_HOOK);
        }
    }

    public static function unschedule(): void {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);
        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    // -------------------------------------------------------------------------
    // Main runner
    // -------------------------------------------------------------------------

    public function send_reminders(): void {
        // Target date: 3 days from now (in site timezone)
        $target_date = date('Y-m-d', strtotime('+3 days', (int) current_time('timestamp')));

        // Find events with _oct_event_date matching target date
        global $wpdb;
        $event_ids = $wpdb->get_col(
            $wpdb->prepare(
                "SELECT DISTINCT p.ID
                 FROM {$wpdb->posts} p
                 JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID AND pm.meta_key = '_oct_event_date'
                 WHERE p.post_type = 'events'
                   AND p.post_status = 'publish'
                   AND pm.meta_value LIKE %s",
                $target_date . '%'
            )
        );

        if (empty($event_ids)) {
            return;
        }

        foreach ($event_ids as $event_id) {
            $this->send_reminder_for_event((int) $event_id);
        }
    }

    private function send_reminder_for_event(int $event_id): void {
        $event = get_post($event_id);
        if (!$event) return;

        // Get all paid orders for this event
        $orders = DB::get_orders([
            'event_id' => $event_id,
            'status'   => 'paid',
            'limit'    => 2000,
            'offset'   => 0,
        ]);

        if (empty($orders)) return;

        $event_meta     = TicketGenerator::get_instance()->get_event_meta($event_id);
        $settings       = Settings::get_instance();
        $site_name      = get_bloginfo('name');
        $currency_symbol = $settings->get_currency_symbol();

        // Deduplicate by email
        $sent = [];
        foreach ($orders as $order) {
            $email = $order->email;
            if (isset($sent[$email])) continue;
            $sent[$email] = true;

            $tickets = DB::get_tickets_by_order((int) $order->id);
            $active_tickets = array_filter($tickets, fn($t) => $t->status === 'active');
            if (empty($active_tickets)) continue;

            $subject = sprintf(
                /* translators: %s: event title */
                __('Reminder: %s is in 3 days!', 'october-event-tickets'),
                $event->post_title
            );

            $html = $this->build_reminder_html($order, array_values($active_tickets), $event, $event_meta, $site_name);

            Brevo::get_instance()->send(
                sanitize_email($email),
                sanitize_text_field($order->name ?: $email),
                $subject,
                $html
            );
        }
    }

    private function build_reminder_html(
        object $order,
        array  $tickets,
        \WP_Post $event,
        array  $event_meta,
        string $site_name
    ): string {
        $ticket_generator = TicketGenerator::get_instance();
        $event_title  = esc_html($event->post_title);
        $raw_date     = $event_meta['event_date'] ?? '';
        $event_date   = $raw_date ? esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($raw_date))) : '';
        $event_venue  = esc_html($event_meta['event_venue'] ?? '');
        $buyer_name   = esc_html($order->name ?: $order->email);
        $qty          = count($tickets);
        $qty_label    = $qty === 1 ? '' : 's';

        // Build ticket links
        $ticket_links_html = '';
        foreach ($tickets as $i => $ticket) {
            $url = $ticket_generator->get_ticket_print_url($ticket->token);
            $ticket_name = $ticket->attendee_name ? esc_html($ticket->attendee_name) : esc_html__('Ticket', 'october-event-tickets') . ' ' . ($i + 1);
            $ticket_links_html .= sprintf(
                '<div style="margin:8px 0;"><a href="%s" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">%s &rarr;</a></div>',
                esc_url($url),
                $ticket_name
            );
        }

        return <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px;">

  <tr>
    <td style="background:#1a1a1a;padding:24px 32px;">
      <p style="margin:0;color:#C8A96E;font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;">Event Reminder</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:1.4rem;">{$event_title}</h1>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 32px;">
      <p style="margin:0 0 16px;">Hi {$buyer_name},</p>
      <p style="margin:0 0 20px;">Just a reminder that <strong>{$event_title}</strong> is coming up in <strong>3 days</strong>!</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <tr>
          <td>
            <p style="margin:0;font-size:0.85rem;color:#666;">{$event_date}</p>
            <p style="margin:4px 0 0;font-size:0.9rem;color:#1a1a1a;">{$event_venue}</p>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 12px;font-weight:600;">Your ticket{$qty_label}:</p>
      {$ticket_links_html}

      <p style="margin:20px 0 0;font-size:0.85rem;color:#666;">Please have your QR code(s) ready at the door. We look forward to seeing you!</p>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 32px;background:#f5f5f5;text-align:center;">
      <p style="margin:0;font-size:0.75rem;color:#999;">
        This reminder was sent automatically by {$site_name}.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>
HTML;
    }
}
