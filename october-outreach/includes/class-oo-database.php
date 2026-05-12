<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Database {

    public static function activate() {
        self::create_tables();
        self::set_defaults();
    }

    public static function deactivate() {
        wp_clear_scheduled_hook( 'oo_process_sequences' );
    }

    private static function create_tables() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        $contacts = "CREATE TABLE {$wpdb->prefix}oo_contacts (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            first_name varchar(100) NOT NULL DEFAULT '',
            last_name varchar(100) NOT NULL DEFAULT '',
            email varchar(200) NOT NULL,
            company varchar(200) NOT NULL DEFAULT '',
            type varchar(50) NOT NULL DEFAULT '',
            location varchar(200) NOT NULL DEFAULT '',
            linkedin_url varchar(500) NOT NULL DEFAULT '',
            source varchar(100) NOT NULL DEFAULT '',
            status varchar(50) NOT NULL DEFAULT 'active',
            notes text NOT NULL DEFAULT '',
            airtable_id varchar(100) NOT NULL DEFAULT '',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY email (email),
            KEY type (type),
            KEY status (status),
            KEY location (location)
        ) $charset;";

        $campaigns = "CREATE TABLE {$wpdb->prefix}oo_campaigns (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            name varchar(200) NOT NULL,
            brand varchar(100) NOT NULL DEFAULT '',
            type varchar(50) NOT NULL DEFAULT 'outreach',
            status varchar(50) NOT NULL DEFAULT 'draft',
            from_name varchar(200) NOT NULL DEFAULT '',
            from_email varchar(200) NOT NULL DEFAULT '',
            reply_to varchar(200) NOT NULL DEFAULT '',
            sending_domain varchar(200) NOT NULL DEFAULT '',
            audience_description text NOT NULL DEFAULT '',
            audience_filters longtext NOT NULL DEFAULT '',
            claude_prompt text NOT NULL DEFAULT '',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY status (status),
            KEY brand (brand),
            KEY type (type)
        ) $charset;";

        $sequences = "CREATE TABLE {$wpdb->prefix}oo_sequences (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) NOT NULL,
            step_number int(11) NOT NULL DEFAULT 1,
            subject varchar(500) NOT NULL DEFAULT '',
            body longtext NOT NULL DEFAULT '',
            delay_days int(11) NOT NULL DEFAULT 0,
            status varchar(50) NOT NULL DEFAULT 'active',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY campaign_id (campaign_id),
            KEY step_number (step_number)
        ) $charset;";

        $sends = "CREATE TABLE {$wpdb->prefix}oo_sends (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) NOT NULL,
            contact_id bigint(20) NOT NULL,
            sequence_id bigint(20) NOT NULL,
            status varchar(50) NOT NULL DEFAULT 'pending',
            scheduled_at datetime DEFAULT NULL,
            sent_at datetime DEFAULT NULL,
            opened_at datetime DEFAULT NULL,
            replied_at datetime DEFAULT NULL,
            bounced_at datetime DEFAULT NULL,
            message_id varchar(500) NOT NULL DEFAULT '',
            PRIMARY KEY (id),
            KEY campaign_id (campaign_id),
            KEY contact_id (contact_id),
            KEY status (status),
            KEY scheduled_at (scheduled_at)
        ) $charset;";

        $coupons = "CREATE TABLE {$wpdb->prefix}oo_coupons (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            campaign_id bigint(20) NOT NULL,
            code varchar(100) NOT NULL,
            label varchar(200) NOT NULL DEFAULT '',
            discount_type varchar(50) NOT NULL DEFAULT 'percent',
            discount_value decimal(10,2) NOT NULL DEFAULT 0,
            segment varchar(200) NOT NULL DEFAULT '',
            use_count int(11) NOT NULL DEFAULT 0,
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY code (code),
            KEY campaign_id (campaign_id)
        ) $charset;";

        $press_releases = "CREATE TABLE {$wpdb->prefix}oo_press_releases (
            id bigint(20) NOT NULL AUTO_INCREMENT,
            title varchar(500) NOT NULL DEFAULT '',
            url varchar(1000) NOT NULL DEFAULT '',
            summary text NOT NULL DEFAULT '',
            audience_defined text NOT NULL DEFAULT '',
            campaign_id bigint(20) DEFAULT NULL,
            status varchar(50) NOT NULL DEFAULT 'draft',
            created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) $charset;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta( $contacts );
        dbDelta( $campaigns );
        dbDelta( $sequences );
        dbDelta( $sends );
        dbDelta( $coupons );
        dbDelta( $press_releases );

        update_option( 'oo_db_version', OO_VERSION );
    }

    private static function set_defaults() {
        if ( ! get_option( 'oo_settings' ) ) {
            update_option( 'oo_settings', array(
                'license_key'        => '',
                'claude_api_key'     => '',
                'hunter_api_key'     => '',
                'airtable_api_key'   => '',
                'airtable_base_id'   => '',
                'ses_key'            => '',
                'ses_secret'         => '',
                'ses_region'         => 'eu-west-1',
                'default_reply_to'   => '',
            ) );
        }
    }

    public static function get_contact_types() {
        return array(
            'architect'          => 'Architect',
            'interior_designer'  => 'Interior Designer',
            'landscape_designer' => 'Landscape Designer',
            'hotel_designer'     => 'Hotel Designer',
            'journalist'         => 'Journalist',
            'property_developer' => 'Property Developer',
            'other'              => 'Other',
        );
    }

    public static function get_brands() {
        return array(
            'october_comms' => 'October Comms',
            'cubisly'        => 'Cubisly',
            'adf'            => 'Atlanta Design Festival',
            'lolo'           => 'Lolo',
            'nvelope'        => 'Nvelope',
            'press'          => 'Press / Media',
        );
    }

    public static function get_campaign_types() {
        return array(
            'outreach'      => 'Outreach',
            'event'         => 'Event Invitation',
            'press_release' => 'Press Release',
            'course'        => 'Course Signup',
            'product'       => 'Product / Service',
        );
    }
}
