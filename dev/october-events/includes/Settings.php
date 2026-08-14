<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Typed access to plugin settings.
 *
 * API keys are read from wp-config.php constants first (never persisted to the
 * database, per §4/§5/§10), falling back to the options row for non-secret
 * configuration such as tier pricing, the rejection-email copy, AI source URLs
 * and the digest schedule.
 *
 * All option data lives under a single `oe_settings` row to keep wp_options
 * tidy; everything is `oe_`-prefixed as required by §10.
 */
final class Settings {

    public const OPTION = 'oe_settings';

    /** Map of logical key => wp-config.php constant for secrets. */
    private const SECRET_CONSTANTS = [
        'stripe_secret_key'      => 'OE_STRIPE_SECRET_KEY',
        'stripe_publishable_key' => 'OE_STRIPE_PUBLISHABLE_KEY',
        'stripe_webhook_secret'  => 'OE_STRIPE_WEBHOOK_SECRET',
        'paypal_client_secret'   => 'OE_PAYPAL_SECRET',
        'claude_api_key'         => 'OE_CLAUDE_API_KEY',
        'google_maps_key'        => 'OE_GOOGLE_MAPS_KEY',
        'ses_smtp_password'      => 'OE_SES_SMTP_PASSWORD',
        'aws_secret_access_key'  => 'OE_AWS_SECRET_ACCESS_KEY',
    ];

