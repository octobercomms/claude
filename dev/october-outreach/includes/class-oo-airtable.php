<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Airtable {

    private $api_key;
    private $base_id;
    private $base_url = 'https://api.airtable.com/v0';
    private $table_name = 'Contacts';

    public function __construct() {
        $settings = get_option( 'oo_settings', array() );
        $this->api_key = $settings['airtable_api_key'] ?? '';
        $this->base_id = $settings['airtable_base_id'] ?? '';
    }

    public function is_configured() {
        return ! empty( $this->api_key ) && ! empty( $this->base_id );
    }

    private function request( $method, $endpoint, $body = null ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'not_configured', 'Airtable not configured.' );
        }

        $url = $this->base_url . '/' . $this->base_id . $endpoint;

        $args = array(
            'method'  => $method,
            'timeout' => 30,
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type'  => 'application/json',
            ),
        );

        if ( $body ) {
            $args['body'] = wp_json_encode( $body );
        }

        $response = wp_remote_request( $url, $args );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code >= 400 ) {
            $msg = $data['error']['message'] ?? 'Airtable API error ' . $code;
            return new WP_Error( 'airtable_error', $msg );
        }

        return $data;
    }

    /**
     * Map a WP contact row to Airtable fields.
     */
    private function to_airtable_fields( $contact ) {
        $types = OO_Database::get_contact_types();
        return array(
            'Name'        => trim( ( $contact['first_name'] ?? '' ) . ' ' . ( $contact['last_name'] ?? '' ) ),
            'First Name'  => $contact['first_name'] ?? '',
            'Last Name'   => $contact['last_name'] ?? '',
            'Email'       => $contact['email'] ?? '',
            'Company'     => $contact['company'] ?? '',
            'Type'        => $types[ $contact['type'] ?? '' ] ?? ( $contact['type'] ?? '' ),
            'Location'    => $contact['location'] ?? '',
            'LinkedIn'    => $contact['linkedin_url'] ?? '',
            'Source'      => $contact['source'] ?? '',
            'Status'      => ucfirst( $contact['status'] ?? 'active' ),
            'Notes'       => $contact['notes'] ?? '',
            'WP ID'       => (string) ( $contact['id'] ?? '' ),
        );
    }

    /**
     * Ensure the Contacts table exists with the right fields.
     * Creates it if it doesn't exist.
     */
    public function ensure_table() {
        // List tables in the base
        $url = 'https://api.airtable.com/v0/meta/bases/' . $this->base_id . '/tables';
        $response = wp_remote_get( $url, array(
            'timeout' => 20,
            'headers' => array( 'Authorization' => 'Bearer ' . $this->api_key ),
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        $tables = $data['tables'] ?? array();

        foreach ( $tables as $table ) {
            if ( $table['name'] === $this->table_name ) {
                return array( 'exists' => true, 'id' => $table['id'] );
            }
        }

        // Create the table
        $create_url = 'https://api.airtable.com/v0/meta/bases/' . $this->base_id . '/tables';
        $create_response = wp_remote_post( $create_url, array(
            'timeout' => 30,
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( array(
                'name' => $this->table_name,
                'fields' => array(
                    array( 'name' => 'Name',       'type' => 'singleLineText' ),
                    array( 'name' => 'First Name',  'type' => 'singleLineText' ),
                    array( 'name' => 'Last Name',   'type' => 'singleLineText' ),
                    array( 'name' => 'Email',       'type' => 'email' ),
                    array( 'name' => 'Company',     'type' => 'singleLineText' ),
                    array( 'name' => 'Type',        'type' => 'singleLineText' ),
                    array( 'name' => 'Location',    'type' => 'singleLineText' ),
                    array( 'name' => 'LinkedIn',    'type' => 'url' ),
                    array( 'name' => 'Source',      'type' => 'singleLineText' ),
                    array( 'name' => 'Status',      'type' => 'singleLineText' ),
                    array( 'name' => 'Notes',       'type' => 'multilineText' ),
                    array( 'name' => 'WP ID',       'type' => 'singleLineText' ),
                ),
            ) ),
        ) );

        $create_data = json_decode( wp_remote_retrieve_body( $create_response ), true );
        return array( 'created' => true, 'id' => $create_data['id'] ?? '' );
    }

    /**
     * Push a single contact to Airtable.
     * Creates or updates based on WP ID.
     */
    public function push_contact( $contact ) {
        if ( is_object( $contact ) ) {
            $contact = (array) $contact;
        }

        $fields = $this->to_airtable_fields( $contact );

        // Check if record exists by WP ID
        $wp_id = (string) ( $contact['id'] ?? '' );
        if ( $wp_id && ! empty( $contact['airtable_id'] ) ) {
            // Update existing
            $result = $this->request( 'PATCH', '/' . rawurlencode( $this->table_name ) . '/' . $contact['airtable_id'], array(
                'fields' => $fields,
            ) );
        } else {
            // Create new
            $result = $this->request( 'POST', '/' . rawurlencode( $this->table_name ), array(
                'fields' => $fields,
            ) );

            // Save Airtable record ID back to WP
            if ( ! is_wp_error( $result ) && ! empty( $result['id'] ) && $wp_id ) {
                global $wpdb;
                $wpdb->update(
                    $wpdb->prefix . 'oo_contacts',
                    array( 'airtable_id' => $result['id'] ),
                    array( 'id' => intval( $wp_id ) )
                );
            }
        }

        return $result;
    }

    /**
     * Bulk push all contacts to Airtable (up to 10 at a time per API limits).
     */
    public function push_all_contacts() {
        global $wpdb;
        $contacts = $wpdb->get_results( "SELECT * FROM {$wpdb->prefix}oo_contacts WHERE status = 'active'", ARRAY_A );

        if ( empty( $contacts ) ) {
            return array( 'pushed' => 0, 'errors' => 0 );
        }

        $pushed = 0;
        $errors = 0;
        $chunks = array_chunk( $contacts, 10 );

        foreach ( $chunks as $chunk ) {
            $records = array();
            $wp_ids  = array();

            foreach ( $chunk as $contact ) {
                if ( ! empty( $contact['airtable_id'] ) ) {
                    // Update individually
                    $result = $this->push_contact( $contact );
                    if ( is_wp_error( $result ) ) $errors++; else $pushed++;
                    continue;
                }
                $records[] = array( 'fields' => $this->to_airtable_fields( $contact ) );
                $wp_ids[]  = $contact['id'];
            }

            if ( empty( $records ) ) continue;

            $result = $this->request( 'POST', '/' . rawurlencode( $this->table_name ), array( 'records' => $records ) );

            if ( is_wp_error( $result ) ) {
                $errors += count( $records );
                continue;
            }

            // Save Airtable IDs back
            foreach ( ( $result['records'] ?? array() ) as $i => $record ) {
                if ( isset( $wp_ids[ $i ] ) && ! empty( $record['id'] ) ) {
                    global $wpdb;
                    $wpdb->update(
                        $wpdb->prefix . 'oo_contacts',
                        array( 'airtable_id' => $record['id'] ),
                        array( 'id' => intval( $wp_ids[ $i ] ) )
                    );
                }
            }

            $pushed += count( $records );
        }

        return array( 'pushed' => $pushed, 'errors' => $errors );
    }

    /**
     * Pull updates from Airtable back into WordPress.
     */
    public function pull_contacts() {
        global $wpdb;
        $result = $this->request( 'GET', '/' . rawurlencode( $this->table_name ) . '?fields[]=WP+ID&fields[]=Status&fields[]=Notes' );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        $updated = 0;
        foreach ( ( $result['records'] ?? array() ) as $record ) {
            $wp_id = $record['fields']['WP ID'] ?? '';
            if ( ! $wp_id ) continue;

            $status = strtolower( $record['fields']['Status'] ?? 'active' );
            $notes  = $record['fields']['Notes'] ?? '';

            $wpdb->update(
                $wpdb->prefix . 'oo_contacts',
                array( 'status' => $status, 'notes' => $notes ),
                array( 'id' => intval( $wp_id ) )
            );
            $updated++;
        }

        return array( 'updated' => $updated );
    }
}
