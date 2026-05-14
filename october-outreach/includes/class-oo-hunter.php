<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Hunter {

    private $api_key;
    private $base_url = 'https://api.hunter.io/v2';

    public function __construct() {
        $settings = get_option( 'oo_settings', array() );
        $this->api_key = $settings['hunter_api_key'] ?? '';
    }

    public function is_configured() {
        return ! empty( $this->api_key );
    }

    private function get( $endpoint, $params = array() ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'no_api_key', 'Hunter.io API key not configured.' );
        }

        $params['api_key'] = $this->api_key;
        $url = $this->base_url . $endpoint . '?' . http_build_query( $params );

        $response = wp_remote_get( $url, array( 'timeout' => 30 ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 ) {
            $msg = $data['errors'][0]['details'] ?? $data['error'] ?? 'Unknown Hunter.io error';
            return new WP_Error( 'hunter_error', $msg );
        }

        return $data['data'] ?? $data;
    }

    /**
     * Search for all emails at a domain.
     * Returns array of contact data.
     */
    public function domain_search( $domain, $limit = 10 ) {
        $result = $this->get( '/domain-search', array(
            'domain' => $domain,
            'limit'  => $limit,
        ) );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        $contacts = array();
        $emails = $result['emails'] ?? array();

        foreach ( $emails as $email ) {
            if ( empty( $email['value'] ) ) continue;

            $contacts[] = array(
                'email'        => sanitize_email( $email['value'] ),
                'first_name'   => sanitize_text_field( $email['first_name'] ?? '' ),
                'last_name'    => sanitize_text_field( $email['last_name'] ?? '' ),
                'company'      => sanitize_text_field( $result['organization'] ?? '' ),
                'linkedin_url' => esc_url_raw( $email['linkedin'] ?? '' ),
                'source'       => 'hunter.io',
                'confidence'   => intval( $email['confidence'] ?? 0 ),
                'position'     => sanitize_text_field( $email['position'] ?? '' ),
            );
        }

        return array(
            'domain'      => $domain,
            'company'     => $result['organization'] ?? '',
            'contacts'    => $contacts,
            'total_found' => $result['meta']['total'] ?? count( $contacts ),
        );
    }

    /**
     * Search multiple domains and return merged results.
     */
    public function search_domains( $domains, $limit_per_domain = 10 ) {
        $all_contacts = array();
        $errors = array();

        foreach ( $domains as $domain ) {
            $domain = trim( $domain );
            if ( empty( $domain ) ) continue;

            $result = $this->domain_search( $domain, $limit_per_domain );

            if ( is_wp_error( $result ) ) {
                $errors[ $domain ] = $result->get_error_message();
                continue;
            }

            foreach ( $result['contacts'] as $contact ) {
                $contact['domain'] = $domain;
                $all_contacts[] = $contact;
            }
        }

        return array(
            'contacts' => $all_contacts,
            'total'    => count( $all_contacts ),
            'errors'   => $errors,
        );
    }

    /**
     * Find a specific person's email by name and domain.
     */
    public function find_email( $first_name, $last_name, $domain ) {
        return $this->get( '/email-finder', array(
            'first_name' => $first_name,
            'last_name'  => $last_name,
            'domain'     => $domain,
        ) );
    }

    /**
     * Verify an email address.
     */
    public function verify_email( $email ) {
        $result = $this->get( '/email-verifier', array( 'email' => $email ) );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        return array(
            'email'       => $email,
            'status'      => $result['status'] ?? 'unknown',
            'score'       => $result['score'] ?? 0,
            'deliverable' => in_array( $result['status'] ?? '', array( 'valid', 'accept_all' ) ),
        );
    }

    /**
     * Save Hunter.io contacts to the WP database.
     * Returns counts of inserted, skipped (duplicate), and failed,
     * plus contact_ids — an array of IDs for every contact processed
     * (either the newly inserted ID or the existing row's ID).
     */
    public function save_contacts( $contacts, $contact_type = '' ) {
        global $wpdb;
        $table = $wpdb->prefix . 'oo_contacts';

        $inserted    = 0;
        $skipped     = 0;
        $failed      = 0;
        $contact_ids = array();

        foreach ( $contacts as $c ) {
            if ( empty( $c['email'] ) ) {
                $failed++;
                continue;
            }

            $existing_id = $wpdb->get_var( $wpdb->prepare(
                "SELECT id FROM $table WHERE email = %s",
                $c['email']
            ) );

            if ( $existing_id ) {
                $skipped++;
                $contact_ids[] = intval( $existing_id );
                continue;
            }

            $notes = '';
            if ( ! empty( $c['title'] ) )    $notes = 'Title: ' . $c['title'];
            elseif ( ! empty( $c['position'] ) ) $notes = 'Position: ' . $c['position'];

            $result = $wpdb->insert( $table, array(
                'email'        => $c['email'],
                'first_name'   => $c['first_name'] ?? '',
                'last_name'    => $c['last_name'] ?? '',
                'company'      => $c['company'] ?? '',
                'type'         => $contact_type ?: 'other',
                'location'     => $c['location'] ?? '',
                'linkedin_url' => $c['linkedin_url'] ?? '',
                'source'       => $c['source'] ?? 'hunter.io',
                'status'       => 'active',
                'notes'        => $notes,
            ) );

            if ( $result ) {
                $inserted++;
                $contact_ids[] = intval( $wpdb->insert_id );
            } else {
                $failed++;
            }
        }

        return array(
            'inserted'    => $inserted,
            'skipped'     => $skipped,
            'failed'      => $failed,
            'contact_ids' => $contact_ids,
        );
    }

    /**
     * Get account info including remaining credits.
     */
    public function account_info() {
        return $this->get( '/account' );
    }
}
