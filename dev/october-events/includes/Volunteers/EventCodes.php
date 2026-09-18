<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\Settings;
use OE\Features;
use OE\PostTypes;
use OE\Ticketing\Promo;

defined('ABSPATH') || exit;

/**
 * Per-event volunteer thank-you codes.
 *
 * Two roles, both driven off the events/opportunities you already have:
 *
 *  - A ticket event that GIVES free volunteer tickets carries an "offer" box on
 *    its editor (code, ticket type, tickets per volunteer). The ticket-selling
 *    site creates one 100%-off promo per offering event, and exposes them on a
 *    feed for the partner (festival) site.
 *
 *  - A volunteer opportunity on the festival site carries a "reward" box: the
 *    tour whose code its volunteers receive, chosen from the tours synced over
 *    the existing partner-feed connection. The 48-hour reminder resolves the
 *    code and buy link from the opportunity a volunteer signed up for.
 *
 * The older single global code ({@see TicketCode}) still works as a fallback,
 * so a one-tour site that hasn't set anything per-event is unaffected.
 */
final class EventCodes {

    /** Event meta (on a ticket-selling event that offers free volunteer tickets). */
    public const M_OFFER = '_oe_vol_offer';
    public const M_CODE  = '_oe_vol_code';
    public const M_TYPE  = '_oe_vol_type';
    public const M_PER   = '_oe_vol_per';

    /** Opportunity meta (on the festival site): the reward tour's code. */
    public const M_REWARD = '_oe_vol_reward_code';

    /** Festival-side option: tours pulled from the ticket site. */
    private const OPT_SYNCED = 'oe_vol_synced';

    public static function init(): void {
        // Keep this year's per-event promos alive + refresh the synced list.
        add_action(\OE\Cron::HOOK_DAILY, [self::class, 'ensure_promos']);
        add_action(\OE\Cron::HOOK_DAILY, [self::class, 'sync']);

        if (is_admin()) {
            add_action('add_meta_boxes', [self::class, 'register_boxes']);
            add_action('save_post', [self::class, 'save_boxes'], 10, 2);
        }
        // Recreate a promo as soon as an offering event is saved (ticket site).
        add_action('save_post_' . PostTypes::slug('event'), [self::class, 'ensure_for_event'], 20, 1);
    }

    /* ---------------------------------------------------------------- */
    /* Giving side — a ticket event that offers free volunteer tickets   */
    /* ---------------------------------------------------------------- */

    public static function is_offering(int $event): bool {
        return $event > 0 && get_post_meta($event, self::M_OFFER, true) === '1';
    }

