<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Central registry of every post type the plugin works with.
 *
 * Two of the listing types — events and volunteers — are already managed on the
 * live site as JetEngine CPTs (`events`, `volunteer`) with real data and
 * Elementor listings. Per the agreed architecture we ADOPT those: they are
 * flagged `external => true` and are NOT registered by this plugin (JetEngine
 * owns registration). We only attach the shared ADF meta and the submission /
 * payment / email logic on top.
 *
 * Everything else is registered fresh here with an `adf_` slug so it can never
 * collide with JetEngine.
 */
final class PostTypes {

    private static ?PostTypes $instance = null;

    /**
     * The canonical map of listing-type key => configuration.
     *
     *   slug      WordPress post type slug actually used in the DB.
     *   external  True when another plugin (JetEngine) registers the CPT and we
     *             merely adopt it. We register a minimal fallback only if it is
     *             genuinely absent (e.g. a dev box without JetEngine).
     *   listing   True for the six public "listing" types that flow through the
     *             shared submission / approval / payment pipeline.
     *   label     Human label (singular).
     */
    public const TYPES = [
        'directory'   => ['slug' => 'adf_directory',   'external' => false, 'listing' => true,  'label' => 'Directory'],
        'destination' => ['slug' => 'adf_destination', 'external' => false, 'listing' => true,  'label' => 'Destination'],
        'product'     => ['slug' => 'adf_product',     'external' => false, 'listing' => true,  'label' => 'Product'],
        'event'       => ['slug' => 'events',          'external' => true,  'listing' => true,  'label' => 'Event'],
        'story'       => ['slug' => 'adf_story',       'external' => false, 'listing' => true,  'label' => 'Story'],
        // Ads are handled by the standalone oc-ad-manager plugin, not here.
        // Supporting records (not public listings, not in the approval queue).
        // Tickets/orders are relational tables (see ADF\Ticketing), not a CPT.
        'account'     => ['slug' => 'adf_account',     'external' => false, 'listing' => false, 'label' => 'Account'],
        'volunteer'   => ['slug' => 'volunteer',       'external' => true,  'listing' => false, 'label' => 'Volunteer'],
    ];

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        // Register our own CPTs early; adopt external ones late so JetEngine wins.
        add_action('init', [$this, 'register_owned'], 10);
        add_action('init', [$this, 'register_external_fallbacks'], 20);
    }

    /**
     * Resolve a listing-type key to its real post type slug.
     */
    public static function slug(string $type): string {
        return self::TYPES[$type]['slug'] ?? '';
    }

    /**
     * Reverse lookup: real slug => listing-type key.
     */
    public static function type_for_slug(string $slug): string {
        foreach (self::TYPES as $key => $cfg) {
            if ($cfg['slug'] === $slug) {
                return $key;
            }
        }
        return '';
    }

    /**
     * The listing-type keys that flow through the shared approval pipeline.
     *
     * @return string[]
     */
    public static function listing_types(): array {
        return array_keys(array_filter(self::TYPES, static fn($c) => $c['listing']));
    }

    /**
     * Slugs that should be touched by the shared-meta layer (every listing type,
     * including the adopted external ones).
     *
     * @return string[]
     */
    public static function listing_slugs(): array {
        return array_map(static fn($k) => self::slug($k), self::listing_types());
    }

    /**
     * Register the CPTs this plugin owns.
     */
    public function register_owned(): void {
        $supports_default = ['title', 'editor', 'thumbnail', 'author'];

        register_post_type(self::slug('directory'), $this->args('Directory', 'Directory Listings', 'dashicons-businessperson', $supports_default));
        register_post_type(self::slug('destination'), $this->args('Destination', 'Destinations', 'dashicons-location', $supports_default));
        register_post_type(self::slug('product'), $this->args('Product', 'Products', 'dashicons-products', $supports_default));
        register_post_type(self::slug('story'), $this->args('Story', 'Stories', 'dashicons-edit-page', $supports_default));

        // Supporting records: not publicly queryable.
        register_post_type(self::slug('account'), $this->args('Account', 'Accounts', 'dashicons-id', ['title', 'author'], false));
    }

    /**
     * Only register a minimal stand-in for an adopted external CPT when it is
     * genuinely missing — e.g. a development environment without JetEngine.
     * On production JetEngine has already registered `events`/`volunteer` by the
     * time this priority-20 callback runs, so these are no-ops there.
     */
    public function register_external_fallbacks(): void {
        foreach (self::TYPES as $cfg) {
            if (! $cfg['external']) {
                continue;
            }
            if (post_type_exists($cfg['slug'])) {
                continue; // JetEngine owns it — adopt as-is.
            }
            register_post_type($cfg['slug'], $this->args(
                $cfg['label'],
                $cfg['label'] . 's',
                'dashicons-calendar-alt',
                ['title', 'editor', 'thumbnail', 'author']
            ));
        }
    }

    /**
     * Build a sane register_post_type() argument array.
     */
    private function args(string $singular, string $plural, string $icon, array $supports, bool $public = true): array {
        return [
            'labels' => [
                'name'          => $plural,
                'singular_name' => $singular,
                'menu_name'     => $plural,
                'add_new_item'  => sprintf('Add %s', $singular),
                'edit_item'     => sprintf('Edit %s', $singular),
                'search_items'  => sprintf('Search %s', $plural),
            ],
            'public'              => $public,
            'publicly_queryable'  => $public,
            'show_ui'             => true,
            // Our records are surfaced through the ADF admin menu, not their own.
            'show_in_menu'        => false,
            'show_in_rest'        => true,
            'has_archive'         => $public,
            'hierarchical'        => false,
            'supports'            => $supports,
            'menu_icon'           => $icon,
            'rewrite'             => $public ? ['slug' => 'adf-' . sanitize_title($plural)] : false,
        ];
    }
}
