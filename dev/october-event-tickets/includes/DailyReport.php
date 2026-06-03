<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Daily sales report sent via WP Cron.
 * Only fires if at least one ticket was sold that day.
 * Covers all events with any sales history.
 */
class DailyReport {

    const CRON_HOOK     = 'oct_daily_report_cron';
    const CRON_SCHEDULE = 'daily';

    private static ?DailyReport $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action(self::CRON_HOOK, [$this, 'send_report']);
    }

    // -------------------------------------------------------------------------
    // Scheduling
    // -------------------------------------------------------------------------

    public static function schedule(): void {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            // Schedule daily at 8 PM site time (stored as UTC offset)
            $site_offset  = (float) get_option('gmt_offset', 0);
            $offset_secs  = (int) ($site_offset * HOUR_IN_SECONDS);
            $target_hour  = 20; // 8 PM
            $now_local    = time() + $offset_secs;
            $today_8pm    = mktime($target_hour, 0, 0, (int)date('n', $now_local), (int)date('j', $now_local), (int)date('Y', $now_local)) - $offset_secs;

            // If 8 PM today has already passed, schedule for tomorrow
            if ($today_8pm <= time()) {
                $today_8pm += DAY_IN_SECONDS;
            }

            wp_schedule_event($today_8pm, self::CRON_SCHEDULE, self::CRON_HOOK);
        }
    }

    public static function unschedule(): void {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);
        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    // -------------------------------------------------------------------------
    // Report Generation
    // -------------------------------------------------------------------------

    public function send_report(): void {
        $settings     = Settings::get_instance();
        $report_email = $settings->get('report_email');

        if (!$report_email) {
            return;
        }

        $overall = DB::get_overall_stats();

        // Only send if there was at least one sale today
        if ((int) $overall->tickets_today === 0) {
            return;
        }

        $currency_symbol = $settings->get_currency_symbol();
        $site_name       = get_bloginfo('name');
        $date_label      = date_i18n(get_option('date_format'));
        $per_event_all   = DB::get_event_sales_summary(false);  // all-time per event
        $per_event_today = DB::get_event_sales_summary(true);   // today only

        // Index today's data by event_id for easy lookup
        $today_by_event = [];
        foreach ($per_event_today as $row) {
            $today_by_event[(int) $row->event_id] = $row;
        }

        $subject = sprintf(
            /* translators: 1: site name, 2: date */
            __('[%1$s] Ticket Sales Report — %2$s', 'october-event-tickets'),
            $site_name,
            $date_label
        );

        $html = $this->build_email_html(
            $currency_symbol,
            $site_name,
            $date_label,
            $overall,
            $per_event_all,
            $today_by_event
        );

        $from_name  = $settings->get('from_name', $site_name);
        $from_email = $settings->get('from_email', get_option('admin_email'));

        $brevo_key = $settings->get('brevo_api_key');

        if ($brevo_key) {
            Brevo::get_instance()->send_raw(
                $report_email,
                $report_email,
                $subject,
                $html,
                $from_name,
                $from_email
            );
        } else {
            // Fallback: wp_mail
            add_filter('wp_mail_content_type', fn() => 'text/html');
            wp_mail(
                $report_email,
                $subject,
                $html,
                ["From: {$from_name} <{$from_email}>"]
            );
            remove_filter('wp_mail_content_type', fn() => 'text/html');
        }
    }

    // -------------------------------------------------------------------------
    // Email Builder
    // -------------------------------------------------------------------------

    private function build_email_html(
        string $currency_symbol,
        string $site_name,
        string $date_label,
        object $overall,
        array  $per_event_all,
        array  $today_by_event
    ): string {
        $tickets_today  = (int) $overall->tickets_today;
        $revenue_today  = number_format((float) $overall->revenue_today, 2);
        $tickets_total  = (int) $overall->total_tickets;
        $revenue_total  = number_format((float) $overall->total_revenue, 2);

        $rows_html = '';
        foreach ($per_event_all as $event) {
            $eid          = (int) $event->event_id;
            $today        = $today_by_event[$eid] ?? null;
            $t_today      = $today ? (int) $today->total_tickets : 0;
            $r_today      = $today ? number_format((float) $today->total_revenue, 2) : '0.00';
            $bg_today     = $t_today > 0 ? '#fffbe6' : '#ffffff';

            $rows_html .= sprintf(
                '<tr style="background:%s">
                    <td style="padding:10px 14px;border-bottom:1px solid #eee;">%s</td>
                    <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:center;">
                        <strong>%s</strong>%s
                    </td>
                    <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:center;">
                        <strong>%s%s</strong>%s
                    </td>
                    <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:center;">%s</td>
                    <td style="padding:10px 14px;border-bottom:1px solid #eee;text-align:center;">%s%s</td>
                </tr>',
                esc_attr($bg_today),
                esc_html($event->event_title),
                esc_html((string)(int)$event->total_tickets),
                $t_today > 0 ? ' <span style="color:#666;font-size:0.85em;">(+' . esc_html((string)$t_today) . ' today)</span>' : '',
                esc_html($currency_symbol),
                esc_html(number_format((float)$event->total_revenue, 2)),
                $t_today > 0 ? ' <span style="color:#666;font-size:0.85em;">(+' . esc_html($currency_symbol . $r_today) . ' today)</span>' : '',
                esc_html(date_i18n(get_option('date_format'), strtotime($event->last_sale))),
                esc_html($currency_symbol),
                esc_html(number_format((float)$event->total_revenue / max(1, (int)$event->total_tickets), 2)) . '/ticket avg'
            );
        }

        if (!$rows_html) {
            $rows_html = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#999;">No sales data</td></tr>';
        }

        return <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:620px;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a1a;padding:24px 32px;">
      <p style="margin:0;color:#C8A96E;font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;">Daily Report</p>
      <h1 style="margin:4px 0 0;color:#fff;font-size:1.4rem;">{$site_name}</h1>
      <p style="margin:4px 0 0;color:#888;font-size:0.9rem;">{$date_label}</p>
    </td>
  </tr>

  <!-- Today Summary -->
  <tr>
    <td style="padding:24px 32px;background:#fffbe6;border-bottom:3px solid #C8A96E;">
      <h2 style="margin:0 0 12px;font-size:1rem;color:#666;text-transform:uppercase;letter-spacing:0.05em;">Today's Sales</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="text-align:center;">
            <span style="display:block;font-size:2.2rem;font-weight:700;color:#1a1a1a;">{$tickets_today}</span>
            <span style="font-size:0.8rem;color:#666;">Tickets Sold</span>
          </td>
          <td style="text-align:center;">
            <span style="display:block;font-size:2.2rem;font-weight:700;color:#1a1a1a;">{$currency_symbol}{$revenue_today}</span>
            <span style="font-size:0.8rem;color:#666;">Revenue</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- All-Time Summary -->
  <tr>
    <td style="padding:16px 32px;background:#f9f9f9;border-bottom:1px solid #eee;">
      <p style="margin:0;color:#666;font-size:0.85rem;">
        All-time totals: <strong>{$tickets_total} tickets</strong> · <strong>{$currency_symbol}{$revenue_total} revenue</strong>
      </p>
    </td>
  </tr>

  <!-- Per-Event Table -->
  <tr>
    <td style="padding:24px 32px;">
      <h2 style="margin:0 0 16px;font-size:1rem;">All Events with Sales</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:4px;overflow:hidden;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:10px 14px;text-align:left;font-size:0.8rem;color:#666;">Event</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.8rem;color:#666;">Tickets</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.8rem;color:#666;">Revenue</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.8rem;color:#666;">Last Sale</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.8rem;color:#666;">Avg</th>
          </tr>
        </thead>
        <tbody>
          {$rows_html}
        </tbody>
      </table>
      <p style="margin:12px 0 0;font-size:0.8rem;color:#999;">Rows highlighted in yellow had sales today.</p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:16px 32px;background:#f5f5f5;text-align:center;">
      <p style="margin:0;font-size:0.75rem;color:#999;">
        This report was sent automatically by Event Tickets by October Communications.<br>
        <a href="{$_SERVER['HTTP_HOST']}" style="color:#C8A96E;">Manage tickets in WordPress admin</a>
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
