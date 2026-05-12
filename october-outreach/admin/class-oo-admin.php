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
    public function page_contacts()  { $this->render( 'contacts',  'contacts' ); }
    public function page_press()     { $this->render( 'press',     'press' ); }
    public function page_settings()  { $this->render( 'settings',  'settings' ); }
    public function page_help()      { $this->render( 'help',      'help' ); }

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
            'license_key', 'claude_api_key', 'hunter_api_key',
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
