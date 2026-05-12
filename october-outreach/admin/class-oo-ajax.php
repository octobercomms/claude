<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Ajax {

    public function __construct() {
        $actions = array(
            'oo_wizard_save_meta',
            'oo_wizard_refine_audience',
            'oo_wizard_save_audience',
            'oo_wizard_search_contacts',
            'oo_wizard_save_contacts',
            'oo_wizard_generate_emails',
            'oo_wizard_save_sequence',
            'oo_wizard_sync_airtable',
            'oo_wizard_launch',
            'oo_airtable_push_all',
            'oo_airtable_pull',
        );

        foreach ( $actions as $action ) {
            add_action( 'wp_ajax_' . $action, array( $this, str_replace( 'oo_', '', $action ) ) );
        }
    }

    private function check_nonce() {
        if ( ! check_ajax_referer( 'oo_nonce', 'nonce', false ) ) {
            wp_send_json_error( 'Invalid nonce.' );
        }
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( 'Insufficient permissions.' );
        }
    }

    public function wizard_save_meta() {
        $this->check_nonce();
        global $wpdb;

        $data = array(
            'name'         => sanitize_text_field( $_POST['name'] ?? '' ),
            'brand'        => sanitize_text_field( $_POST['brand'] ?? '' ),
            'type'         => sanitize_text_field( $_POST['type'] ?? 'outreach' ),
            'from_name'    => sanitize_text_field( $_POST['from_name'] ?? '' ),
            'from_email'   => sanitize_email( $_POST['from_email'] ?? '' ),
            'reply_to'     => sanitize_email( $_POST['reply_to'] ?? '' ),
            'coupon_url'   => esc_url_raw( $_POST['coupon_url'] ?? '' ),
            'coupon_field' => sanitize_text_field( $_POST['coupon_field'] ?? '' ),
            'status'       => 'draft',
        );

        $id = intval( $_POST['campaign_id'] ?? 0 );

        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_campaigns', $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $wpdb->prefix . 'oo_campaigns', $data );
            $id = $wpdb->insert_id;
        }

        wp_send_json_success( array( 'campaign_id' => $id ) );
    }

    public function wizard_refine_audience() {
        $this->check_nonce();

        $claude = new OO_Claude();
        if ( ! $claude->is_configured() ) {
            wp_send_json_error( 'Claude API key not configured. Go to Outreach → Settings.' );
        }

        $result = $claude->refine_audience(
            sanitize_text_field( $_POST['campaign_name'] ?? '' ),
            sanitize_text_field( $_POST['brand'] ?? '' ),
            sanitize_text_field( $_POST['campaign_type'] ?? '' ),
            sanitize_textarea_field( $_POST['audience'] ?? '' ),
            sanitize_textarea_field( $_POST['claude_prompt'] ?? '' )
        );

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        wp_send_json_success( $result );
    }

    public function wizard_save_audience() {
        $this->check_nonce();
        global $wpdb;

        $id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $id ) wp_send_json_error( 'No campaign ID.' );

        $wpdb->update( $wpdb->prefix . 'oo_campaigns', array(
            'audience_description' => sanitize_textarea_field( $_POST['audience_description'] ?? '' ),
            'claude_prompt'        => sanitize_textarea_field( $_POST['claude_prompt'] ?? '' ),
        ), array( 'id' => $id ) );

        wp_send_json_success();
    }

    public function wizard_search_contacts() {
        $this->check_nonce();

        $hunter = new OO_Hunter();
        if ( ! $hunter->is_configured() ) {
            wp_send_json_error( 'Hunter.io API key not configured. Go to Outreach → Settings.' );
        }

        $domains = array_map( 'sanitize_text_field', (array) ( $_POST['domains'] ?? array() ) );
        if ( empty( $domains ) ) {
            wp_send_json_error( 'No domains provided.' );
        }

        $result = $hunter->search_domains( $domains, 10 );

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        wp_send_json_success( $result );
    }

    public function wizard_save_contacts() {
        $this->check_nonce();

        $raw = $_POST['contacts'] ?? '[]';
        $contacts = json_decode( stripslashes( $raw ), true );

        if ( ! is_array( $contacts ) || empty( $contacts ) ) {
            wp_send_json_error( 'No contacts to save.' );
        }

        $contact_type = sanitize_text_field( $_POST['contact_type'] ?? '' );
        $campaign_id  = intval( $_POST['campaign_id'] ?? 0 );

        $hunter = new OO_Hunter();
        $result = $hunter->save_contacts( $contacts, $contact_type );

        wp_send_json_success( $result );
    }

    public function wizard_generate_emails() {
        $this->check_nonce();

        $campaign_id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $campaign_id ) wp_send_json_error( 'No campaign ID.' );

        global $wpdb;
        $campaign = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d", $campaign_id
        ) );

        if ( ! $campaign ) wp_send_json_error( 'Campaign not found.' );

        // Get a few sample contacts for context
        $sample_contacts = $wpdb->get_results(
            "SELECT first_name, last_name, company FROM {$wpdb->prefix}oo_contacts ORDER BY id DESC LIMIT 3",
            ARRAY_A
        );

        $audience = sanitize_textarea_field( $_POST['audience'] ?? $campaign->audience_description );

        // Merge extra instructions from POST (may have been edited in step 2)
        $extra = sanitize_textarea_field( $_POST['claude_prompt'] ?? $campaign->claude_prompt );
        if ( $extra ) {
            $campaign->claude_prompt = $extra;
        }

        $claude = new OO_Claude();
        if ( ! $claude->is_configured() ) {
            wp_send_json_error( 'Claude API key not configured.' );
        }

        $sequence = $claude->write_sequence( $campaign, $audience, $sample_contacts, $campaign->claude_prompt );

        if ( is_wp_error( $sequence ) ) {
            wp_send_json_error( $sequence->get_error_message() );
        }

        wp_send_json_success( array( 'sequence' => $sequence ) );
    }

    public function wizard_save_sequence() {
        $this->check_nonce();

        $campaign_id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $campaign_id ) wp_send_json_error( 'No campaign ID.' );

        $raw      = $_POST['sequence'] ?? '[]';
        $sequence = json_decode( stripslashes( $raw ), true );

        if ( ! is_array( $sequence ) || empty( $sequence ) ) {
            wp_send_json_error( 'No sequence data.' );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'oo_sequences';

        // Delete existing sequences for this campaign
        $wpdb->delete( $table, array( 'campaign_id' => $campaign_id ) );

        foreach ( $sequence as $email ) {
            $wpdb->insert( $table, array(
                'campaign_id' => $campaign_id,
                'step_number' => intval( $email['step'] ?? 1 ),
                'subject'     => sanitize_text_field( $email['subject'] ?? '' ),
                'body'        => wp_kses_post( $email['body'] ?? '' ),
                'delay_days'  => intval( $email['delay_days'] ?? 0 ),
                'status'      => 'active',
            ) );
        }

        wp_send_json_success( array( 'saved' => count( $sequence ) ) );
    }

    public function wizard_sync_airtable() {
        $this->check_nonce();

        $airtable = new OO_Airtable();
        if ( ! $airtable->is_configured() ) {
            wp_send_json_error( 'Airtable not configured. Go to Outreach → Settings.' );
        }

        $airtable->ensure_table();
        $result = $airtable->push_all_contacts();

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        wp_send_json_success( $result );
    }

    public function wizard_launch() {
        $this->check_nonce();

        $campaign_id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $campaign_id ) wp_send_json_error( 'No campaign ID.' );

        global $wpdb;
        $wpdb->update(
            $wpdb->prefix . 'oo_campaigns',
            array( 'status' => 'active' ),
            array( 'id' => $campaign_id )
        );

        oo_schedule_sequence_processing( $campaign_id );

        wp_send_json_success( array(
            'campaign_id'    => $campaign_id,
            'scheduler'      => OO_HAS_ACTION_SCHEDULER ? 'action-scheduler' : 'wp-cron',
        ) );
    }

    public function airtable_push_all() {
        $this->check_nonce();
        $airtable = new OO_Airtable();
        if ( ! $airtable->is_configured() ) wp_send_json_error( 'Airtable not configured.' );
        $airtable->ensure_table();
        $result = $airtable->push_all_contacts();
        is_wp_error( $result ) ? wp_send_json_error( $result->get_error_message() ) : wp_send_json_success( $result );
    }

    public function airtable_pull() {
        $this->check_nonce();
        $airtable = new OO_Airtable();
        if ( ! $airtable->is_configured() ) wp_send_json_error( 'Airtable not configured.' );
        $result = $airtable->pull_contacts();
        is_wp_error( $result ) ? wp_send_json_error( $result->get_error_message() ) : wp_send_json_success( $result );
    }
}