    /** This event's code (its own, or one derived from the slug + year). */
    public static function code_for(int $event): string {
        $set = strtoupper((string) preg_replace('/[^A-Za-z0-9\-]/', '', (string) get_post_meta($event, self::M_CODE, true)));
        if ($set !== '') {
            return $set;
        }
        $slug = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) get_post_field('post_name', $event)));
        if ($slug === '') {
            $slug = 'VOL' . $event;
        }
        return $slug . wp_date('Y');
    }

    public static function type_for(int $event): string {
        return sanitize_key((string) get_post_meta($event, self::M_TYPE, true));
    }

    public static function per_for(int $event): int {
        $n = (int) get_post_meta($event, self::M_PER, true);
        return $n > 0 ? $n : 2;
    }

    /** @return int[] published events flagged as offering. */
    public static function offering_events(): array {
        return get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'fields'         => 'ids',
            'meta_key'       => self::M_OFFER,
            'meta_value'     => '1',
        ]);
    }

    /** Create/refresh the 100%-off promo for each offering event (ticket site). */
    public static function ensure_promos(): void {
        foreach (self::offering_events() as $event) {
            self::ensure_for_event((int) $event);
        }
    }

    public static function ensure_for_event(int $event): void {
        if (! self::is_offering($event)) {
            return;
        }
        $code = self::code_for($event);
        if ($code === '' || Promo::get_by_code($code)) {
            return; // already exists — never clobber its used_count
        }
        $type = self::type_for($event);
        Promo::save([
            'code'             => $code,
            'event_id'         => $event,
            'discount_type'    => 'percent',
            'discount_value'   => 100,
            'ticket_type_keys' => $type !== '' ? [$type] : [],
            'max_uses'         => '',
            'expires_at'       => wp_date('Y') . '-12-31 23:59:59',
            'active'           => 1,
        ]);
    }

    /**
     * The offered tours, for the feed the festival site pulls.
     * @return array<int,array{event_id:int,code:string,label:string,url:string,per:int}>
     */
    public static function offered_feed(): array {
        $out = [];
        foreach (self::offering_events() as $event) {
            $event = (int) $event;
            $out[] = [
                'event_id' => $event,
                'code'     => self::code_for($event),
                'label'    => (string) get_the_title($event),
                'url'      => (string) get_permalink($event),
                'per'      => self::per_for($event),
            ];
        }
        return $out;
    }

    /** Every current thank-you code string on this (ticket) site, for the checkout gate. */
    public static function all_codes(): array {
        $codes = [];
        foreach (self::offering_events() as $event) {
            $codes[] = self::code_for((int) $event);
        }
        return $codes;
    }

    /** Is this code one of the volunteer thank-you codes (per-event or the global one)? */
    public static function is_thankyou_code(string $code): bool {
        $code = strtoupper(trim($code));
        if ($code === '') {
            return false;
        }
        if (in_array($code, array_map('strtoupper', self::all_codes()), true)) {
            return true;
        }
        return $code === strtoupper(TicketCode::peek());
    }

    /* ---------------------------------------------------------------- */
    /* Reward side — festival opportunities + synced tour list           */
    /* ---------------------------------------------------------------- */

    /** @return array<int,array{event_id:int,code:string,label:string,url:string,per:int}> */
    public static function synced(): array {
        $v = get_option(self::OPT_SYNCED, []);
        return is_array($v) ? $v : [];
    }

    /**
     * Pull the offered tours from the linked ticket site over the existing
     * partner-feed connection (same URL + application password). Festival side.
     */
    public static function sync(): array {
        $url  = TicketCode::partner_url();
        $user = trim((string) Settings::get('volunteer_feed_user', ''));
        $pass = trim((string) Settings::get('volunteer_feed_app_password', ''));
        if ($url === '' || $user === '' || $pass === '') {
            return ['error' => 'not_configured'];
        }
        $endpoint = trailingslashit($url) . 'wp-json/oe/v1/volunteers/thankyou-codes';
        $res = wp_remote_get($endpoint, [
            'timeout' => 12,
            'headers' => ['Authorization' => 'Basic ' . base64_encode($user . ':' . $pass)],
        ]);
        if (is_wp_error($res)) {
            return ['error' => $res->get_error_message()];
        }
        if ((int) wp_remote_retrieve_response_code($res) !== 200) {
            return ['error' => 'http_' . (int) wp_remote_retrieve_response_code($res)];
        }
        $body = json_decode((string) wp_remote_retrieve_body($res), true);
        $list = (is_array($body) && isset($body['codes']) && is_array($body['codes'])) ? $body['codes'] : [];
        $clean = [];
        foreach ($list as $row) {
            if (! is_array($row) || empty($row['code'])) {
                continue;
            }
            $clean[] = [
                'event_id' => (int) ($row['event_id'] ?? 0),
                'code'     => strtoupper((string) $row['code']),
                'label'    => (string) ($row['label'] ?? $row['code']),
                'url'      => esc_url_raw((string) ($row['url'] ?? '')),
                'per'      => max(1, (int) ($row['per'] ?? 2)),
            ];
        }
        update_option(self::OPT_SYNCED, $clean, false);
        return ['ok' => true, 'count' => count($clean)];
    }

    /** The reward code chosen on an opportunity (festival site). */
    public static function reward_code_for_opportunity(int $opportunity): string {
        return strtoupper((string) get_post_meta($opportunity, self::M_REWARD, true));
    }

    /**
     * Resolve what a volunteer on this opportunity should receive in the 48h email:
     * their opportunity's chosen tour (from the synced list), else the global code
     * as a fallback. Returns null when nothing is configured.
     *
     * @return array{code:string,url:string,label:string,per:int}|null
     */
    public static function reward_for_opportunity(int $opportunity): ?array {
        $code = self::reward_code_for_opportunity($opportunity);
        if ($code !== '') {
            foreach (self::synced() as $t) {
                if (strtoupper((string) $t['code']) === $code) {
                    return [
                        'code'  => (string) $t['code'],
                        'url'   => (string) $t['url'],
                        'label' => (string) $t['label'],
                        'per'   => (int) $t['per'],
                    ];
                }
            }
            // Chosen but not in the synced list (stale) — still send the code.
            return ['code' => $code, 'url' => TicketCode::redeem_url(), 'label' => '', 'per' => 2];
        }
        // Legacy fallback: the older single global code, but ONLY on a site still
        // set up that way (a redeem URL configured and no per-event tours synced).
        // Otherwise send nothing rather than risk a code with no matching promo.
        $legacy_redeem = trim((string) Settings::get('volunteer_code_redeem_url', ''));
        if ($legacy_redeem !== '' && ! self::synced()) {
            $global = TicketCode::peek();
            if ($global !== '') {
                return ['code' => $global, 'url' => TicketCode::redeem_url(), 'label' => '', 'per' => 2];
            }
        }
        return null;
    }

    /* ---------------------------------------------------------------- */
    /* Meta boxes                                                        */
    /* ---------------------------------------------------------------- */

    public static function register_boxes(): void {
        if (Features::enabled('tickets')) {
            add_meta_box('oe-vol-offer', __('Volunteer thank-you tickets', 'october-events'), [self::class, 'render_offer_box'], PostTypes::slug('event'), 'side', 'default');
        }
        if (Features::enabled('volunteers')) {
            add_meta_box('oe-vol-reward', __('Volunteer reward', 'october-events'), [self::class, 'render_reward_box'], self::opportunity_slug(), 'side', 'default');
        }
    }

    private static function opportunity_slug(): string {
        return \OE\Volunteers::slug();
    }

    public static function render_offer_box(\WP_Post $post): void {
        wp_nonce_field('oe_vol_offer_' . $post->ID, 'oe_vol_offer_nonce');
        $on   = get_post_meta($post->ID, self::M_OFFER, true) === '1';
        $code = (string) get_post_meta($post->ID, self::M_CODE, true);
        $type = (string) get_post_meta($post->ID, self::M_TYPE, true);
        $per  = (int) get_post_meta($post->ID, self::M_PER, true) ?: 2;
        echo '<p><label><input type="checkbox" name="oe_vol_offer" value="1" ' . checked($on, true, false) . '> <strong>' . esc_html__('Offer free volunteer tickets to this event', 'october-events') . '</strong></label></p>';
        echo '<p><label>' . esc_html__('Code', 'october-events') . '<br><input type="text" name="oe_vol_code" class="widefat code" value="' . esc_attr($code) . '" placeholder="' . esc_attr(self::code_for($post->ID)) . '"></label>';
        echo '<span class="description">' . esc_html__('Blank = auto from the slug + year.', 'october-events') . '</span></p>';
        echo '<p><label>' . esc_html__('Ticket type key', 'october-events') . '<br><input type="text" name="oe_vol_type" class="widefat code" value="' . esc_attr($type) . '" placeholder="single"></label>';
        echo '<span class="description">' . esc_html__('Blank = whole event. Set this type’s Max per order to your free-ticket count.', 'october-events') . '</span></p>';
        echo '<p><label>' . esc_html__('Free tickets per volunteer', 'october-events') . '<br><input type="number" min="1" name="oe_vol_per" value="' . esc_attr((string) $per) . '" style="width:90px"></label></p>';
    }

    public static function render_reward_box(\WP_Post $post): void {
        wp_nonce_field('oe_vol_reward_' . $post->ID, 'oe_vol_reward_nonce');
        $chosen = self::reward_code_for_opportunity($post->ID);
        $tours  = self::synced();
        echo '<p class="description">' . esc_html__('The tour whose free-ticket code this opportunity’s volunteers receive in their 48-hour reminder.', 'october-events') . '</p>';
        if (! $tours) {
            echo '<p class="description">' . esc_html__('No tours synced yet. Set up the linked ticket site and run a sync first.', 'october-events') . '</p>';
        }
        echo '<select name="oe_vol_reward_code" class="widefat"><option value="">' . esc_html__('— none —', 'october-events') . '</option>';
        foreach ($tours as $t) {
            $c = strtoupper((string) $t['code']);
            echo '<option value="' . esc_attr($c) . '" ' . selected($chosen, $c, false) . '>' . esc_html((string) $t['label'] . ' (' . $c . ')') . '</option>';
        }
        echo '</select>';
    }

    public static function save_boxes(int $post_id, \WP_Post $post): void {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        // Offer box (event editor).
        if (isset($_POST['oe_vol_offer_nonce']) && wp_verify_nonce((string) $_POST['oe_vol_offer_nonce'], 'oe_vol_offer_' . $post_id)) {
            update_post_meta($post_id, self::M_OFFER, empty($_POST['oe_vol_offer']) ? '' : '1');
            update_post_meta($post_id, self::M_CODE, strtoupper((string) preg_replace('/[^A-Za-z0-9\-]/', '', sanitize_text_field((string) ($_POST['oe_vol_code'] ?? '')))));
            update_post_meta($post_id, self::M_TYPE, sanitize_key((string) ($_POST['oe_vol_type'] ?? '')));
            update_post_meta($post_id, self::M_PER, max(1, (int) ($_POST['oe_vol_per'] ?? 2)));
        }
        // Reward box (opportunity editor).
        if (isset($_POST['oe_vol_reward_nonce']) && wp_verify_nonce((string) $_POST['oe_vol_reward_nonce'], 'oe_vol_reward_' . $post_id)) {
            update_post_meta($post_id, self::M_REWARD, strtoupper((string) preg_replace('/[^A-Za-z0-9\-]/', '', sanitize_text_field((string) ($_POST['oe_vol_reward_code'] ?? '')))));
        }
    }
}
