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
        add_action( 'admin_post_oo_save_press_release', array( $this, 'save_press_release' ) );
        add_action( 'admin_post_oo_export_contacts', array( $this, 'export_contacts_csv' ) );
        add_action( 'admin_post_oo_import_contacts', array( $this, 'import_contacts_csv' ) );
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
        add_submenu_page( 'october-outreach', 'Campaigns',      'Campaigns',      'manage_options', 'oo-campaigns',     array( $this, 'page_campaigns' ) );
        add_submenu_page( 'october-outreach', 'Settings',       'Settings',       'manage_options', 'oo-settings',      array( $this, 'page_settings' ) );
        add_submenu_page( 'october-outreach', 'Help & Support', 'Help & Support', 'manage_options', 'oo-help',          array( $this, 'page_help' ) );
    }

    public function enqueue_assets( $hook ) {
        if ( ! $this->is_plugin_page() ) return;

        wp_enqueue_style( 'oo-app', OO_PLUGIN_URL . 'admin/css/app.css', array(), OO_VERSION );
        wp_enqueue_script( 'oo-app', OO_PLUGIN_URL . 'admin/js/admin.js', array( 'jquery' ), OO_VERSION, true );

        $screen = get_current_screen();
        if ( $screen && strpos( $screen->id, 'oo-campaigns' ) !== false && ( $_GET['action'] ?? '' ) === 'wizard' ) {
            wp_enqueue_script( 'oo-wizard', OO_PLUGIN_URL . 'admin/js/wizard.js', array( 'jquery' ), OO_VERSION, true );
        }
        if ( $screen && strpos( $screen->id, 'oo-contacts' ) !== false && ( $_GET['action'] ?? '' ) === 'finder' ) {
            wp_enqueue_script( 'oo-contact-finder', OO_PLUGIN_URL . 'admin/js/contact-finder.js', array( 'jquery' ), OO_VERSION, true );
        }

        wp_localize_script( 'oo-app', 'ooData', array(
            'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
            'nonce'        => wp_create_nonce( 'oo_nonce' ),
            'campaignsUrl' => admin_url( 'admin.php?page=oo-campaigns' ),
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

    public function page_press()    { $this->render( 'press',    'press' ); }
    public function page_settings() { $this->render( 'settings', 'settings' ); }
    public function page_help()     { $this->render( 'help',     'help' ); }

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
        update_option( 'oo_settings', $settings );
        wp_redirect( admin_url( 'admin.php?page=oo-settings&saved=1' ) );
        exit;
    }

    public function save_contact() {
        check_admin_referer( 'oo_save_contact' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );

        global $wpdb;
        $data = array(
            'first_name'   => sanitize_text_field( $_POST['first_name'] ?? '' ),
            'last_name'    => sanitize_text_field( $_POST['last_name'] ?? '' ),
            'email'        => sanitize_email( $_POST['email'] ?? '' ),
            'company'      => sanitize_text_field( $_POST['company'] ?? '' ),
            'type'         => sanitize_text_field( $_POST['type'] ?? '' ),
            'location'     => sanitize_text_field( $_POST['location'] ?? '' ),
            'linkedin_url' => esc_url_raw( $_POST['linkedin_url'] ?? '' ),
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
            fputcsv( $out, array( 'first_name', 'last_name', 'email', 'company', 'type', 'title', 'location', 'linkedin_url', 'notes' ) );
            fputcsv( $out, array( 'Jane', 'Smith', 'jane@example.com', 'Example Studio', 'architect', 'Principal Architect', 'London, UK', 'https://linkedin.com/in/janesmith', '' ) );
            fclose( $out );
            exit;
        }

        global $wpdb;
        $contacts = $wpdb->get_results(
            "SELECT first_name, last_name, email, company, type, location, status, source, notes, created_at
             FROM {$wpdb->prefix}oo_contacts ORDER BY created_at DESC",
            ARRAY_A
        );

        header( 'Content-Type: text/csv; charset=utf-8' );
        header( 'Content-Disposition: attachment; filename="contacts-' . date( 'Y-m-d' ) . '.csv"' );
        header( 'Pragma: no-cache' );

        $out = fopen( 'php://output', 'w' );
        fputcsv( $out, array( 'First Name', 'Last Name', 'Email', 'Company', 'Type', 'Location', 'Status', 'Source', 'Notes', 'Added' ) );
        foreach ( $contacts as $row ) {
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
            'company'      => array( 'company', 'company_name', 'organisation', 'organization', 'practice', 'firm' ),
            'type'         => array( 'type', 'contact_type' ),
            'title'        => array( 'title', 'job_title', 'jobtitle', 'position', 'role' ),
            'location'     => array( 'location', 'city', 'region' ),
            'linkedin_url' => array( 'linkedin_url', 'linkedin', 'linkedin_profile' ),
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

            $wpdb->insert( $table, array(
                'first_name'   => $get( 'first_name' ),
                'last_name'    => $get( 'last_name' ),
                'email'        => $email,
                'company'      => $get( 'company' ),
                'type'         => $type,
                'title'        => $get( 'title' ),
                'location'     => $get( 'location' ),
                'linkedin_url' => esc_url_raw( $get( 'linkedin_url' ) ),
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
}
