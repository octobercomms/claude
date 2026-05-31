<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_License {

    public static function is_active() {
        $settings = get_option( 'oo_settings', array() );
        $key = isset( $settings['license_key'] ) ? trim( $settings['license_key'] ) : '';
        return self::validate( $key );
    }

    public static function validate( $key ) {
        if ( empty( $key ) ) {
            return false;
        }

        // Master license always valid
        if ( $key === OO_MASTER_LICENSE ) {
            return true;
        }

        // Hook for future license server validation
        return apply_filters( 'oo_validate_license', false, $key );
    }

    public static function get_status_label() {
        if ( self::is_active() ) {
            $settings = get_option( 'oo_settings', array() );
            $key = trim( $settings['license_key'] );
            if ( $key === OO_MASTER_LICENSE ) {
                return array( 'status' => 'active', 'label' => 'Active — Master License', 'color' => 'green' );
            }
            return array( 'status' => 'active', 'label' => 'Active', 'color' => 'green' );
        }
        return array( 'status' => 'inactive', 'label' => 'Inactive — enter a license key', 'color' => 'red' );
    }

    public static function require_license() {
        if ( ! self::is_active() ) {
            wp_die(
                '<p>October Outreach requires an active license key. <a href="' . admin_url( 'admin.php?page=oo-settings' ) . '">Enter your license key</a>.</p>',
                'License Required',
                array( 'back_link' => true )
            );
        }
    }
}
