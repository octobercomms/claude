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
            'oo_wizard_more_domains',
            'oo_wizard_discover_domains',
            'oo_verify_emails',
            'oo_bulk_delete_dead',
            'oo_enrich_locations',
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

        $structured = array(
            'location'        => sanitize_text_field( $_POST['aud_location']        ?? '' ),
            'industry_type'   => sanitize_text_field( $_POST['aud_industry_type']   ?? '' ),
            'specialisation'  => sanitize_text_field( $_POST['aud_specialisation']  ?? '' ),
            'business_size'   => sanitize_text_field( $_POST['aud_business_size']   ?? '' ),
            'exclude_types'   => sanitize_text_field( $_POST['aud_exclude_types']   ?? '' ),
        );

        $result = $claude->refine_audience(
            sanitize_text_field( $_POST['campaign_name'] ?? '' ),
            sanitize_text_field( $_POST['brand'] ?? '' ),
            sanitize_text_field( $_POST['campaign_type'] ?? '' ),
            sanitize_textarea_field( $_POST['audience'] ?? '' ),
            sanitize_textarea_field( $_POST['claude_prompt'] ?? '' ),
            $exclude_domains,
            $structured
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

        $hunter  = new OO_Hunter();
        $icypeas = new OO_Icypeas();
        $scraper = new OO_Scraper();

        if ( ! $hunter->is_configured() && ! $icypeas->is_configured() ) {
            wp_send_json_error( 'No contact finder configured. Add a Hunter.io or Icypeas API key in Settings.' );
        }

        $domains = array_map( 'sanitize_text_field', (array) ( $_POST['domains'] ?? array() ) );
        if ( empty( $domains ) ) {
            wp_send_json_error( 'No domains provided.' );
        }

        $include_personal = ( $_POST['include_personal'] ?? '1' ) !== '0';
        $include_generic  = ( $_POST['include_generic']  ?? '1' ) !== '0';

        // Exclude domains already present in the contacts database
        global $wpdb;
        $existing_emails = $wpdb->get_col( "SELECT email FROM {$wpdb->prefix}oo_contacts" );
        $existing_domains = array_unique( array_map( function( $email ) {
            return strtolower( substr( $email, strpos( $email, '@' ) + 1 ) );
        }, $existing_emails ) );

        $domains = array_values( array_filter( $domains, function( $d ) use ( $existing_domains ) {
            return ! in_array( strtolower( trim( $d ) ), $existing_domains, true );
        } ) );

        // Batch: take up to 6 domains per run to allow time for validation + scraping
        $batch_size = 6;
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

        // Pre-validate: ping each domain and drop dead ones
        $live_batch  = array();
        $dead_errors = array();
        foreach ( $batch as $domain ) {
            if ( $scraper->domain_is_live( $domain ) ) {
                $live_batch[] = $domain;
            } else {
                $dead_errors[ $domain ] = 'Domain unreachable — skipped';
            }
        }

        $limit      = intval( $_POST['contacts_per_domain'] ?? 25 );
        $limit      = max( 5, min( 50, $limit ) );
        $job_titles = array_map( 'sanitize_text_field', (array) ( $_POST['job_titles'] ?? array() ) );

        $all_contacts   = array();
        $all_errors     = array_merge( array(), $dead_errors );
        $providers_used = array();
        $provider_notes = array();

        // Track which live domains got at least one contact from APIs
        $domains_with_contacts = array();

        if ( ! empty( $live_batch ) ) {

            if ( $hunter->is_configured() ) {
                $hr = $hunter->search_domains( $live_batch, $limit );
                if ( is_wp_error( $hr ) ) {
                    $provider_notes[] = 'Hunter.io: ' . $hr->get_error_message();
                } else {
                    $providers_used[] = 'Hunter.io';
                    $hc = $hr['contacts'] ?? array();
                    $all_contacts = array_merge( $all_contacts, $hc );
                    $all_errors   = array_merge( $all_errors, $hr['errors'] ?? array() );
                    foreach ( $hc as $c ) {
                        $domains_with_contacts[ $c['domain'] ] = true;
                    }
                    if ( empty( $hc ) ) {
                        $provider_notes[] = 'Hunter.io: no contacts found for these domains';
                    }
                }
            }

            if ( $icypeas->is_configured() ) {
                $ir = $icypeas->search_domains( $live_batch, $job_titles, $limit );
                if ( is_wp_error( $ir ) ) {
                    $provider_notes[] = 'Icypeas: ' . $ir->get_error_message();
                } else {
                    $providers_used[] = 'Icypeas';
                    $ic = $ir['contacts'] ?? array();
                    $all_contacts = array_merge( $all_contacts, $ic );
                    $all_errors   = array_merge( $all_errors, $ir['errors'] ?? array() );
                    foreach ( $ic as $c ) {
                        $domains_with_contacts[ $c['domain'] ] = true;
                    }
                    if ( empty( $ic ) ) {
                        $note = 'Icypeas: no contacts found';
                        if ( ! empty( $ir['errors'] ) ) {
                            $parts = array();
                            foreach ( $ir['errors'] as $d => $err ) {
                                $parts[] = $d . ': ' . $err;
                            }
                            $note .= ' — ' . implode( '; ', $parts );
                        }
                        $provider_notes[] = $note;
                    }
                }
            }

            // For domains that still have no contacts, try web scraper then pattern fallback
            foreach ( $live_batch as $domain ) {
                if ( isset( $domains_with_contacts[ $domain ] ) ) continue;

                // Web scraper — looks for mailto: links on /contact, /about, /team
                $scraped = $scraper->scrape_domain( $domain );
                if ( ! empty( $scraped ) ) {
                    $providers_used[]                 = 'web-scrape';
                    $domains_with_contacts[ $domain ] = true;
                    $all_contacts = array_merge( $all_contacts, $scraped );
                    continue;
                }

                // Pattern fallback — unverified generic addresses
                if ( $include_generic ) {
                    $patterns = $scraper->pattern_contacts( $domain );
                    $all_contacts = array_merge( $all_contacts, $patterns );
                    $provider_notes[] = $domain . ': no verified contacts found — generic patterns added';
                } else {
                    if ( ! isset( $all_errors[ $domain ] ) ) {
                        $all_errors[ $domain ] = 'No contacts found via any source';
                    }
                }
            }
        }

        // Filter by contact type preference
        $filtered = array();
        foreach ( $all_contacts as $c ) {
            $is_personal = ! empty( $c['first_name'] ) || ! empty( $c['last_name'] );
            $is_generic  = ! $is_personal;
            if ( $is_personal && ! $include_personal ) continue;
            if ( $is_generic  && ! $include_generic  ) continue;
            $filtered[] = $c;
        }

        // Deduplicate by email address
        $seen     = array();
        $contacts = array();
        foreach ( $filtered as $c ) {
            $email = strtolower( trim( $c['email'] ?? '' ) );
            if ( $email && ! isset( $seen[ $email ] ) ) {
                $seen[ $email ] = true;
                $contacts[]     = $c;
            }
        }

        $providers_used = array_unique( $providers_used );

        $result = array(
            'contacts'       => $contacts,
            'total'          => count( $contacts ),
            'errors'         => $all_errors,
            'provider_notes' => $provider_notes,
            'searched'       => $batch,
            'remaining'      => $remaining,
            'provider'       => implode( ' + ', $providers_used ) ?: 'none',
        );

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

        $type        = sanitize_text_field( $_POST['type']     ?? '' );
        $location    = sanitize_text_field( $_POST['location'] ?? '' );
        $verified    = sanitize_text_field( $_POST['verified'] ?? '' );
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
        if ( $verified ) {
            $where .= " AND verified_status = %s";
            $args[] = $verified;
        }

        // Exclude contacts already linked to this campaign
        if ( $campaign_id ) {
            $where .= " AND id NOT IN (SELECT contact_id FROM {$wpdb->prefix}oo_campaign_contacts WHERE campaign_id = %d)";
            $args[] = $campaign_id;
        }

        $sql = "SELECT id, first_name, last_name, email, company, type, location, verified_status FROM {$wpdb->prefix}oo_contacts $where ORDER BY created_at DESC LIMIT 300";

        $contacts = $args
            ? $wpdb->get_results( $wpdb->prepare( $sql, $args ), ARRAY_A )
            : $wpdb->get_results( $sql, ARRAY_A );

        wp_send_json_success( array( 'contacts' => $contacts, 'total' => count( $contacts ) ) );
    }

    /**
     * Ask Claude to generate a fresh batch of domains from a different angle.
     */
    public function wizard_more_domains() {
        $this->check_nonce();

        $claude = new OO_Claude();
        if ( ! $claude->is_configured() ) {
            wp_send_json_error( 'Claude API key not configured.' );
        }

        $existing = array_map( 'sanitize_text_field', (array) ( $_POST['existing_domains'] ?? array() ) );
        $structured = array(
            'location'       => sanitize_text_field( $_POST['aud_location']       ?? '' ),
            'industry_type'  => sanitize_text_field( $_POST['aud_industry_type']  ?? '' ),
            'specialisation' => sanitize_text_field( $_POST['aud_specialisation'] ?? '' ),
            'business_size'  => sanitize_text_field( $_POST['aud_business_size']  ?? '' ),
        );

        $result = $claude->more_domains(
            sanitize_text_field( $_POST['campaign_name'] ?? '' ),
            sanitize_text_field( $_POST['brand']         ?? '' ),
            sanitize_textarea_field( $_POST['audience']  ?? '' ),
            $structured,
            $existing
        );

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        $new_domains = array_values( array_diff(
            array_filter( array_map( 'sanitize_text_field', $result['domains'] ?? array() ) ),
            $existing
        ) );

        wp_send_json_success( array(
            'domains' => $new_domains,
            'count'   => count( $new_domains ),
            'angle'   => sanitize_text_field( $result['angle'] ?? '' ),
        ) );
    }

    /**
     * Discover domains via Serper web search + Claude-suggested directories.
     */
    public function wizard_discover_domains() {
        $this->check_nonce();

        $serper  = new OO_Serper();
        $claude  = new OO_Claude();
        $scraper = new OO_Scraper();

        $industry  = sanitize_text_field( $_POST['aud_industry_type']  ?? '' );
        $location  = sanitize_text_field( $_POST['aud_location']       ?? '' );
        $spec      = sanitize_text_field( $_POST['aud_specialisation'] ?? '' );
        $existing  = array_map( 'sanitize_text_field', (array) ( $_POST['existing_domains'] ?? array() ) );

        $all_domains = array();
        $notes       = array();

        // 1. Serper web search for real businesses
        if ( $serper->is_configured() ) {
            $web_domains = $serper->find_business_domains( $industry, $location, $spec, $existing );
            if ( ! empty( $web_domains ) ) {
                $all_domains = array_merge( $all_domains, $web_domains );
                $notes[]     = count( $web_domains ) . ' domains from web search';
            }
        } else {
            $notes[] = 'Serper not configured — add a Serper API key in Settings for web search';
        }

        // 2. Claude suggests directories for this industry
        if ( $claude->is_configured() && ( $industry || $spec ) ) {
            $dirs = $claude->suggest_directories( $industry, $location, $spec );
            if ( ! is_wp_error( $dirs ) && is_array( $dirs ) ) {
                $dir_count = 0;
                foreach ( $dirs as $dir ) {
                    $dir_domain = sanitize_text_field( $dir['domain'] ?? '' );
                    $search_path = sanitize_text_field( $dir['search_path'] ?? '' );
                    if ( ! $dir_domain ) continue;

                    // If Serper available, search within the directory for listing pages
                    if ( $serper->is_configured() ) {
                        $pages = $serper->search_within_directory( $dir_domain, $location, $industry );
                        foreach ( $pages as $page_url ) {
                            $page_domains = $scraper->scrape_directory_page( $page_url, $dir_domain );
                            $all_domains  = array_merge( $all_domains, $page_domains );
                            $dir_count   += count( $page_domains );
                        }
                    } elseif ( $search_path ) {
                        // Scrape the directory's search/listing page directly
                        $dir_url      = 'https://' . $dir_domain . $search_path;
                        $page_domains = $scraper->scrape_directory_page( $dir_url, $dir_domain );
                        $all_domains  = array_merge( $all_domains, $page_domains );
                        $dir_count   += count( $page_domains );
                    }
                }
                if ( $dir_count > 0 ) {
                    $notes[] = $dir_count . ' domains from ' . count( $dirs ) . ' industry directories';
                } else {
                    $names   = array();
                    foreach ( $dirs as $d ) { if ( ! empty( $d['name'] ) ) $names[] = $d['name']; }
                    $notes[] = 'Directories identified (' . implode( ', ', array_slice( $names, 0, 3 ) ) . ') — scraping found no external links (JavaScript-rendered sites)';
                }
            }
        }

        // Deduplicate and remove existing
        $new_domains = array();
        $seen        = array_flip( $existing );
        foreach ( $all_domains as $d ) {
            $d = strtolower( trim( $d ) );
            if ( ! $d || isset( $seen[ $d ] ) ) continue;
            $seen[ $d ]    = true;
            $new_domains[] = $d;
        }

        wp_send_json_success( array(
            'domains' => $new_domains,
            'count'   => count( $new_domains ),
            'notes'   => $notes,
        ) );
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

    /**
     * Verify a list of email addresses.
     * Uses MX record check (free) and Hunter.io verifier if configured.
     */
    public function verify_emails() {
        $this->check_nonce();

        $emails = array_map( 'sanitize_email', (array) ( $_POST['emails'] ?? array() ) );
        $emails = array_filter( $emails );

        if ( empty( $emails ) ) {
            wp_send_json_error( 'No emails to verify.' );
        }

        $hunter  = new OO_Hunter();
        $results = array();

        foreach ( $emails as $email ) {
            $domain = strtolower( substr( $email, strpos( $email, '@' ) + 1 ) );

            // Free MX record check
            $has_mx = checkdnsrr( $domain, 'MX' );

            if ( ! $has_mx ) {
                // No MX = dead domain, skip Hunter call
                $results[] = array(
                    'email'  => $email,
                    'status' => 'dead',
                    'mx'     => false,
                    'source' => 'mx-check',
                );
                continue;
            }

            // Hunter verify if configured
            if ( $hunter->is_configured() ) {
                $v = $hunter->verify_email( $email );
                if ( ! is_wp_error( $v ) ) {
                    $results[] = array(
                        'email'  => $email,
                        'status' => $v['status'] ?? 'unknown',
                        'mx'     => true,
                        'source' => 'hunter',
                    );
                    continue;
                }
            }

            // MX passed but no further verification
            $results[] = array(
                'email'  => $email,
                'status' => 'risky',
                'mx'     => true,
                'source' => 'mx-check',
            );
        }

        // Persist verified_status to existing contacts in the database
        global $wpdb;
        $now = current_time( 'mysql' );
        foreach ( $results as $r ) {
            $wpdb->update(
                $wpdb->prefix . 'oo_contacts',
                array( 'verified_status' => $r['status'], 'verified_at' => $now ),
                array( 'email' => $r['email'] )
            );
        }

        wp_send_json_success( array(
            'results' => $results,
            'total'   => count( $results ),
        ) );
    }

    /**
     * Delete all contacts whose verified_status is 'invalid' or 'dead'.
     */
    public function bulk_delete_dead() {
        $this->check_nonce();

        global $wpdb;
        $deleted = $wpdb->query(
            "DELETE FROM {$wpdb->prefix}oo_contacts WHERE verified_status IN ('invalid','dead')"
        );

        wp_send_json_success( array( 'deleted' => intval( $deleted ) ) );
    }

    /**
     * Enrich location for contacts with empty location field.
     * Resolves domain from email → IP → ipapi.co geolocation.
     * Processes a batch of up to 30 contacts per call.
     */
    public function enrich_locations() {
        $this->check_nonce();

        global $wpdb;

        // If specific IDs passed, use those (manual overwrite mode); otherwise pick empty-location batch
        $ids = array_filter( array_map( 'intval', (array) ( $_POST['contact_ids'] ?? array() ) ) );

        if ( $ids ) {
            $placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
            $contacts     = $wpdb->get_results(
                $wpdb->prepare( "SELECT id, email, location FROM {$wpdb->prefix}oo_contacts WHERE id IN ($placeholders)", $ids ),
                ARRAY_A
            );
        } else {
            $contacts = $wpdb->get_results(
                "SELECT id, email, location FROM {$wpdb->prefix}oo_contacts WHERE (location = '' OR location IS NULL) LIMIT 30",
                ARRAY_A
            );
        }

        if ( empty( $contacts ) ) {
            wp_send_json_success( array( 'updated' => 0, 'remaining' => 0, 'message' => 'All contacts already have a location.' ) );
        }

        // Cache per-domain to avoid duplicate API calls in this batch
        $domain_cache = array();
        $updated      = 0;
        $failed       = 0;

        foreach ( $contacts as $contact ) {
            $email  = $contact['email'];
            $at_pos = strpos( $email, '@' );
            if ( $at_pos === false ) { $failed++; continue; }

            $domain = strtolower( substr( $email, $at_pos + 1 ) );

            if ( isset( $domain_cache[ $domain ] ) ) {
                $location = $domain_cache[ $domain ];
            } else {
                $ip = gethostbyname( $domain );
                if ( $ip === $domain || filter_var( $ip, FILTER_VALIDATE_IP ) === false ) {
                    $domain_cache[ $domain ] = '';
                    $failed++;
                    continue;
                }

                // ipapi.co — free, no key required, 1000 requests/day
                $response = wp_remote_get( 'https://ipapi.co/' . $ip . '/json/', array(
                    'timeout' => 5,
                    'headers' => array( 'User-Agent' => 'OctoberOutreach/3.2' ),
                ) );

                if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) {
                    $domain_cache[ $domain ] = '';
                    $failed++;
                    continue;
                }

                $geo = json_decode( wp_remote_retrieve_body( $response ), true );

                // Build "City, Country" — skip CDN/privacy IPs where city is absent
                $city    = $geo['city']         ?? '';
                $country = $geo['country_name'] ?? '';

                if ( ! $city && ! $country ) {
                    $domain_cache[ $domain ] = '';
                    $failed++;
                    continue;
                }

                $location = trim( implode( ', ', array_filter( array( $city, $country ) ) ) );
                $domain_cache[ $domain ] = $location;
            }

            if ( $location ) {
                $wpdb->update(
                    $wpdb->prefix . 'oo_contacts',
                    array( 'location' => $location ),
                    array( 'id' => $contact['id'] )
                );
                $updated++;
            } else {
                $failed++;
            }
        }

        $remaining = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->prefix}oo_contacts WHERE (location = '' OR location IS NULL)"
        );

        wp_send_json_success( array(
            'updated'   => $updated,
            'failed'    => $failed,
            'remaining' => $remaining,
        ) );
    }
}
