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
            'oo_wizard_filter_contacts',
            'oo_wizard_link_contacts',
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
            'coupon_url'        => esc_url_raw( $_POST['coupon_url'] ?? '' ),
            'coupon_field'      => sanitize_text_field( $_POST['coupon_field'] ?? '' ),
            'press_release_url' => esc_url_raw( $_POST['press_release_url'] ?? '' ),
            'status'            => 'draft',
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

        // Collect domains already in the contacts database
        global $wpdb;
        $existing_emails  = $wpdb->get_col( "SELECT email FROM {$wpdb->prefix}oo_contacts" );
        $existing_domains = array_unique( array_map( function( $email ) {
            return strtolower( substr( $email, strpos( $email, '@' ) + 1 ) );
        }, $existing_emails ) );

        // Also include any domains already suggested this session (passed from JS)
        $session_domains = array_map( 'sanitize_text_field', (array) ( $_POST['existing_domains'] ?? array() ) );
        $exclude_domains = array_unique( array_merge( $existing_domains, $session_domains ) );

        $result = $claude->refine_audience(
            sanitize_text_field( $_POST['campaign_name'] ?? '' ),
            sanitize_text_field( $_POST['brand'] ?? '' ),
            sanitize_text_field( $_POST['campaign_type'] ?? '' ),
            sanitize_textarea_field( $_POST['audience'] ?? '' ),
            sanitize_textarea_field( $_POST['claude_prompt'] ?? '' ),
            $exclude_domains
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

        $settings       = get_option( 'oo_settings', array() );
        $finder_choice  = $settings['contact_finder'] ?? 'hunter';

        // Instantiate the chosen provider and validate it is configured
        if ( $finder_choice === 'icypeas' ) {
            $finder = new OO_Icypeas();
            if ( ! $finder->is_configured() ) {
                wp_send_json_error( 'Icypeas API key not configured. Go to Outreach → Settings.' );
            }
        } else {
            $finder = new OO_Hunter();
            if ( ! $finder->is_configured() ) {
                wp_send_json_error( 'Hunter.io API key not configured. Go to Outreach → Settings.' );
            }
        }

        $domains = array_map( 'sanitize_text_field', (array) ( $_POST['domains'] ?? array() ) );
        if ( empty( $domains ) ) {
            wp_send_json_error( 'No domains provided.' );
        }

        // Exclude domains already present in the contacts database
        global $wpdb;
        $existing_emails = $wpdb->get_col( "SELECT email FROM {$wpdb->prefix}oo_contacts" );
        $existing_domains = array_unique( array_map( function( $email ) {
            return strtolower( substr( $email, strpos( $email, '@' ) + 1 ) );
        }, $existing_emails ) );

        $domains = array_values( array_filter( $domains, function( $d ) use ( $existing_domains ) {
            return ! in_array( strtolower( trim( $d ) ), $existing_domains, true );
        } ) );

        // Batch: take up to 8 domains per run to avoid timeouts
        $batch_size = 8;
        $batch      = array_slice( $domains, 0, $batch_size );
        $remaining  = array_slice( $domains, $batch_size );

        if ( empty( $batch ) ) {
            wp_send_json_success( array(
                'contacts'  => array(),
                'total'     => 0,
                'errors'    => array(),
                'remaining' => array(),
                'message'   => 'All domains have already been searched — no new domains to check.',
            ) );
        }

        $limit = intval( $_POST['contacts_per_domain'] ?? 25 );
        $limit = max( 5, min( 50, $limit ) );

        // Icypeas benefits from job titles to narrow the people search
        if ( $finder_choice === 'icypeas' ) {
            $job_titles = array_map( 'sanitize_text_field', (array) ( $_POST['job_titles'] ?? array() ) );
            $result = $finder->search_domains( $batch, $job_titles, $limit );
        } else {
            $result = $finder->search_domains( $batch, $limit );
        }

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        $result['searched']  = $batch;
        $result['remaining'] = $remaining;
        $result['provider']  = $finder_choice;

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

        // Bulk-insert into oo_campaign_contacts junction table if we have a campaign
        if ( $campaign_id > 0 && ! empty( $result['contact_ids'] ) ) {
            global $wpdb;
            $cc_table = $wpdb->prefix . 'oo_campaign_contacts';

            foreach ( $result['contact_ids'] as $contact_id ) {
                $contact_id = intval( $contact_id );
                if ( ! $contact_id ) continue;

                // Use INSERT IGNORE to skip already-existing rows
                $wpdb->query( $wpdb->prepare(
                    "INSERT IGNORE INTO {$cc_table} (campaign_id, contact_id) VALUES (%d, %d)",
                    $campaign_id,
                    $contact_id
                ) );
            }
        }

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

        // Seed oo_sends for all campaign contacts using the first sequence step
        $queued = 0;

        $first_step = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_sequences
             WHERE campaign_id = %d AND step_number = 1 AND status = 'active'
             LIMIT 1",
            $campaign_id
        ) );

        if ( $first_step ) {
            $contact_ids = $wpdb->get_col( $wpdb->prepare(
                "SELECT contact_id FROM {$wpdb->prefix}oo_campaign_contacts WHERE campaign_id = %d",
                $campaign_id
            ) );

            $sends_table = $wpdb->prefix . 'oo_sends';

            foreach ( $contact_ids as $contact_id ) {
                $contact_id = intval( $contact_id );
                if ( ! $contact_id ) continue;

                // Skip if a send already exists for this campaign+contact+sequence
                $exists = $wpdb->get_var( $wpdb->prepare(
                    "SELECT id FROM {$sends_table}
                     WHERE campaign_id = %d AND contact_id = %d AND sequence_id = %d
                     LIMIT 1",
                    $campaign_id,
                    $contact_id,
                    $first_step->id
                ) );

                if ( $exists ) continue;

                $wpdb->insert( $sends_table, array(
                    'campaign_id'  => $campaign_id,
                    'contact_id'   => $contact_id,
                    'sequence_id'  => $first_step->id,
                    'status'       => 'pending',
                    'scheduled_at' => current_time( 'mysql' ),
                ) );

                if ( $wpdb->insert_id ) {
                    $queued++;
                }
            }
        }

        oo_schedule_sequence_processing( $campaign_id );

        wp_send_json_success( array(
            'campaign_id' => $campaign_id,
            'scheduler'   => OO_HAS_ACTION_SCHEDULER ? 'action-scheduler' : 'wp-cron',
            'queued'      => $queued,
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

    public function wizard_filter_contacts() {
        $this->check_nonce();
        global $wpdb;

        $type     = sanitize_text_field( $_POST['type'] ?? '' );
        $location = sanitize_text_field( $_POST['location'] ?? '' );
        $campaign_id = intval( $_POST['campaign_id'] ?? 0 );

        $where = "WHERE status = 'active'";
        $args  = array();

        if ( $type ) {
            $where .= " AND type = %s";
            $args[] = $type;
        }
        if ( $location ) {
            $where .= " AND location LIKE %s";
            $args[] = '%' . $wpdb->esc_like( $location ) . '%';
        }

        // Exclude contacts already linked to this campaign
        if ( $campaign_id ) {
            $where .= " AND id NOT IN (SELECT contact_id FROM {$wpdb->prefix}oo_campaign_contacts WHERE campaign_id = %d)";
            $args[] = $campaign_id;
        }

        $sql = "SELECT id, first_name, last_name, email, company, type, location FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT 300";

        $contacts = $args
            ? $wpdb->get_results( $wpdb->prepare( $sql, $args ), ARRAY_A )
            : $wpdb->get_results( $sql, ARRAY_A );

        wp_send_json_success( array( 'contacts' => $contacts, 'total' => count( $contacts ) ) );
    }

    public function wizard_link_contacts() {
        $this->check_nonce();

        $campaign_id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $campaign_id ) wp_send_json_error( 'No campaign ID.' );

        $raw = $_POST['contact_ids'] ?? '[]';
        $ids = json_decode( stripslashes( $raw ), true );
        if ( ! is_array( $ids ) || empty( $ids ) ) {
            wp_send_json_error( 'No contacts selected.' );
        }

        global $wpdb;
        $linked = 0;
        foreach ( $ids as $contact_id ) {
            $contact_id = intval( $contact_id );
            if ( ! $contact_id ) continue;
            $rows = $wpdb->query( $wpdb->prepare(
                "INSERT IGNORE INTO {$wpdb->prefix}oo_campaign_contacts (campaign_id, contact_id) VALUES (%d, %d)",
                $campaign_id, $contact_id
            ) );
            $linked += $rows;
        }

        wp_send_json_success( array( 'linked' => $linked ) );
    }
}