    public static function defaults(): array {
        return [
            // Per-site brand shown in the admin menu / UI (this plugin runs on
            // multiple sites — e.g. "Atlanta Design Festival", "Architecture Tours").
            'brand_name' => 'October Events',
            // Optional map: event field => an existing (e.g. JetEngine) meta key to
            // read when the plugin's own field is empty, so tickets/emails/reports
            // can resolve an event's date, price and location.
            'event_field_map' => [],
            // The post type that holds tour "locations" (an external JetEngine CPT
            // on the tours sites). When set, each location gets a one-click "Needs
            // volunteers" box that creates/links a volunteer opportunity. Blank = off.
            'location_post_type' => '',
            // On a SOURCE (tours) site: the meta keys on a location that hold its
            // street address and its date, so the partner feed can pass them to the
            // festival site's volunteer-post picker. Default to the tours schema's
            // own field names so it works with no config; override if yours differ.
            'location_address_field' => 'address',
            'location_date_field'    => 'date',
            // Partner volunteer feed (used on the FESTIVAL site): pull the tour
            // locations flagged "host on partner" from a tours site so they can be
            // picked when building a volunteer post here. Auth = an Application
            // Password on that site.
            'volunteer_feed_url'          => '',
            'volunteer_feed_user'         => '',
            'volunteer_feed_app_password' => '',
            'volunteer_feed_last_sync'    => 0,
            // Cached pickable tour locations pulled from the partner feed. Each:
            // { ref:"<site>#<id>", title, url, address, date, capacity, image }.
            'volunteer_feed_locations'    => [],
            // Role pre-filled when a volunteer post is linked to a tour location
            // (tour stops are docent-led). Blank = don't pre-fill.
            'location_default_role'       => 'Docent',
            // Per-listing-type, per-tier pricing in cents. Admin-editable (§4).
            'pricing' => [
                'directory'   => ['featured' => 9900,  'premium' => 19900],
                'destination' => ['featured' => 9900,  'premium' => 19900],
                'product'     => ['featured' => 7900,  'premium' => 14900],
                'event'       => ['featured' => 4900,  'premium' => 9900],
                'story'       => ['featured' => 0,     'premium' => 0],
                'ad'          => ['featured' => 29900, 'premium' => 49900],
            ],
            'currency'        => 'usd',
            // Card-processing fee used for the "gross profit after fees" figure on
            // the sales-analytics screen. Defaults to Stripe's standard 2.9% + 30¢
            // per transaction. Edit under Settings → Checkout.
            'card_fee_percent' => 2.9,
            'card_fee_fixed'   => 0.30,
            // "Pay over time" (BNPL — Klarna / Afterpay / Affirm) at ticket
            // checkout, via Stripe's hosted page. Off by default: enable the
            // methods in the Stripe Dashboard first, then turn this on. The card
            // checkout is unchanged either way.
            'bnpl_enabled'     => false,
            // PayPal — a second checkout gateway alongside Stripe (off until set up).
            'paypal_enabled'   => false,
            'paypal_env'       => 'sandbox',
            'paypal_client_id' => '',
            // Membership: the Stripe subscription price IDs (Friend/Patron,
            // monthly + yearly) that count as an active membership. Used to
            // detect members at checkout and offer member ticket rates. Off until
            // enabled and at least one price ID is set.
            'membership_enabled'    => false,
            'membership_price_ids'  => [],
            // The Stripe Payment Link (or any join URL) for the membership we
            // offer non-members at checkout — e.g. the Friend monthly plan. Shown
            // as the "Join to unlock this rate" button next to member-only tickets.
            'membership_join_url'   => '',
            // Label for the join offer button/plan (e.g. "Friend — $5/mo").
            'membership_join_label' => '',
            // The recurring Stripe PRICE id (price_…) to subscribe a joiner to when
            // they join with the same card at checkout (e.g. Friend monthly). When
            // set, the checkout offers one-click "join + buy at the member rate";
            // when blank, it falls back to the external join link above.
            'membership_join_price_id' => '',
            // First-month/display amount of the join plan, in the smallest currency
            // unit (e.g. 500 = $5.00), shown in the checkout summary. 0 = hide it.
            'membership_join_amount'   => 0,
            // Membership info page (benefits + terms), linked wherever a membership
            // is added at checkout, e.g. https://…/membership/. Shown as
            // "Read about Membership Benefits and Terms".
            'membership_info_url'      => '',
            // A few key benefit lines (one per entry) shown in the checkout upsell
            // card, lifted from the membership page. Empty = no bullet list.
            'membership_benefits'      => [],
            // Rejection email copy per listing type (§3.3). Empty => default.
            'rejection_copy'  => [],
            // AI Stories connector source URLs (RSS preferred) (§6).
            'ai_source_urls'  => [],
            'ai_model'        => 'claude-sonnet-4-20250514',
            // Editable "tone of voice" training for the AI Stories layer.
            'ai_voice_guide'  => '',
            'ai_examples'     => [],
            // Monthly digest — opt-in (default off). When on, it sends on the
            // first Monday of the month, at most once per month (see Cron).
            'digest_enabled'  => false,
            // Daily ticket sales report recipient (blank = site admin email).
            'report_email'    => '',
            // Volunteer reminders (email always; SMS via Brevo when enabled).
            'sms_enabled'      => false,
            'sms_sender'       => 'ADF',
            'reminder_offsets' => ['week', '48h', 'morning'],
            // GitHub self-updater (token may also be a wp-config constant).
            'github_repo'      => 'octobercomms/claude',
            'github_token'     => '',
            // Origins allowed to call the oe/v1 REST API cross-origin (the staff
            // platform SPA, hosted off-site). One per line; scheme + host, no
            // trailing slash. We send exactly one Access-Control-Allow-Origin.
            'platform_origins' => [
                'https://october-platform.pages.dev',
                'https://platform.atlantadesignfestival.net',
            ],
            // The staff platform's URL, for the "Open the platform" button in
            // wp-admin. Blank = use the first non-preview origin above.
            'platform_url' => '',
            // The front-end page where the [oe_checkin] scanner shortcode lives,
            // so staff can jump to it from the dashboard. Blank = no button.
            'checkin_page_url' => '',
            // Per-site theming (brand colours + logo) used by the ticket, the
            // confirmation email and the public oe/v1/brand endpoint. Empty = use
            // the built-in October defaults (Brockmann + brand yellow).
            'theme_accent'      => '', // e.g. #E7CD41
            'theme_accent_on'   => '', // text colour on the accent, e.g. #1a1a1a
            'theme_sidebar_bg'  => '', // e.g. #0b0b0c
            'theme_page_bg'     => '', // e.g. #faf9f5
            'theme_logo_light'  => '', // logo URL for light surfaces (login)
            'theme_logo_dark'   => '', // logo URL for the dark sidebar
            'theme_font_family' => '', // optional custom font family name
            'theme_font_css'    => '', // optional @font-face / Google Fonts URL
            'theme_font_url'    => '', // optional uploaded REGULAR-weight font file (woff2/woff/ttf/otf)
            'theme_font_url_bold' => '', // optional uploaded BOLD-weight font file (for headings)
            // Email — Amazon SES as the site's outgoing mail transport (phase 1
            // of the email platform). Off by default: until enabled + configured
            // the site keeps using its existing mail transport, unchanged.
            'ses_enabled'       => false,
            'ses_region'        => 'us-east-1',
            'ses_smtp_user'     => '',
            'ses_smtp_password' => '', // secret (or OE_SES_SMTP_PASSWORD constant)
            'mail_from_email'   => '',
            'mail_from_name'    => '',
            // Physical mailing address shown in campaign footers (CAN-SPAM).
            'mail_footer_address' => '',
            // SMS via AWS End User Messaging (off until configured). 10DLC needed in the US.
            'aws_access_key_id'     => '',
            'aws_secret_access_key' => '', // secret (or OE_AWS_SECRET_ACCESS_KEY)
            'sms_region'            => 'us-east-1',
            'sms_origination'       => '', // phone number (E.164), sender ID, or pool ARN
            // Public AI support chat — a floating widget that answers customers'
            // questions about their own (email-verified) orders and tickets.
            'support_chat_enabled'  => '0',
            // Live chat — paste a Chatwoot website token + base URL to inject the widget.
            'chatwoot_base_url'     => '',
            'chatwoot_token'        => '',
        ];
    }

