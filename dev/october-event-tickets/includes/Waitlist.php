<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Waitlist: sign-up for sold-out tickets, notify on cancellation.
 */
class Waitlist {

    private static ?Waitlist $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('wp_ajax_oct_join_waitlist',        [$this, 'ajax_join_waitlist']);
        add_action('wp_ajax_nopriv_oct_join_waitlist', [$this, 'ajax_join_waitlist']);
    }

    // -------------------------------------------------------------------------
    // AJAX: Join waitlist
    // -------------------------------------------------------------------------

    public function ajax_join_waitlist(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $event_id        = (int) ($_POST['event_id'] ?? 0);
        $ticket_type_key = sanitize_text_field($_POST['ticket_type_key'] ?? '');
        $email           = sanitize_email($_POST['email'] ?? '');
        $name            = sanitize_text_field($_POST['name'] ?? '');

        if (!$event_id || !$ticket_type_key || !$email) {
            wp_send_json_error(['message' => __('Please enter your email address.', 'october-event-tickets')]);
        }

        if (!is_email($email)) {
            wp_send_json_error(['message' => __('Please enter a valid email address.', 'october-event-tickets')]);
        }

        if (DB::is_on_waitlist($event_id, $ticket_type_key, $email)) {
            wp_send_json_error(['message' => __('You are already on the waitlist for this ticket.', 'october-event-tickets')]);
        }

        $added = DB::add_to_waitlist($event_id, $ticket_type_key, $email, $name);
        if (!$added) {
            wp_send_json_error(['message' => __('Could not add you to the waitlist. Please try again.', 'october-event-tickets')]);
        }

        $this->send_waitlist_confirmation($event_id, $ticket_type_key, $email, $name);

        wp_send_json_success(['message' => __('You\'re on the waitlist! We\'ll email you if a ticket becomes available.', 'october-event-tickets')]);
    }

    // -------------------------------------------------------------------------
    // Notify waitlist when a ticket becomes available (call on order cancellation)
    // -------------------------------------------------------------------------

    public function notify_availability(int $event_id, string $ticket_type_key): void {
        $waitlist = DB::get_waitlist($event_id, $ticket_type_key);
        if (empty($waitlist)) {
            return;
        }

        $event     = get_post($event_id);
        $settings  = Settings::get_instance();
        $site_name = get_bloginfo('name');

        // Find the checkout page URL (first page with the shortcode)
        $checkout_url = $this->find_checkout_url($event_id);

        $subject = sprintf(
            __('[%s] A ticket has become available — %s', 'october-event-tickets'),
            $site_name,
            $event ? $event->post_title : "Event #{$event_id}"
        );

        $from_name  = $settings->get('from_name', $site_name);
        $from_email = $settings->get('from_email', get_option('admin_email'));
        $brevo_key  = $settings->get('brevo_api_key');

        foreach ($waitlist as $entry) {
            $html = $this->build_availability_email(
                $entry->name ?: $entry->email,
                $event ? $event->post_title : "Event #{$event_id}",
                $ticket_type_key,
                $checkout_url,
                $site_name,
                Settings::get_instance()->get_currency_symbol()
            );

            if ($brevo_key) {
                Brevo::get_instance()->send_raw(
                    $entry->email,
                    $entry->name ?: $entry->email,
                    $subject,
                    $html,
                    $from_name,
                    $from_email
                );
            } else {
                add_filter('wp_mail_content_type', fn() => 'text/html');
                wp_mail($entry->email, $subject, $html, ["From: {$from_name} <{$from_email}>"]);
                remove_filter('wp_mail_content_type', fn() => 'text/html');
            }
        }

        DB::mark_waitlist_notified($event_id, $ticket_type_key);
    }

    // -------------------------------------------------------------------------
    // Confirmation email to the person who joined the waitlist
    // -------------------------------------------------------------------------

    private function send_waitlist_confirmation(int $event_id, string $ticket_type_key, string $email, string $name): void {
        $event     = get_post($event_id);
        $settings  = Settings::get_instance();
        $site_name = get_bloginfo('name');
        $from_name  = $settings->get('from_name', $site_name);
        $from_email = $settings->get('from_email', get_option('admin_email'));

        $subject = sprintf(
            __('[%s] You\'re on the waitlist — %s', 'october-event-tickets'),
            $site_name,
            $event ? $event->post_title : "Event #{$event_id}"
        );

        $display_name = $name ?: $email;
        $event_title  = $event ? $event->post_title : "Event #{$event_id}";

        $html = <<<HTML
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:560px;">
  <tr><td style="background:#1a1a1a;padding:24px 32px;">
    <p style="margin:0;color:#C8A96E;font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;">Waitlist Confirmation</p>
    <h1 style="margin:4px 0 0;color:#fff;font-size:1.4rem;">{$site_name}</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p>Hi {$display_name},</p>
    <p>You've been added to the waitlist for <strong>{$event_title}</strong>.</p>
    <p>We'll email you immediately if a ticket becomes available. Tickets are offered on a first-come, first-served basis so act quickly when you hear from us.</p>
    <p style="color:#666;font-size:13px;margin-top:24px;">If you didn't request this, you can ignore this email.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#f5f5f5;text-align:center;">
    <p style="margin:0;font-size:0.75rem;color:#999;">Event Tickets by October Communications</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>
HTML;

        $brevo_key = $settings->get('brevo_api_key');
        if ($brevo_key) {
            Brevo::get_instance()->send_raw($email, $display_name, $subject, $html, $from_name, $from_email);
        } else {
            add_filter('wp_mail_content_type', fn() => 'text/html');
            wp_mail($email, $subject, $html, ["From: {$from_name} <{$from_email}>"]);
            remove_filter('wp_mail_content_type', fn() => 'text/html');
        }
    }

    // -------------------------------------------------------------------------
    // Availability notification email
    // -------------------------------------------------------------------------

    private function build_availability_email(
        string $display_name,
        string $event_title,
        string $ticket_type_key,
        string $checkout_url,
        string $site_name,
        string $currency_symbol
    ): string {
        $btn = $checkout_url
            ? '<p style="text-align:center;margin:24px 0;"><a href="' . esc_url($checkout_url) . '" style="background:#C8A96E;color:#1a1a1a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:16px;display:inline-block;">Get Your Ticket Now →</a></p>'
            : '';

        return <<<HTML
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:560px;">
  <tr><td style="background:#1a1a1a;padding:24px 32px;">
    <p style="margin:0;color:#C8A96E;font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;">Waitlist Update</p>
    <h1 style="margin:4px 0 0;color:#fff;font-size:1.4rem;">{$site_name}</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <p>Hi {$display_name},</p>
    <p>Good news — a ticket has become available for <strong>{$event_title}</strong>.</p>
    <p>Tickets are first-come, first-served so don't wait — click below to secure yours now:</p>
    {$btn}
    <p style="color:#666;font-size:13px;">If the ticket sells out before you complete your purchase, you'll remain on the waitlist and we'll notify you again if another becomes available.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#f5f5f5;text-align:center;">
    <p style="margin:0;font-size:0.75rem;color:#999;">Event Tickets by October Communications</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>
HTML;
    }

    // -------------------------------------------------------------------------
    // Helper: find checkout page URL for an event
    // -------------------------------------------------------------------------

    private function find_checkout_url(int $event_id): string {
        global $wpdb;
        // Search for pages containing the shortcode with this event_id
        $pages = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ('page','post') AND (post_content LIKE %s OR post_content LIKE %s) LIMIT 1",
                '%event_checkout event_id="' . $event_id . '"%',
                '%oct_checkout event_id="' . $event_id . '"%'
            )
        );
        if ($pages) {
            return get_permalink((int) $pages[0]->ID) ?: '';
        }
        return '';
    }
}
