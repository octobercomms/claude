<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Icypeas {

    private $api_key;
    private $base_url = 'https://app.icypeas.com/api';

    public function __construct() {
        $settings      = get_option( 'oo_settings', array() );
        $this->api_key = $settings['icypeas_api_key'] ?? '';
    }

    public function is_configured() {
        return ! empty( $this->api_key );
    }

    private function request( $endpoint, $body ) {
        $response = wp_remote_post( $this->base_url . $endpoint, array(
            'timeout' => 30,
            'headers' => array(
                'Content-Type'  => 'application/json',
                'Authorization' => 'Bearer ' . $this->api_key,
            ),
            'body' => wp_json_encode( $body ),
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code === 401 ) {
            return new WP_Error( 'icypeas_auth', 'Icypeas API key is invalid.' );
        }
        if ( $code === 429 ) {
            return new WP_Error( 'icypeas_rate_limit', 'Icypeas rate limit exceeded. Try again shortly.' );
        }
        if ( $code !== 200 ) {
            $msg = $data['message'] ?? ( 'Icypeas error (HTTP ' . $code . ')' );
            return new WP_Error( 'icypeas_error', $msg );
        }
        // Treat explicit success:false as an error, but don't require the field to be present.
        if ( isset( $data['success'] ) && $data['success'] === false ) {
            $msg = $data['message'] ?? 'Icypeas returned an error response.';
            return new WP_Error( 'icypeas_error', $msg );
        }

        return $data;
    }

    /**
     * Search a list of domains for people matching the given job titles.
     * Returns same structure as OO_Hunter::search_domains().
     */
    public function search_domains( $domains, $job_titles = array(), $limit = 25 ) {
        $all_contacts = array();
        $errors       = array();

        foreach ( $domains as $domain ) {
            $domain = strtolower( trim( $domain ) );
            if ( ! $domain ) continue;

            $query = array(
                'currentCompanyWebsite' => array( 'include' => array( $domain ) ),
            );
            if ( ! empty( $job_titles ) ) {
                $query['currentJobTitle'] = array( 'include' => array_values( $job_titles ) );
            }

            $result = $this->request( '/find-people', array(
                'query'      => $query,
                'pagination' => array( 'size' => $limit ),
            ) );

            if ( is_wp_error( $result ) ) {
                // find-people failed; try domain_scan as a fallback before giving up.
                $fallback = $this->domain_scan( $domain );
                if ( ! empty( $fallback ) ) {
                    $all_contacts = array_merge( $all_contacts, $fallback );
                } else {
                    $errors[ $domain ] = $result->get_error_message();
                }
                continue;
            }

            $leads = $result['leads'] ?? $result['data'] ?? array();
            $domain_contacts = array();
            foreach ( $leads as $lead ) {
                // Handle varying field name conventions across API versions
                $first = $lead['firstName']  ?? $lead['first_name']  ?? $lead['firstname'] ?? '';
                $last  = $lead['lastName']   ?? $lead['last_name']   ?? $lead['lastname']  ?? '';
                $email = $lead['email']      ?? $lead['emailAddress'] ?? $lead['email_address'] ?? '';
                $title = $lead['currentJobTitle'] ?? $lead['jobTitle'] ?? $lead['job_title'] ?? $lead['title'] ?? '';
                $co    = $lead['currentCompanyName'] ?? $lead['company'] ?? $lead['companyName'] ?? '';
                $li    = $lead['linkedinUrl'] ?? $lead['linkedin_url'] ?? $lead['linkedInUrl'] ?? '';
                $loc   = $lead['location']   ?? $lead['city'] ?? '';

                // If no email in the lead record, attempt single email discovery
                if ( ! $email && $first && $last ) {
                    $found = $this->find_email( $first, $last, $domain );
                    if ( ! is_wp_error( $found ) ) {
                        $email = $found;
                    }
                }

                if ( ! $email || ! is_email( $email ) ) continue;

                $domain_contacts[] = array(
                    'first_name'   => $first,
                    'last_name'    => $last,
                    'email'        => $email,
                    'company'      => $co,
                    'title'        => $title,
                    'linkedin_url' => $li,
                    'location'     => $loc,
                    'domain'       => $domain,
                    'confidence'   => 90,
                    'source'       => 'icypeas',
                );
            }

            // If no named contacts found, fall back to role-based domain scan
            if ( empty( $domain_contacts ) ) {
                $domain_contacts = $this->domain_scan( $domain );
            }

            $all_contacts = array_merge( $all_contacts, $domain_contacts );
        }

        return array(
            'contacts' => $all_contacts,
            'total'    => count( $all_contacts ),
            'errors'   => $errors,
        );
    }

    /**
     * Scan a domain for role-based addresses (contact@, info@, etc.).
     * Used as fallback when find-people returns nothing for a domain.
     */
    public function domain_scan( $domain ) {
        $result = $this->request( '/domain-search', array(
            'domainOrCompany' => $domain,
        ) );

        if ( is_wp_error( $result ) ) {
            return array();
        }

        $leads    = $result['leads'] ?? $result['emails'] ?? array();
        $contacts = array();

        foreach ( $leads as $lead ) {
            $email = is_string( $lead ) ? $lead : ( $lead['email'] ?? '' );
            if ( ! $email || ! is_email( $email ) ) continue;

            $contacts[] = array(
                'first_name'   => '',
                'last_name'    => '',
                'email'        => $email,
                'company'      => $domain,
                'title'        => 'Contact',
                'linkedin_url' => '',
                'location'     => '',
                'domain'       => $domain,
                'confidence'   => 70,
                'source'       => 'icypeas-domain-scan',
            );
        }

        return $contacts;
    }

    /**
     * Find a single email address for a named person at a domain.
     * Returns the email string or WP_Error.
     */
    public function find_email( $first_name, $last_name, $domain ) {
        $result = $this->request( '/email-discovery', array(
            'firstname'       => $first_name,
            'lastname'        => $last_name,
            'domainOrCompany' => $domain,
        ) );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        $email = $result['email'] ?? $result['lead']['email'] ?? '';
        if ( ! $email ) {
            return new WP_Error( 'no_email', 'Email not found.' );
        }

        return $email;
    }

    /**
     * Persist contacts to the database (delegates to OO_Hunter which holds that logic).
     */
    public function save_contacts( $contacts, $contact_type = '' ) {
        $hunter = new OO_Hunter();
        return $hunter->save_contacts( $contacts, $contact_type );
    }
}
