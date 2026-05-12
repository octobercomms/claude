<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Admin {

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'register_menus' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'admin_post_oo_save_settings', array( $this, 'save_settings' ) );
        add_action( 'admin_post_oo_save_contact', array( $this, 'save_contact' ) );
        add_action( 'admin_post_oo_delete_contact', array( $this, 'delete_contact' ) );
        add_action( 'admin_post_oo_save_campaign', array( $this, 'save_campaign' ) );
        add_action( 'admin_post_oo_delete_campaign', array( $this, 'delete_campaign' ) );
        add_action( 'admin_post_oo_save_press_release', array( $this, 'save_press_release' ) );
        add_action( 'admin_notices', array( $this, 'license_notice' ) );
    }

    public function register_menus() {
        add_menu_page(
            'October Outreach',
            'Outreach',
            'manage_options',
            'october-outreach',
            array( $this, 'page_dashboard' ),
            'dashicons-email-alt',
            30
        );

        add_submenu_page( 'october-outreach', 'Dashboard', 'Dashboard', 'manage_options', 'october-outreach', array( $this, 'page_dashboard' ) );
        add_submenu_page( 'october-outreach', 'Contacts', 'Contacts', 'manage_options', 'oo-contacts', array( $this, 'page_contacts' ) );
        add_submenu_page( 'october-outreach', 'Campaigns', 'Campaigns', 'manage_options', 'oo-campaigns', array( $this, 'page_campaigns' ) );
        add_submenu_page( 'october-outreach', 'Press Releases', 'Press Releases', 'manage_options', 'oo-press', array( $this, 'page_press' ) );
        add_submenu_page( 'october-outreach', 'Settings', 'Settings', 'manage_options', 'oo-settings', array( $this, 'page_settings' ) );
    }

    public function enqueue_assets( $hook ) {
        if ( strpos( $hook, 'october-outreach' ) === false && strpos( $hook, 'oo-' ) === false ) {
            return;
        }
        wp_enqueue_style( 'oo-admin', OO_PLUGIN_URL . 'admin/css/admin.css', array(), OO_VERSION );
        wp_enqueue_script( 'oo-admin', OO_PLUGIN_URL . 'admin/js/admin.js', array( 'jquery' ), OO_VERSION, true );
        wp_localize_script( 'oo-admin', 'ooData', array(
            'ajaxUrl' => admin_url( 'admin-ajax.php' ),
            'nonce'   => wp_create_nonce( 'oo_nonce' ),
        ) );
    }

    public function license_notice() {
        $screen = get_current_screen();
        if ( ! $screen || strpos( $screen->id, 'october-outreach' ) === false && strpos( $screen->id, 'oo-' ) === false ) {
            return;
        }
        if ( ! OO_License::is_active() ) {
            echo '<div class="notice notice-error"><p><strong>October Outreach:</strong> No active license. <a href="' . esc_url( admin_url( 'admin.php?page=oo-settings' ) ) . '">Enter your license key</a> to use this plugin.</p></div>';
        }
    }

    public function page_dashboard() {
        require_once OO_PLUGIN_DIR . 'admin/views/dashboard.php';
    }

    public function page_contacts() {
        require_once OO_PLUGIN_DIR . 'admin/views/contacts.php';
    }

    public function page_campaigns() {
        require_once OO_PLUGIN_DIR . 'admin/views/campaigns.php';
    }

    public function page_press() {
        require_once OO_PLUGIN_DIR . 'admin/views/press.php';
    }

    public function page_settings() {
        require_once OO_PLUGIN_DIR . 'admin/views/settings.php';
    }

    public function save_settings() {
        check_admin_referer( 'oo_save_settings' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        $settings = get_option( 'oo_settings', array() );
        $fields = array( 'license_key', 'claude_api_key', 'hunter_api_key', 'airtable_api_key', 'airtable_base_id', 'ses_key', 'ses_secret', 'ses_region', 'default_reply_to' );

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
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'oo_contacts';

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
            $wpdb->update( $table, $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $table, $data );
            $id = $wpdb->insert_id;
        }

        wp_redirect( admin_url( 'admin.php?page=oo-contacts&saved=1' ) );
        exit;
    }

    public function delete_contact() {
        check_admin_referer( 'oo_delete_contact' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        global $wpdb;
        $id = intval( $_POST['contact_id'] ?? 0 );
        if ( $id ) {
            $wpdb->delete( $wpdb->prefix . 'oo_contacts', array( 'id' => $id ) );
        }

        wp_redirect( admin_url( 'admin.php?page=oo-contacts&deleted=1' ) );
        exit;
    }

    public function save_campaign() {
        check_admin_referer( 'oo_save_campaign' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'oo_campaigns';

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
            $wpdb->update( $table, $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $table, $data );
            $id = $wpdb->insert_id;
        }

        wp_redirect( admin_url( 'admin.php?page=oo-campaigns&saved=1' ) );
        exit;
    }

    public function delete_campaign() {
        check_admin_referer( 'oo_delete_campaign' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        global $wpdb;
        $id = intval( $_POST['campaign_id'] ?? 0 );
        if ( $id ) {
            $wpdb->delete( $wpdb->prefix . 'oo_campaigns', array( 'id' => $id ) );
        }

        wp_redirect( admin_url( 'admin.php?page=oo-campaigns&deleted=1' ) );
        exit;
    }

    public function save_press_release() {
        check_admin_referer( 'oo_save_press_release' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Unauthorized' );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'oo_press_releases';

        $data = array(
            'title'  => sanitize_text_field( $_POST['title'] ?? '' ),
            'url'    => esc_url_raw( $_POST['url'] ?? '' ),
            'status' => sanitize_text_field( $_POST['status'] ?? 'draft' ),
        );

        $id = intval( $_POST['pr_id'] ?? 0 );

        if ( $id ) {
            $wpdb->update( $table, $data, array( 'id' => $id ) );
        } else {
            $wpdb->insert( $table, $data );
        }

        wp_redirect( admin_url( 'admin.php?page=oo-press&saved=1' ) );
        exit;
    }
}
