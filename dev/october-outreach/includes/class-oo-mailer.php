<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Mailer {

    private $settings;

    public function __construct() {
        $this->settings = get_option( 'oo_settings', array() );
    }

    /**
     * Send an email using the configured provider.
     *
     * @param string $to_email
     * @param string $to_name
     * @param string $from_email
     * @param string $from_name
     * @param string $reply_to
     * @param string $subject
     * @param string $body_html
     * @return array|WP_Error  array('message_id' => '...') on success, WP_Error on failure
     */
    public function send( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html ) {
        $provider = $this->settings['email_provider'] ?? 'smtp';

        switch ( $provider ) {
            case 'mailgun':
                return $this->send_mailgun( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html );
            case 'sendgrid':
                return $this->send_sendgrid( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html );
            case 'ses':
                return $this->send_ses( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html );
            case 'smtp':
            default:
                return $this->send_smtp( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html );
        }
    }

    // -------------------------------------------------------------------------
    // Mailgun
    // -------------------------------------------------------------------------

    private function send_mailgun( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html ) {
        $api_key = $this->settings['mailgun_api_key'] ?? '';
        $domain  = $this->settings['mailgun_domain']  ?? '';
        $region  = $this->settings['mailgun_region']  ?? 'us';

        if ( empty( $api_key ) || empty( $domain ) ) {
            return new WP_Error( 'mailgun_not_configured', 'Mailgun API key or domain not configured.' );
        }

        $base = ( $region === 'eu' ) ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
        $url  = $base . '/v3/' . $domain . '/messages';

        $body = array(
            'from'       => $from_name ? "{$from_name} <{$from_email}>" : $from_email,
            'to'         => $to_name   ? "{$to_name} <{$to_email}>"   : $to_email,
            'h:Reply-To' => $reply_to,
            'subject'    => $subject,
            'html'       => $body_html,
            'text'       => wp_strip_all_tags( $body_html ),
        );

        $response = wp_remote_post( $url, array(
            'timeout' => 30,
            'headers' => array(
                'Authorization' => 'Basic ' . base64_encode( 'api:' . $api_key ),
            ),
            'body' => $body,
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 ) {
            $msg = $data['message'] ?? 'Mailgun error: HTTP ' . $code;
            return new WP_Error( 'mailgun_error', $msg );
        }

        return array( 'message_id' => $data['id'] ?? '' );
    }

    // -------------------------------------------------------------------------
    // SendGrid
    // -------------------------------------------------------------------------

    private function send_sendgrid( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html ) {
        $api_key = $this->settings['sendgrid_api_key'] ?? '';

        if ( empty( $api_key ) ) {
            return new WP_Error( 'sendgrid_not_configured', 'SendGrid API key not configured.' );
        }

        $payload = array(
            'personalizations' => array(
                array(
                    'to' => array(
                        array(
                            'email' => $to_email,
                            'name'  => $to_name,
                        ),
                    ),
                ),
            ),
            'from'     => array(
                'email' => $from_email,
                'name'  => $from_name,
            ),
            'reply_to' => array(
                'email' => $reply_to,
            ),
            'subject' => $subject,
            'content' => array(
                array(
                    'type'  => 'text/html',
                    'value' => $body_html,
                ),
            ),
        );

        $response = wp_remote_post( 'https://api.sendgrid.com/v3/mail/send', array(
            'timeout' => 30,
            'headers' => array(
                'Authorization' => 'Bearer ' . $api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( $payload ),
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );

        if ( $code !== 202 ) {
            $data = json_decode( wp_remote_retrieve_body( $response ), true );
            $msg  = $data['errors'][0]['message'] ?? 'SendGrid error: HTTP ' . $code;
            return new WP_Error( 'sendgrid_error', $msg );
        }

        return array( 'message_id' => '' );
    }

    // -------------------------------------------------------------------------
    // Amazon SES (Signature V4)
    // -------------------------------------------------------------------------

    private function send_ses( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html ) {
        $key    = $this->settings['ses_key']    ?? '';
        $secret = $this->settings['ses_secret'] ?? '';
        $region = $this->settings['ses_region'] ?? 'eu-west-1';

        if ( empty( $key ) || empty( $secret ) ) {
            return new WP_Error( 'ses_not_configured', 'Amazon SES credentials not configured.' );
        }

        $url = "https://email.{$region}.amazonaws.com/v2/email/outbound-emails";

        $from_header = $from_name ? "{$from_name} <{$from_email}>" : $from_email;

        $payload = wp_json_encode( array(
            'Content' => array(
                'Simple' => array(
                    'Subject' => array( 'Data' => $subject ),
                    'Body'    => array(
                        'Html' => array( 'Data' => $body_html ),
                        'Text' => array( 'Data' => wp_strip_all_tags( $body_html ) ),
                    ),
                ),
            ),
            'Destination'      => array( 'ToAddresses' => array( $to_email ) ),
            'FromEmailAddress' => $from_header,
            'ReplyToAddresses' => array( $reply_to ),
        ) );

        $signed_headers = $this->aws_sign( 'POST', $url, $payload, $region, $key, $secret );

        if ( is_wp_error( $signed_headers ) ) {
            return $signed_headers;
        }

        $response = wp_remote_post( $url, array(
            'timeout' => 30,
            'headers' => $signed_headers,
            'body'    => $payload,
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code < 200 || $code >= 300 ) {
            $msg = $data['message'] ?? ( $data['Message'] ?? 'SES error: HTTP ' . $code );
            return new WP_Error( 'ses_error', $msg );
        }

        return array( 'message_id' => $data['MessageId'] ?? '' );
    }

    /**
     * Build AWS Signature V4 headers for a JSON POST request.
     *
     * @param string $method   HTTP method (e.g. 'POST')
     * @param string $url      Full endpoint URL
     * @param string $payload  Raw JSON body
     * @param string $region   AWS region
     * @param string $key      AWS access key ID
     * @param string $secret   AWS secret access key
     * @return array           Headers array ready for wp_remote_post
     */
    private function aws_sign( $method, $url, $payload, $region, $key, $secret ) {
        $service    = 'ses';
        $algorithm  = 'AWS4-HMAC-SHA256';
        $now        = gmdate( 'Ymd\THis\Z' );
        $date_stamp = gmdate( 'Ymd' );

        $parsed      = wp_parse_url( $url );
        $host        = $parsed['host'];
        $canonical_uri = $parsed['path'] ?? '/';

        $payload_hash         = hash( 'sha256', $payload );
        $canonical_headers    = "content-type:application/json\nhost:{$host}\nx-amz-date:{$now}\n";
        $signed_headers_str   = 'content-type;host;x-amz-date';

        $canonical_request = implode( "\n", array(
            $method,
            $canonical_uri,
            '', // query string
            $canonical_headers,
            $signed_headers_str,
            $payload_hash,
        ) );

        $credential_scope = "{$date_stamp}/{$region}/{$service}/aws4_request";
        $string_to_sign   = implode( "\n", array(
            $algorithm,
            $now,
            $credential_scope,
            hash( 'sha256', $canonical_request ),
        ) );

        $signing_key = $this->aws_signing_key( $secret, $date_stamp, $region, $service );
        $signature   = hash_hmac( 'sha256', $string_to_sign, $signing_key );

        $authorization = $algorithm
            . " Credential={$key}/{$credential_scope}"
            . ", SignedHeaders={$signed_headers_str}"
            . ", Signature={$signature}";

        return array(
            'Content-Type'  => 'application/json',
            'X-Amz-Date'    => $now,
            'Authorization' => $authorization,
        );
    }

    /**
     * Derive the AWS Signature V4 signing key via nested HMAC.
     *
     * @param string $secret   AWS secret access key
     * @param string $date     Date string (Ymd)
     * @param string $region   AWS region
     * @param string $service  AWS service name
     * @return string          Binary signing key
     */
    private function aws_signing_key( $secret, $date, $region, $service ) {
        $k_date    = hash_hmac( 'sha256', $date,              'AWS4' . $secret, true );
        $k_region  = hash_hmac( 'sha256', $region,            $k_date,          true );
        $k_service = hash_hmac( 'sha256', $service,           $k_region,        true );
        $k_signing = hash_hmac( 'sha256', 'aws4_request',     $k_service,       true );
        return $k_signing;
    }

    // -------------------------------------------------------------------------
    // SMTP (via WordPress PHPMailer)
    // -------------------------------------------------------------------------

    private function send_smtp( $to_email, $to_name, $from_email, $from_name, $reply_to, $subject, $body_html ) {
        $host     = $this->settings['smtp_host']     ?? '';
        $port     = $this->settings['smtp_port']     ?? 587;
        $username = $this->settings['smtp_username'] ?? '';
        $password = $this->settings['smtp_password'] ?? '';
        $secure   = $this->settings['smtp_secure']   ?? 'tls';

        // Configure PHPMailer via hook; remove immediately after sending
        $configure = function( $phpmailer ) use ( $host, $port, $username, $password, $secure ) {
            $phpmailer->isSMTP();
            $phpmailer->Host       = $host;
            $phpmailer->Port       = intval( $port );
            $phpmailer->SMTPAuth   = ! empty( $username );
            $phpmailer->Username   = $username;
            $phpmailer->Password   = $password;
            $phpmailer->SMTPSecure = $secure;
        };

        add_action( 'phpmailer_init', $configure );

        $headers = array(
            'Content-Type: text/html; charset=UTF-8',
            "From: {$from_name} <{$from_email}>",
        );

        if ( $reply_to ) {
            $headers[] = "Reply-To: {$reply_to}";
        }

        $result = wp_mail( $to_email, $subject, $body_html, $headers );

        remove_action( 'phpmailer_init', $configure );

        if ( ! $result ) {
            return new WP_Error( 'smtp_send_failed', 'wp_mail() returned false — check SMTP settings.' );
        }

        return array( 'message_id' => '' );
    }
}
