<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Shared meta layer.
 *
 * Defines the fields every listing type carries (§1.1 of the brief) plus typed
 * get/set helpers. All ADF-managed meta keys are prefixed `_adf_` so they stay
 * out of the default Custom Fields UI and never clash with JetEngine's own meta
 * on the adopted `events` / `volunteer` CPTs.
 */
final class Fields {

    private static ?Fields $instance = null;

    public const PREFIX = '_adf_';

    /** Listing status values (§1.1). */
    public const STATUS_DRAFT           = 'draft';
    public const STATUS_PENDING_REVIEW  = 'pending_review';
    public const STATUS_APPROVED        = 'approved';
    public const STATUS_REJECTED        = 'rejected';
    public const STATUS_PENDING_PAYMENT = 'pending_payment';

    /** Paid tiers (§1.1). */
    public const TIER_FREE     = 'free';
    public const TIER_FEATURED = 'featured';
    public const TIER_PREMIUM  = 'premium';

    /**
     * Shared fields carried by every listing, with their REST/sanitise type.
     */
    public const SHARED = [
        'submitter_account_id'     => 'integer',
        'listing_type'             => 'string',
        'status'                   => 'string',
        'auto_approved'            => 'boolean',
        'paid_tier'                => 'string',
        'stripe_payment_intent_id' => 'string',
        'stripe_refund_id'         => 'string',
        'featured_in_email'        => 'boolean',
        'submission_date'          => 'string',
        'approval_date'            => 'string',
        'rejection_date'           => 'string',
    ];

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('init', [$this, 'register_meta'], 30);
    }

    /**
     * Fully-qualified meta key for a logical field name.
     */
    public static function key(string $field): string {
        return self::PREFIX . $field;
    }

    /**
     * Register the shared meta on every listing slug so it is REST-exposed
     * (Elementor / JetEngine listings and the dashboard read it via REST).
     */
    public function register_meta(): void {
        foreach (PostTypes::listing_slugs() as $slug) {
            foreach (self::SHARED as $field => $type) {
                register_post_meta($slug, self::key($field), [
                    'type'          => $type,
                    'single'        => true,
                    'show_in_rest'  => true,
                    'auth_callback' => static fn() => current_user_can('edit_posts'),
                ]);
            }
        }
    }

    /* ----------------------------------------------------------------------
     * Typed accessors
     * ------------------------------------------------------------------- */

    public static function get(int $post_id, string $field, $default = '') {
        $value = get_post_meta($post_id, self::key($field), true);
        if ($value === '' || $value === false) {
            return $default;
        }
        $type = self::SHARED[$field] ?? 'string';
        if ($type === 'integer') {
            return (int) $value;
        }
        if ($type === 'boolean') {
            return (bool) $value;
        }
        return $value;
    }

    public static function set(int $post_id, string $field, $value): void {
        $type = self::SHARED[$field] ?? 'string';
        if ($type === 'integer') {
            $value = (int) $value;
        } elseif ($type === 'boolean') {
            $value = $value ? 1 : 0;
        } elseif (is_scalar($value)) {
            $value = (string) $value;
        }
        update_post_meta($post_id, self::key($field), $value);
    }

    public static function status(int $post_id): string {
        return (string) self::get($post_id, 'status', self::STATUS_DRAFT);
    }

    public static function tier(int $post_id): string {
        return (string) self::get($post_id, 'paid_tier', self::TIER_FREE);
    }

    public static function is_paid(int $post_id): bool {
        return self::tier($post_id) !== self::TIER_FREE;
    }
}
