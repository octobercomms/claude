<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Brevo (formerly Sendinblue) transactional email via direct API.
 */
class Brevo {

    private static ?Brevo $instance = null;
    private const API_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function api_key(): string {
        return Settings::get_instance()->get('brevo_api_key');
    }

    private function from_name(): string {
        return Settings::get_instance()->get('from_name', get_bloginfo('name'));
    }

    private function from_email(): string {
        $email = Settings::get_instance()->get('from_email');
        return $email ?: get_option('admin_email', '');
    }

    /**
     * Send order confirmation email with ticket details.
     *
     * @param object   $order
     * @param array    $tickets  Array of ticket rows from DB or creation result.
     * @param \WP_Post $event
     * @param array    $event_meta
     * @return true|\WP_Error
     */
    public function send_order_confirmation(object $order, array $tickets, \WP_Post $event, array $event_meta) {
        $ticket_generator = TicketGenerator::get_instance();

        // Build ticket print URLs and QR codes
        $ticket_print_urls = [];
        $qr_codes          = [];
        foreach ($tickets as $ticket) {
            $token = is_object($ticket) ? $ticket->token : $ticket['token'];
            $ticket_print_urls[$token] = $ticket_generator->get_ticket_print_url($token);
            $qr_codes[$token]          = \OctoberTickets\Lib\QRCodeGenerator::generateDataUri($token, 200);
        }

        // Render HTML email
        ob_start();
        include OCT_TICKETS_DIR . 'templates/email-confirmation.php';
        $html_body = ob_get_clean();

        if ($html_body === false) {
            $html_body = '<p>' . esc_html__('Your tickets are confirmed. Please visit your ticket links.', 'october-event-tickets') . '</p>';
        }

        $subject = sprintf(
            /* translators: %s: event title */
            __('Your tickets for %s', 'october-event-tickets'),
            $event->post_title
        );

        return $this->send(
            sanitize_email($order->email),
            sanitize_text_field($order->name ?: $order->email),
            $subject,
            $html_body
        );
    }

    /**
     * Core send method.
     *
     * @param string $to_email
     * @param string $to_name
     * @param string $subject
     * @param string $html_content
     * @return true|\WP_Error
     */
    public function send(string $to_email, string $to_name, string $subject, string $html_content) {
        if (!$this->api_key()) {
            // Fall back to wp_mail if no Brevo key configured
            $headers = ['Content-Type: text/html; charset=UTF-8'];
            $sent    = wp_mail($to_email, $subject, $html_content, $headers);
            return $sent ? true : new \WP_Error('mail_error', __('wp_mail failed', 'october-event-tickets'));
        }

        $payload = [
            'sender'      => [
                'name'  => $this->from_name(),
                'email' => $this->from_email(),
            ],
            'to'          => [
                [
                    'email' => $to_email,
                    'name'  => $to_name,
                ],
            ],
            'subject'     => $subject,
            'htmlContent' => $html_content,
        ];

        $response = wp_remote_post(self::API_ENDPOINT, [
            'headers' => [
                'api-key'      => $this->api_key(),
                'Content-Type' => 'application/json',
                'Accept'       => 'application/json',
            ],
            'body'    => wp_json_encode($payload),
            'timeout' => 20,
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            $body    = json_decode(wp_remote_retrieve_body($response), true) ?? [];
            $message = $body['message'] ?? __('Brevo API error', 'october-event-tickets');
            return new \WP_Error('brevo_error_' . $code, $message);
        }

        return true;
    }
}