    /**
     * Read a secret (wp-config.php constant first for security, then the value
     * entered in admin settings), or a non-secret config value.
     */
    /** In-process memo of the merged settings, so we don't rebuild the ~60-key
     *  defaults array on every get() (called ~20×/request via Brand + Features). */
    private static ?array $merged = null;

    private static function merged(): array {
        return self::$merged ??= wp_parse_args(get_option(self::OPTION, []), self::defaults());
    }

    public static function get(string $key, $default = null) {
        if (isset(self::SECRET_CONSTANTS[$key])) {
            $const = self::SECRET_CONSTANTS[$key];
            if (defined($const) && (string) constant($const) !== '') {
                return constant($const);
            }
            $all = self::merged();
            // Secrets are stored encrypted at rest (ADF-05); decrypt transparently.
            return Crypto::decrypt((string) ($all[$key] ?? ($default ?? '')));
        }
        $all = self::merged();
        return $all[$key] ?? $default;
    }

    /**
     * True when a secret is pinned by a wp-config.php constant (so the admin
     * field should be locked).
     */
    public static function secret_is_constant(string $key): bool {
        $const = self::SECRET_CONSTANTS[$key] ?? '';
        return $const !== '' && defined($const) && (string) constant($const) !== '';
    }

    /** Map of secret key => constant name (for the settings UI). */
    public static function secret_keys(): array {
        return self::SECRET_CONSTANTS;
    }

    public static function all(): array {
        return self::merged();
    }

    public static function update(array $values): void {
        $current = self::all();
        // Not autoloaded — it's a big option only read on plugin paths, not every
        // front-end request.
        update_option(self::OPTION, array_merge($current, $values), false);
        self::$merged = null; // bust the in-process memo
    }

    /**
     * Price in the smallest currency unit for a type/tier, 0 if free/unknown.
     */
    public static function price(string $type, string $tier): int {
        if ($tier === Fields::TIER_FREE) {
            return 0;
        }
        $pricing = self::get('pricing', []);
        return (int) ($pricing[$type][$tier] ?? 0);
    }

    public static function has_secret(string $key): bool {
        return (string) self::get($key, '') !== '';
    }
}
