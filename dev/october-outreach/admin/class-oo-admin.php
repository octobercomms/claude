<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Admin {

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'register_menus' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'admin_body_class', array( $this, 'app_body_class' ) );
        add_action( 'admin_post_oo_save_settings', array( $this, 'save_settings' ) );
        add_action( 'admin_post_oo_save_contact', array( $this, 'save_contact' ) );
        add_action( 'admin_post_oo_delete_contact', array( $this, 'delete_contact' ) );
        add_action( 'admin_post_oo_bulk_delete_contacts', array( $this, 'bulk_delete_contacts' ) );
        add_action( 'admin_post_oo_save_campaign', array( $this, 'save_campaign' ) );
        add_action( 'admin_post_oo_delete_campaign', array( $this, 'delete_campaign' ) );
        add_action( 'admin_post_oo_duplicate_campaign', array( $this, 'duplicate_campaign' ) );
        add_action( 'admin_post_oo_save_press_release', array( $this, 'save_press_release' ) );
        add_action( 'admin_post_oo_export_contacts', array( $this, 'export_contacts_csv' ) );
        add_action( 'admin_post_oo_import_contacts', array( $this, 'import_contacts_csv' ) );
        add_action( 'admin_post_oo_save_editorial_entry', array( $this, 'save_editorial_entry' ) );
        add_action( 'admin_post_oo_delete_editorial_entry', array( $this, 'delete_editorial_entry' ) );
        add_action( 'admin_post_oo_import_editorial_log', array( $this, 'import_editorial_log' ) );
        add_action( 'admin_post_oo_import_publications', array( $this, 'import_publications' ) );
        add_action( 'admin_post_oo_import_press_contacts', array( $this, 'import_press_contacts' ) );
        add_action( 'admin_post_oo_save_client', array( $this, 'save_client' ) );
        add_action( 'admin_post_oo_delete_client', array( $this, 'delete_client' ) );
        add_action( 'admin_post_oo_sync_clients', array( $this, 'sync_clients' ) );
    }

    public function app_body_class( $classes ) {
        if ( $this->is_plugin_page() ) {
            $classes .= ' oo-app-mode';
        }
        return $classes;
    }

    private function is_plugin_page() {
        $screen = get_current_screen();
        if ( ! $screen ) return false;
        return strpos( $screen->id, 'october-outreach' ) !== false
            || strpos( $screen->id, 'oo-' ) !== false;
    }

    public function register_menus() {
        add_menu_page( 'October Outreach', 'Outreach', 'manage_options', 'october-outreach', array( $this, 'page_dashboard' ), 'dashicons-email-alt', 30 );
        add_submenu_page( 'october-outreach', 'Dashboard',      'Dashboard',      'manage_options', 'october-outreach', array( $this, 'page_dashboard' ) );
        add_submenu_page( 'october-outreach', 'Contacts',       'Contacts',       'manage_options', 'oo-contacts',      array( $this, 'page_contacts' ) );
        add_submenu_page( 'october-outreach', 'Tags',           'Tags',           'manage_options', 'oo-tags',          array( $this, 'page_tags' ) );
        add_submenu_page( 'october-outreach', 'Campaigns',      'Campaigns',      'manage_options', 'oo-campaigns',     array( $this, 'page_campaigns' ) );
        add_submenu_page( 'october-outreach', 'Settings',       'Settings',       'manage_options', 'oo-settings',      array( $this, 'page_settings' ) );
        add_submenu_page( 'october-outreach', 'Help & Support', 'Help & Support', 'manage_options', 'oo-help',          array( $this, 'page_help' ) );

        // PR module — separate top-level menu, gated by the enable_pr toggle.
        $settings = get_option( 'oo_settings', array() );
        if ( ( $settings['enable_pr'] ?? '1' ) === '1' ) {
            add_menu_page( 'October PR', 'PR', 'manage_options', 'oo-pr', array( $this, 'page_editorial_log' ), 'dashicons-megaphone', 31 );
            add_submenu_page( 'oo-pr', 'Editorial Log',  'Editorial Log',  'manage_options', 'oo-pr',           array( $this, 'page_editorial_log' ) );
            add_submenu_page( 'oo-pr', 'Journalists',    'Journalists',    'manage_options', 'oo-journalists',  array( $this, 'page_journalists' ) );
            add_submenu_page( 'oo-pr', 'Media Database', 'Media Database', 'manage_options', 'oo-media',        array( $this, 'page_media_database' ) );
            add_submenu_page( 'oo-pr', 'Clients',        'Clients',        'manage_options', 'oo-clients',      array( $this, 'page_clients' ) );
        }
    }

    public function enqueue_assets( $hook ) {
        if ( ! $this->is_plugin_page() ) return;

        wp_enqueue_style( 'oo-app', OO_PLUGIN_URL . 'admin/css/app.css', array(), OO_VERSION );
        wp_enqueue_script( 'oo-app', OO_PLUGIN_URL . 'admin/js/admin.js', array( 'jquery' ), OO_VERSION, true );

        $screen = get_current_screen();
        if ( $screen && strpos( $screen->id, 'oo-campaigns' ) !== false && ( $_GET['action'] ?? '' ) === 'wizard' ) {
            wp_enqueue_script( 'oo-wizard', OO_PLUGIN_URL . 'admin/js/wizard.js', array( 'jquery' ), OO_VERSION, true );
        }
        if ( $screen && strpos( $screen->id, 'oo-tags' ) !== false ) {
            wp_enqueue_script( 'oo-tags', OO_PLUGIN_URL . 'admin/js/tags.js', array(), OO_VERSION, true );
        }
        if ( $screen && strpos( $screen->id, 'oo-media' ) !== false ) {
            wp_enqueue_script( 'oo-dedup', OO_PLUGIN_URL . 'admin/js/dedup.js', array(), OO_VERSION, true );
        }
        if ( $screen && strpos( $screen->id, 'oo-contacts' ) !== false ) {
            if ( ( $_GET['action'] ?? '' ) === 'finder' ) {
                wp_enqueue_script( 'oo-contact-finder', OO_PLUGIN_URL . 'admin/js/contact-finder.js', array( 'jquery' ), OO_VERSION, true );
            } else {
                wp_enqueue_script( 'oo-contacts', OO_PLUGIN_URL . 'admin/js/contacts.js', array(), OO_VERSION, true );
            }
        }

        wp_localize_script( 'oo-app', 'ooData', array(
            'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
            'nonce'        => wp_create_nonce( 'oo_nonce' ),
            'campaignsUrl' => admin_url( 'admin.php?page=oo-campaigns' ),
            'modules'      => array(
                'enableOutreach' => ( get_option( 'oo_settings', array() )['enable_outreach']       ?? '1' ) === '1',
                'enablePress'    => ( get_option( 'oo_settings', array() )['enable_press_releases'] ?? '1' ) === '1',
            ),
        ) );
    }

    private function render( $view, $current_page = '' ) {
        require_once OO_PLUGIN_DIR . 'admin/views/app-header.php';
        require_once OO_PLUGIN_DIR . 'admin/views/' . $view . '.php';
        require_once OO_PLUGIN_DIR . 'admin/views/app-footer.php';
    }

    public function page_dashboard() { $this->render( 'dashboard', 'dashboard' ); }

    public function page_contacts() {
        $action = $_GET['action'] ?? 'list';
        if ( $action === 'finder' ) {
            $this->render( 'contact-finder', 'contacts' );
        } else {
            $this->render( 'contacts', 'contacts' );
        }
    }

    public function page_tags()     { $this->render( 'tags',     'tags' ); }
    public function page_press()    { $this->render( 'press',    'press' ); }
    public function page_settings() { $this->render( 'settings', 'settings' ); }
    public function page_help()     { $this->render( 'help',     'help' ); }

    public function page_editorial_log()  { $this->render( 'editorial-log',  'pr' ); }
    public function page_journalists()    { $this->render( 'journalists',    'pr' ); }
    public function page_media_database() { $this->render( 'media-database', 'pr' ); }
    public function page_clients()        { $this->render( 'clients',        'pr' ); }

    public function page_campaigns() {
        $action = $_GET['action'] ?? 'list';
        if ( $action === 'wizard' ) {
            $this->render( 'wizard', 'campaigns' );
        } else {
            $this->render( 'campaigns', 'campaigns' );
        }
    }

    // ── Form handlers ──────────────────────────────────────

    public function save_settings() {
        check_admin_referer( 'oo_save_settings' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        $settings = get_option( 'oo_settings', array() );
        $fields = array(
            'license_key', 'claude_api_key', 'hunter_api_key', 'icypeas_api_key', 'icypeas_api_secret', 'icypeas_user_id',
            'serper_api_key',
            'airtable_api_key', 'airtable_base_id',
            'email_provider', 'default_reply_to', 'sending_domain',
            'ses_key', 'ses_secret', 'ses_region',
            'mailgun_api_key', 'mailgun_domain', 'mailgun_region',
            'sendgrid_api_key',
            'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_encryption',
        );
        foreach ( $fields as $field ) {
            if ( isset( $_POST[ $field ] ) ) {
                $settings[ $field ] = sanitize_text_field( $_POST[ $field ] );
            }
        }
        // Checkboxes — unchecked fields are absent from POST
        $settings['enable_outreach']       = isset( $_POST['enable_outreach'] ) ? '1' : '0';
        $settings['enable_press_releases'] = isset( $_POST['enable_press_releases'] ) ? '1' : '0';
        $settings['enable_pr']             = isset( $_POST['enable_pr'] ) ? '1' : '0';
        update_option( 'oo_settings', $settings );
        wp_redirect( admin_url( 'admin.php?page=oo-settings&saved=1' ) );
        exit;
    }

    public function save_contact() {
        check_admin_referer( 'oo_save_contact' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        // Normalise tags: lowercase, trim, dedupe, store as JSON array
        $raw_tags = sanitize_text_field( $_POST['tags'] ?? '' );
        $tags     = array_values( array_unique( array_filter( array_map(
            fn( $t ) => strtolower( trim( $t ) ),
            preg_split( '/[\s,;]+/', $raw_tags )
        ) ) ) );

        $data = array(
            'first_name'   => sanitize_text_field( $_POST['first_name'] ?? '' ),
            'last_name'    => sanitize_text_field( $_POST['last_name'] ?? '' ),
            'email'        => sanitize_email( $_POST['email'] ?? '' ),
            'company'      => sanitize_text_field( $_POST['company'] ?? '' ),
            'type'         => sanitize_text_field( $_POST['type'] ?? '' ),
            'segment'      => OO_Database::get_segment_for_type( sanitize_text_field( $_POST['type'] ?? '' ) ),
            'title'        => sanitize_text_field( $_POST['title'] ?? '' ),
            'website'      => esc_url_raw( $_POST['website'] ?? '' ),
            'location'     => sanitize_text_field( $_POST['location'] ?? '' ),
            'linkedin_url' => esc_url_raw( $_POST['linkedin_url'] ?? '' ),
            'tags'         => wp_json_encode( $tags ),
            'source'       => sanitize_text_field( $_POST['source'] ?? '' ),
            'status'       => sanitize_text_field( $_POST['status'] ?? 'active' ),
            'notes'        => sanitize_textarea_field( $_POST['notes'] ?? '' ),
        );
        $id = intval( $_POST['contact_id'] ?? 0 );
        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_contacts', $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $wpdb->prefix . 'oo_contacts', $data );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-contacts&saved=1' ) );
        exit;
    }

    public function delete_contact() {
        check_admin_referer( 'oo_delete_contact' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        global $wpdb;
        $id = intval( $_POST['contact_id'] ?? 0 );
        if ( $id ) $wpdb->delete( $wpdb->prefix . 'oo_contacts', array( 'id' => $id ) );
        wp_redirect( admin_url( 'admin.php?page=oo-contacts&deleted=1' ) );
        exit;
    }

    public function bulk_delete_contacts() {
        check_admin_referer( 'oo_bulk_delete_contacts' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        global $wpdb;
        $ids = array_map( 'intval', (array) ( $_POST['contact_ids'] ?? array() ) );
        $ids = array_filter( $ids );
        if ( $ids ) {
            $placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
            $wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->prefix}oo_contacts WHERE id IN ($placeholders)", $ids ) );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-contacts&deleted=1' ) );
        exit;
    }

    public function save_campaign() {
        check_admin_referer( 'oo_save_campaign' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $data = array(
            'name'                 => sanitize_text_field( $_POST['name'] ?? '' ),
            'brand'                => sanitize_text_field( $_POST['brand'] ?? '' ),
            'type'                 => sanitize_text_field( $_POST['type'] ?? 'outreach' ),
            'status'               => sanitize_text_field( $_POST['status'] ?? 'draft' ),
            'from_name'            => sanitize_text_field( $_POST['from_name'] ?? '' ),
            'from_email'           => sanitize_email( $_POST['from_email'] ?? '' ),
            'reply_to'             => sanitize_email( $_POST['reply_to'] ?? '' ),
            'sending_domain'       => sanitize_text_field( $_POST['sending_domain'] ?? '' ),
            'audience_description' => sanitize_textarea_field( $_POST['audience_description'] ?? '' ),
            'claude_prompt'        => sanitize_textarea_field( $_POST['claude_prompt'] ?? '' ),
        );
        $id = intval( $_POST['campaign_id'] ?? 0 );
        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_campaigns', $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $wpdb->prefix . 'oo_campaigns', $data );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-campaigns&saved=1' ) );
        exit;
    }

    public function delete_campaign() {
        check_admin_referer( 'oo_delete_campaign' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        global $wpdb;
        $id = intval( $_POST['campaign_id'] ?? 0 );
        if ( $id ) {
            $wpdb->delete( $wpdb->prefix . 'oo_campaigns', array( 'id' => $id ) );
            $wpdb->delete( $wpdb->prefix . 'oo_sequences', array( 'campaign_id' => $id ) );
        }
        $redirect = sanitize_text_field( $_POST['redirect_to'] ?? '' );
        $back = ( $redirect === 'dashboard' )
            ? admin_url( 'admin.php?page=october-outreach&deleted=1' )
            : admin_url( 'admin.php?page=oo-campaigns&deleted=1' );
        wp_redirect( $back );
        exit;
    }

    public function export_contacts_csv() {
        check_admin_referer( 'oo_export_contacts' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        // Template download — empty CSV with just headers
        if ( ! empty( $_GET['template'] ) ) {
            header( 'Content-Type: text/csv; charset=utf-8' );
            header( 'Content-Disposition: attachment; filename="contacts-import-template.csv"' );
            header( 'Pragma: no-cache' );
            $out = fopen( 'php://output', 'w' );
            fputcsv( $out, array( 'first_name', 'last_name', 'email', 'company', 'type', 'title', 'website', 'location', 'linkedin_url', 'tags', 'notes' ) );
            fputcsv( $out, array( 'Jane', 'Smith', 'jane@example.com', 'Example Studio', 'journalist', 'Senior Editor', 'https://publication.com', 'London, UK', 'https://linkedin.com/in/janesmith', 'architecture,design,sustainability', '' ) );
            fclose( $out );
            exit;
        }

        global $wpdb;
        $contacts = $wpdb->get_results(
            "SELECT first_name, last_name, email, company, type, title, website, location, linkedin_url, tags, status, source, notes, created_at
             FROM {$wpdb->prefix}oo_contacts ORDER BY created_at DESC",
            ARRAY_A
        );

        header( 'Content-Type: text/csv; charset=utf-8' );
        header( 'Content-Disposition: attachment; filename="contacts-' . date( 'Y-m-d' ) . '.csv"' );
        header( 'Pragma: no-cache' );

        $out = fopen( 'php://output', 'w' );
        fputcsv( $out, array( 'First Name', 'Last Name', 'Email', 'Company', 'Type', 'Title', 'Website', 'Location', 'LinkedIn', 'Tags', 'Status', 'Source', 'Notes', 'Added' ) );
        foreach ( $contacts as $row ) {
            $tag_arr     = json_decode( $row['tags'] ?? '[]', true );
            $row['tags'] = is_array( $tag_arr ) ? implode( ';', $tag_arr ) : ( $row['tags'] ?? '' );
            fputcsv( $out, $row );
        }
        fclose( $out );
        exit;
    }

    public function import_contacts_csv() {
        check_admin_referer( 'oo_import_contacts' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        if ( empty( $_FILES['csv_file']['tmp_name'] ) ) {
            wp_redirect( admin_url( 'admin.php?page=oo-contacts&import_error=no_file' ) );
            exit;
        }

        $file = $_FILES['csv_file']['tmp_name'];
        $handle = fopen( $file, 'r' );
        if ( ! $handle ) {
            wp_redirect( admin_url( 'admin.php?page=oo-contacts&import_error=unreadable' ) );
            exit;
        }

        // Read header row and normalise to lowercase keys
        $raw_headers = fgetcsv( $handle );
        if ( ! $raw_headers ) {
            fclose( $handle );
            wp_redirect( admin_url( 'admin.php?page=oo-contacts&import_error=empty' ) );
            exit;
        }
        $headers = array_map( function( $h ) {
            return strtolower( trim( str_replace( array( ' ', '-' ), '_', $h ) ) );
        }, $raw_headers );

        // Map common header name variants to our field names
        $field_map = array(
            'first_name'   => array( 'first_name', 'firstname', 'first' ),
            'last_name'    => array( 'last_name', 'lastname', 'last', 'surname' ),
            'email'        => array( 'email', 'email_address', 'emailaddress' ),
            'company'      => array( 'company', 'company_name', 'organisation', 'organization', 'practice', 'firm', 'publication', 'outlet' ),
            'type'         => array( 'type', 'contact_type', 'beat', 'category' ),
            'title'        => array( 'title', 'job_title', 'jobtitle', 'position', 'role' ),
            'website'      => array( 'website', 'site', 'url', 'web' ),
            'location'     => array( 'location', 'city', 'region', 'country' ),
            'linkedin_url' => array( 'linkedin_url', 'linkedin', 'linkedin_profile' ),
            'tags'         => array( 'tags', 'tag', 'topics', 'beats', 'segments', 'lists' ),
            'notes'        => array( 'notes', 'note', 'comments' ),
        );

        // Build column index map
        $col = array();
        foreach ( $field_map as $field => $variants ) {
            foreach ( $variants as $variant ) {
                $idx = array_search( $variant, $headers );
                if ( $idx !== false ) {
                    $col[ $field ] = $idx;
                    break;
                }
            }
        }

        if ( ! isset( $col['email'] ) ) {
            fclose( $handle );
            wp_redirect( admin_url( 'admin.php?page=oo-contacts&import_error=no_email_column' ) );
            exit;
        }

        global $wpdb;
        $table    = $wpdb->prefix . 'oo_contacts';
        $inserted = 0;
        $skipped  = 0;
        $valid_types = array_keys( OO_Database::get_contact_types() );

        while ( ( $row = fgetcsv( $handle ) ) !== false ) {
            $get = function( $field ) use ( $row, $col ) {
                return isset( $col[ $field ] ) ? sanitize_text_field( trim( $row[ $col[ $field ] ] ?? '' ) ) : '';
            };

            $email = sanitize_email( $get( 'email' ) );
            if ( ! is_email( $email ) ) { $skipped++; continue; }

            // Skip duplicates
            $exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE email = %s", $email ) );
            if ( $exists ) { $skipped++; continue; }

            $type = $get( 'type' );
            if ( ! in_array( $type, $valid_types, true ) ) $type = '';

            // Normalise tags from CSV: split on comma/semicolon, lowercase, dedupe
            $raw_tags_csv = $get( 'tags' );
            $tag_arr      = array_values( array_unique( array_filter( array_map(
                fn( $t ) => strtolower( trim( $t ) ),
                preg_split( '/[\s,;]+/', $raw_tags_csv )
            ) ) ) );

            $wpdb->insert( $table, array(
                'first_name'   => $get( 'first_name' ),
                'last_name'    => $get( 'last_name' ),
                'email'        => $email,
                'company'      => $get( 'company' ),
                'type'         => $type,
                'title'        => $get( 'title' ),
                'website'      => esc_url_raw( $get( 'website' ) ),
                'location'     => $get( 'location' ),
                'linkedin_url' => esc_url_raw( $get( 'linkedin_url' ) ),
                'tags'         => wp_json_encode( $tag_arr ),
                'notes'        => $get( 'notes' ),
                'source'       => 'CSV Import',
                'status'       => 'active',
                'created_at'   => current_time( 'mysql' ),
            ) );
            $inserted++;
        }

        fclose( $handle );
        wp_redirect( admin_url( 'admin.php?page=oo-contacts&imported=' . $inserted . '&skipped=' . $skipped ) );
        exit;
    }

    public function duplicate_campaign() {
        check_admin_referer( 'oo_duplicate_campaign' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $id = intval( $_POST['campaign_id'] ?? 0 );
        if ( ! $id ) wp_redirect( admin_url( 'admin.php?page=oo-campaigns' ) );

        $original = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_campaigns WHERE id = %d", $id
        ) );
        if ( ! $original ) wp_redirect( admin_url( 'admin.php?page=oo-campaigns' ) );

        // Insert copy of campaign as a fresh draft
        $wpdb->insert( $wpdb->prefix . 'oo_campaigns', array(
            'name'                 => 'Copy of ' . $original->name,
            'brand'                => $original->brand,
            'type'                 => $original->type,
            'status'               => 'draft',
            'from_name'            => $original->from_name,
            'from_email'           => $original->from_email,
            'reply_to'             => $original->reply_to,
            'sending_domain'       => $original->sending_domain,
            'audience_description' => $original->audience_description,
            'audience_filters'     => $original->audience_filters,
            'claude_prompt'        => $original->claude_prompt,
            'coupon_url'           => $original->coupon_url,
            'coupon_field'         => $original->coupon_field,
            'press_release_url'    => $original->press_release_url,
        ) );
        $new_id = $wpdb->insert_id;

        // Copy email sequences
        $sequences = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}oo_sequences WHERE campaign_id = %d ORDER BY step_number ASC", $id
        ) );
        foreach ( $sequences as $seq ) {
            $wpdb->insert( $wpdb->prefix . 'oo_sequences', array(
                'campaign_id' => $new_id,
                'step_number' => $seq->step_number,
                'subject'     => $seq->subject,
                'body'        => $seq->body,
                'delay_days'  => $seq->delay_days,
                'status'      => $seq->status,
            ) );
        }

        wp_redirect( admin_url( 'admin.php?page=oo-campaigns&action=wizard&id=' . $new_id . '&duplicated=1' ) );
        exit;
    }

    public function save_press_release() {
        check_admin_referer( 'oo_save_press_release' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $data = array(
            'title'  => sanitize_text_field( $_POST['title'] ?? '' ),
            'url'    => esc_url_raw( $_POST['url'] ?? '' ),
            'status' => sanitize_text_field( $_POST['status'] ?? 'draft' ),
        );
        $id = intval( $_POST['pr_id'] ?? 0 );
        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_press_releases', $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $wpdb->prefix . 'oo_press_releases', $data );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-press&saved=1' ) );
        exit;
    }

    // ── Editorial Log ──────────────────────────────────────

    public function save_editorial_entry() {
        check_admin_referer( 'oo_save_editorial_entry' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $outlet_id  = $this->resolve_outlet_by_name( sanitize_text_field( $_POST['publication'] ?? '' ) );
        $contact_id = $this->resolve_contact_by_name(
            sanitize_text_field( $_POST['press_contact'] ?? '' ),
            $outlet_id
        );

        $statuses = OO_Database::get_editorial_statuses();
        $status   = sanitize_text_field( $_POST['status'] ?? 'pitched' );
        if ( ! isset( $statuses[ $status ] ) ) $status = 'pitched';

        $data = array(
            'client'        => sanitize_text_field( $_POST['client'] ?? '' ),
            'story_title'   => sanitize_text_field( $_POST['story_title'] ?? '' ),
            'contact_id'    => $contact_id ?: null,
            'outlet_id'     => $outlet_id ?: null,
            'country'       => sanitize_text_field( $_POST['country'] ?? '' ),
            'status'        => $status,
            'pitch_request' => sanitize_textarea_field( $_POST['pitch_request'] ?? '' ),
            'request_date'  => $this->parse_date( $_POST['request_date'] ?? '' ),
            'interview_date'=> $this->parse_date( $_POST['interview_date'] ?? '' ),
            'issue_date'    => $this->parse_date( $_POST['issue_date'] ?? '' ),
            'story_url'     => esc_url_raw( $_POST['story_url'] ?? '' ),
            'notes_outcome' => sanitize_textarea_field( $_POST['notes_outcome'] ?? '' ),
        );

        $id = intval( $_POST['entry_id'] ?? 0 );
        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_editorial_log', $data, array( 'id' => $id ) );
        } else {
            $data['source'] = 'manual';
            $wpdb->insert( $wpdb->prefix . 'oo_editorial_log', $data );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-pr&saved=1' ) );
        exit;
    }

    public function delete_editorial_entry() {
        check_admin_referer( 'oo_delete_editorial_entry' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        global $wpdb;
        $id = intval( $_POST['entry_id'] ?? 0 );
        if ( $id ) $wpdb->delete( $wpdb->prefix . 'oo_editorial_log', array( 'id' => $id ) );
        wp_redirect( admin_url( 'admin.php?page=oo-pr&deleted=1' ) );
        exit;
    }

    /**
     * Import October's exported editorial log CSV. Columns:
     * Story Title, Client, Country, Interview Date, Issue Date, Link to story,
     * Notes / Outcome, Pitch / Request, Press Contact, Publication name,
     * Request Date, Status. Notion relations arrive as "Name (https://…)".
     */
    public function import_editorial_log() {
        check_admin_referer( 'oo_import_editorial_log' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        if ( empty( $_FILES['csv_file']['tmp_name'] ) ) {
            wp_redirect( admin_url( 'admin.php?page=oo-pr&import_error=no_file' ) );
            exit;
        }
        $handle = fopen( $_FILES['csv_file']['tmp_name'], 'r' );
        if ( ! $handle ) {
            wp_redirect( admin_url( 'admin.php?page=oo-pr&import_error=unreadable' ) );
            exit;
        }

        $raw_headers = fgetcsv( $handle );
        if ( ! $raw_headers ) {
            fclose( $handle );
            wp_redirect( admin_url( 'admin.php?page=oo-pr&import_error=empty' ) );
            exit;
        }
        // Normalise headers → lowercase, strip non-alphanumerics for matching.
        $norm = array();
        foreach ( $raw_headers as $i => $h ) {
            $norm[ $i ] = preg_replace( '/[^a-z0-9]/', '', strtolower( $h ) );
        }
        $find = function( $key ) use ( $norm ) {
            $idx = array_search( $key, $norm, true );
            return $idx === false ? null : $idx;
        };
        $col = array(
            'story_title'   => $find( 'storytitle' ),
            'client'        => $find( 'client' ),
            'country'       => $find( 'country' ),
            'interview'     => $find( 'interviewdate' ),
            'issue'         => $find( 'issuedate' ),
            'link'          => $find( 'linktostory' ),
            'notes'         => $find( 'notesoutcome' ),
            'pitch'         => $find( 'pitchrequest' ),
            'press_contact' => $find( 'presscontact' ),
            'publication'   => $find( 'publicationname' ),
            'request'       => $find( 'requestdate' ),
            'status'        => $find( 'status' ),
        );

        $status_map = array(
            'pitched' => 'pitched', 'pending' => 'pending', 'noresponse' => 'no_response',
            'confirmed' => 'confirmed', 'interviewprep' => 'interview_prep',
            'download' => 'download', 'published' => 'published', 'declined' => 'declined',
        );

        global $wpdb;
        $table    = $wpdb->prefix . 'oo_editorial_log';
        $imported = 0;
        $get = function( $row, $key ) use ( $col ) {
            $i = $col[ $key ] ?? null;
            return $i === null ? '' : trim( (string) ( $row[ $i ] ?? '' ) );
        };

        while ( ( $row = fgetcsv( $handle ) ) !== false ) {
            $title       = $this->strip_notion_ref( $get( $row, 'story_title' ) );
            $publication = $this->strip_notion_ref( $get( $row, 'publication' ) );
            $contact     = $this->strip_notion_ref( $get( $row, 'press_contact' ) );
            $client      = $get( $row, 'client' );
            // Skip wholly empty lines.
            if ( ! $title && ! $publication && ! $contact && ! $client ) continue;

            $outlet_id  = $publication ? $this->resolve_outlet_by_name( $publication ) : null;
            $contact_id = $contact ? $this->resolve_contact_by_name( $contact, $outlet_id ) : null;

            $status_key = preg_replace( '/[^a-z]/', '', strtolower( $get( $row, 'status' ) ) );
            $status     = $status_map[ $status_key ] ?? 'pitched';

            $wpdb->insert( $table, array(
                'client'        => sanitize_text_field( $client ),
                'story_title'   => sanitize_text_field( $title ),
                'contact_id'    => $contact_id ?: null,
                'outlet_id'     => $outlet_id ?: null,
                'country'       => sanitize_text_field( $get( $row, 'country' ) ),
                'status'        => $status,
                'pitch_request' => sanitize_textarea_field( $get( $row, 'pitch' ) ),
                'request_date'  => $this->parse_date( $get( $row, 'request' ) ),
                'interview_date'=> $this->parse_date( $get( $row, 'interview' ) ),
                'issue_date'    => $this->parse_date( $get( $row, 'issue' ) ),
                'story_url'     => esc_url_raw( $this->strip_notion_ref( $get( $row, 'link' ), true ) ),
                'notes_outcome' => sanitize_textarea_field( $get( $row, 'notes' ) ),
                'source'        => 'notion-import',
            ) );
            $imported++;
        }
        fclose( $handle );
        wp_redirect( admin_url( 'admin.php?page=oo-pr&imported=' . $imported ) );
        exit;
    }

    // ── Editorial Log helpers ──────────────────────────────

    /**
     * Notion exports relations as "Label (https://notion.so/…)". Return the
     * label, or — when $want_url — the URL inside the parentheses.
     */
    private function strip_notion_ref( $value, $want_url = false ) {
        $value = trim( (string) $value );
        if ( $value === '' ) return '';
        if ( preg_match( '/^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/', $value, $m ) ) {
            return $want_url ? trim( $m[2] ) : trim( $m[1] );
        }
        // Bare URL with no label.
        if ( $want_url ) {
            return preg_match( '/^https?:\/\//', $value ) ? $value : '';
        }
        return $value;
    }

    private function parse_date( $value ) {
        $value = trim( (string) $value );
        if ( $value === '' ) return null;
        $ts = strtotime( $value );
        return $ts ? gmdate( 'Y-m-d', $ts ) : null;
    }

    /**
     * Resolve an outlet name to an id — alias-aware (won't recreate a known
     * duplicate), creating it only if genuinely new. Delegates to OO_Dedup.
     */
    private function resolve_outlet_by_name( $name ) {
        return OO_Dedup::resolve_outlet( $name );
    }

    /**
     * Import the Master Publications CSV (single "Publication Name" column).
     * Each name runs through the alias-aware resolver, so it folds into the
     * deduped set rather than re-creating known duplicates.
     */
    public function import_publications() {
        check_admin_referer( 'oo_import_publications' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        if ( empty( $_FILES['csv_file']['tmp_name'] ) ) {
            wp_redirect( admin_url( 'admin.php?page=oo-media&import_error=no_file' ) );
            exit;
        }
        $handle = fopen( $_FILES['csv_file']['tmp_name'], 'r' );
        if ( ! $handle ) { wp_redirect( admin_url( 'admin.php?page=oo-media&import_error=unreadable' ) ); exit; }

        $headers = fgetcsv( $handle );
        // Find a "publication name" column; default to the first column.
        $idx = 0;
        foreach ( (array) $headers as $i => $h ) {
            if ( strpos( preg_replace( '/[^a-z]/', '', strtolower( $h ) ), 'publication' ) !== false ) { $idx = $i; break; }
        }

        $imported = 0;
        while ( ( $row = fgetcsv( $handle ) ) !== false ) {
            $name = trim( (string) ( $row[ $idx ] ?? '' ) );
            if ( $name === '' ) continue;
            if ( OO_Dedup::resolve_outlet( $name ) ) $imported++;
        }
        fclose( $handle );
        wp_redirect( admin_url( 'admin.php?page=oo-media&pub_imported=' . $imported ) );
        exit;
    }

    /**
     * Import the Master Press Contact CSV:
     * Name, Articles, Bio Link, Email, Last Contacted, Location, Publication.
     * Publications resolve to outlets; contacts resolve by email then name
     * (enriching log-import placeholders) via OO_Dedup.
     */
    public function import_press_contacts() {
        check_admin_referer( 'oo_import_press_contacts' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        if ( empty( $_FILES['csv_file']['tmp_name'] ) ) {
            wp_redirect( admin_url( 'admin.php?page=oo-media&import_error=no_file' ) );
            exit;
        }
        $handle = fopen( $_FILES['csv_file']['tmp_name'], 'r' );
        if ( ! $handle ) { wp_redirect( admin_url( 'admin.php?page=oo-media&import_error=unreadable' ) ); exit; }

        $raw = fgetcsv( $handle );
        if ( ! $raw ) { fclose( $handle ); wp_redirect( admin_url( 'admin.php?page=oo-media&import_error=empty' ) ); exit; }
        $norm = array();
        foreach ( $raw as $i => $h ) $norm[ $i ] = preg_replace( '/[^a-z0-9]/', '', strtolower( $h ) );
        $find = function( $k ) use ( $norm ) { $i = array_search( $k, $norm, true ); return $i === false ? null : $i; };
        $col = array(
            'name'        => $find( 'name' ),
            'bio'         => $find( 'biolink' ),
            'email'       => $find( 'email' ),
            'last'        => $find( 'lastcontacted' ),
            'location'    => $find( 'location' ),
            'publication' => $find( 'publication' ),
        );
        $get = function( $row, $key ) use ( $col ) {
            $i = $col[ $key ] ?? null;
            return $i === null ? '' : trim( (string) ( $row[ $i ] ?? '' ) );
        };

        $imported = 0;
        while ( ( $row = fgetcsv( $handle ) ) !== false ) {
            $name = $this->strip_notion_ref( $get( $row, 'name' ) );
            if ( $name === '' ) continue;
            $parts = preg_split( '/\s+/', $name, 2 );

            $publication = $this->strip_notion_ref( $get( $row, 'publication' ) );
            $outlet_id   = $publication ? OO_Dedup::resolve_outlet( $publication ) : 0;

            OO_Dedup::resolve_contact( array(
                'first_name'     => $parts[0] ?? '',
                'last_name'      => $parts[1] ?? '',
                'email'          => $get( $row, 'email' ),
                'location'       => $get( $row, 'location' ),
                'bio_link'       => $this->strip_notion_ref( $get( $row, 'bio' ), true ) ?: $get( $row, 'bio' ),
                'last_contacted' => $this->parse_date( $get( $row, 'last' ) ),
                'outlet_id'      => $outlet_id,
                'company'        => $publication,
                'source'         => 'Master Contacts import',
            ) );
            $imported++;
        }
        fclose( $handle );
        wp_redirect( admin_url( 'admin.php?page=oo-media&con_imported=' . $imported ) );
        exit;
    }

    // ── Clients (portal + reports) ─────────────────────────

    /** Generate a unique unguessable portal token. */
    private function unique_client_token() {
        global $wpdb;
        do {
            $token = strtolower( wp_generate_password( 24, false, false ) );
            $exists = $wpdb->get_var( $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oo_clients WHERE token = %s", $token
            ) );
        } while ( $exists );
        return $token;
    }

    public function save_client() {
        check_admin_referer( 'oo_save_client' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $cadences = array( 'off', 'weekly', 'monthly' );
        $cadence  = sanitize_text_field( $_POST['report_cadence'] ?? 'off' );
        if ( ! in_array( $cadence, $cadences, true ) ) $cadence = 'off';

        $data = array(
            'name'           => sanitize_text_field( $_POST['name'] ?? '' ),
            'alert_email'    => sanitize_email( $_POST['alert_email'] ?? '' ),
            'report_cadence' => $cadence,
        );
        if ( $data['name'] === '' ) {
            wp_redirect( admin_url( 'admin.php?page=oo-clients&error=name' ) );
            exit;
        }

        $id = intval( $_POST['client_id'] ?? 0 );
        if ( $id ) {
            $wpdb->update( $wpdb->prefix . 'oo_clients', $data, array( 'id' => $id ) );
        } else {
            $data['token'] = $this->unique_client_token();
            $wpdb->insert( $wpdb->prefix . 'oo_clients', $data );
        }
        wp_redirect( admin_url( 'admin.php?page=oo-clients&saved=1' ) );
        exit;
    }

    public function delete_client() {
        check_admin_referer( 'oo_delete_client' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        global $wpdb;
        $id = intval( $_POST['client_id'] ?? 0 );
        if ( $id ) $wpdb->delete( $wpdb->prefix . 'oo_clients', array( 'id' => $id ) );
        wp_redirect( admin_url( 'admin.php?page=oo-clients&deleted=1' ) );
        exit;
    }

    /** Create client records (with tokens) for every distinct client in the log. */
    public function sync_clients() {
        check_admin_referer( 'oo_sync_clients' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $names = $wpdb->get_col( "SELECT DISTINCT client FROM {$wpdb->prefix}oo_editorial_log WHERE client != ''" );
        $created = 0;
        foreach ( $names as $name ) {
            $exists = $wpdb->get_var( $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oo_clients WHERE name = %s", $name
            ) );
            if ( $exists ) continue;
            $wpdb->insert( $wpdb->prefix . 'oo_clients', array(
                'name'  => sanitize_text_field( $name ),
                'token' => $this->unique_client_token(),
            ) );
            $created++;
        }
        wp_redirect( admin_url( 'admin.php?page=oo-clients&synced=' . $created ) );
        exit;
    }

    /**
     * Find/create a media contact by name (+ optional outlet). Delegates to the
     * shared OO_Dedup resolver so the editorial-log and master-contact imports
     * converge on one record per journalist instead of duplicating.
     */
    private function resolve_contact_by_name( $name, $outlet_id = 0 ) {
        $name = trim( $name );
        if ( $name === '' ) return 0;
        $parts = preg_split( '/\s+/', $name, 2 );

        $company = '';
        if ( $outlet_id ) {
            global $wpdb;
            $company = (string) $wpdb->get_var( $wpdb->prepare(
                "SELECT name FROM {$wpdb->prefix}oo_outlets WHERE id = %d", $outlet_id
            ) );
        }

        return OO_Dedup::resolve_contact( array(
            'first_name' => $parts[0] ?? '',
            'last_name'  => $parts[1] ?? '',
            'outlet_id'  => $outlet_id,
            'company'    => $company,
            'source'     => 'Editorial Log import',
        ) );
    }
}
