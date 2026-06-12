<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Account model (§1.2 `oe_account`).
 *
 * Each account is an `oe_account` post linked to a wp_user. Holds the
 * auto-approve flags, Stripe customer id and contact details, and drives the
 * `account_welcome` Brevo email on creation.
 */
final class Account {

    private static ?Account $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        // Provision an account record the first time a user needs one.
        add_action('user_register', [$this, 'maybe_create_for_user']);
    }

    public static function slug(): string {
        return PostTypes::slug('account');
    }

    /**
     * Find the account post id for a wp_user, or 0.
     */
    public static function for_user(int $wp_user_id): int {
        $found = get_posts([
            'post_type'      => self::slug(),
            'post_status'    => 'any',
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_key'       => '_oe_wp_user_id',
            'meta_value'     => $wp_user_id,
            'no_found_rows'  => true,
        ]);
        return $found ? (int) $found[0] : 0;
    }

    /**
     * Get-or-create an account for the current/given user.
     */
    public static function ensure(int $wp_user_id): int {
        $existing = self::for_user($wp_user_id);
        if ($existing) {
            return $existing;
        }
        return self::create($wp_user_id);
    }

    public function maybe_create_for_user(int $wp_user_id): void {
        if (! self::for_user($wp_user_id)) {
            self::create($wp_user_id);
        }
    }

    public static function create(int $wp_user_id): int {
        $user = get_userdata($wp_user_id);
        if (! $user) {
            return 0;
        }

        $name = trim($user->first_name . ' ' . $user->last_name) ?: $user->display_name;
        $post_id = wp_insert_post([
            'post_type'   => self::slug(),
            'post_status' => 'publish',
            'post_title'  => $name ?: $user->user_login,
            'post_author' => $wp_user_id,
        ], true);

        if (is_wp_error($post_id)) {
            Logger::log('Account create failed', ['error' => $post_id->get_error_message()]);
            return 0;
        }

        $defaults = [
            '_oe_wp_user_id'       => $wp_user_id,
            '_oe_organisation_name'=> '',
            '_oe_contact_name'     => $name,
            '_oe_email'            => $user->user_email,
            '_oe_phone'            => '',
            '_oe_billing_address'  => '',
            '_oe_stripe_customer_id'=> '',
            '_oe_auto_approve'     => 0,
            '_oe_auto_approve_types'=> [],
            '_oe_account_status'   => 'active',
            '_oe_created_date'     => current_time('mysql'),
        ];
        foreach ($defaults as $k => $v) {
            update_post_meta($post_id, $k, $v);
        }

        AuditLog::record('account_created', (int) $post_id, 'account');

        // Welcome email + subscribe to the all-subscribers list (§5).
        $lists = (array) Settings::get('brevo_lists', []);
        BrevoConnector::upsert_contact($user->user_email, [
            'FIRSTNAME' => $user->first_name,
            'LASTNAME'  => $user->last_name,
        ], isset($lists['oe_all_subscribers']) ? [(int) $lists['oe_all_subscribers']] : []);

        \OE\Mail\Contacts::capture($user->user_email, ['name' => $name, 'source' => 'account']);

        BrevoConnector::send('account_welcome', [
            'email' => $user->user_email,
            'name'  => $name,
        ], ['contact_name' => $name]);

        return (int) $post_id;
    }

    /**
     * Is auto-approve enabled for this account and listing type? (§3.2)
     */
    public static function auto_approves(int $account_id, string $listing_type): bool {
        if (! $account_id) {
            return false;
        }
        if ((string) get_post_meta($account_id, '_oe_account_status', true) === 'suspended') {
            return false;
        }
        if (! get_post_meta($account_id, '_oe_auto_approve', true)) {
            return false;
        }
        $types = (array) get_post_meta($account_id, '_oe_auto_approve_types', true);
        // An empty list means "all types".
        return $types === [] || in_array($listing_type, $types, true);
    }

    public static function email(int $account_id): string {
        return (string) get_post_meta($account_id, '_oe_email', true);
    }

    public static function name(int $account_id): string {
        return (string) get_post_meta($account_id, '_oe_contact_name', true) ?: get_the_title($account_id);
    }
}
