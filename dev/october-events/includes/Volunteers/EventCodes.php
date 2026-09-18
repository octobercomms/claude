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
    public const M_URL   = '_oe_vol_url';

    /** Event meta (festival side): the reward tour's code for this event's volunteers. */
    public const M_EVENT_REWARD = '_oe_vol_event_reward';

    /** Opportunity meta (optional per-opportunity override of the reward). */
    public const M_REWARD = '_oe_vol_reward_code';

    /** Festival-side option: tours pulled from the ticket site. */
    private const OPT_SYNCED = 'oe_vol_synced';

    public static function init(): void {
        // Keep this year's per-event promos alive + refresh the synced list.
        add_action(\OE\Cron::HOOK_DAILY, [self::class, 'ensure_promos']);
        add_action(\OE\Cron::HOOK_DAILY, [self::class, 'sync']);
        // Recreate a promo as soon as an offering event is saved (ticket site).
        add_action('save_post_' . PostTypes::slug('event'), [self::class, 'ensure_for_event'], 20, 1);
    }

    /** All published events on this site, id => title (for the settings tables). */
    public static function all_events(): array {
        $out = [];
        foreach (get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ]) as $ev) {
            $out[(int) $ev->ID] = (string) (get_the_title($ev) ?: ('#' . $ev->ID));
        }
        return $out;
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

    /** The tickets page volunteers are sent to for this tour: the explicit URL, else the event page. */
    public static function url_for(int $event): string {
        $u = trim((string) get_post_meta($event, self::M_URL, true));
        return $u !== '' ? $u : (string) get_permalink($event);
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
            $event    = (int) $event;
            $type_key = self::type_for($event);
            $type_lbl = '';
            if ($type_key !== '') {
                $t = \OE\Ticketing\TicketTypes::type($event, $type_key);
                $type_lbl = $t ? (string) $t['label'] : $type_key;
            }
            $out[] = [
                'event_id'   => $event,
                'code'       => self::code_for($event),
                'label'      => (string) get_the_title($event),
                'url'        => self::url_for($event),
                'per'        => self::per_for($event),
                'type_label' => $type_lbl,
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

    /**
     * The free-ticket cap for a per-event code: how many units it makes free and
     * which ticket type it applies to. Null for a code that isn't one of ours.
     * @return array{per:int,type:string}|null
     */
    public static function code_cap(string $code): ?array {
        $code = strtoupper(trim($code));
        if ($code === '') {
            return null;
        }
        foreach (self::offering_events() as $ev) {
            $ev = (int) $ev;
            if (strtoupper(self::code_for($ev)) === $code) {
                return ['per' => self::per_for($ev), 'type' => self::type_for($ev)];
            }
        }
        return null;
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
                'event_id'   => (int) ($row['event_id'] ?? 0),
                'code'       => strtoupper((string) $row['code']),
                'label'      => (string) ($row['label'] ?? $row['code']),
                'url'        => esc_url_raw((string) ($row['url'] ?? '')),
                'per'        => max(1, (int) ($row['per'] ?? 2)),
                'type_label' => sanitize_text_field((string) ($row['type_label'] ?? '')),
            ];
        }
        update_option(self::OPT_SYNCED, $clean, false);
        return ['ok' => true, 'count' => count($clean)];
    }

    /** The reward tour code set on a festival event (its volunteers' reward). */
    public static function event_reward_code(int $event): string {
        return strtoupper((string) get_post_meta($event, self::M_EVENT_REWARD, true));
    }

    /** The single default reward tour code, for volunteers not matched by an event. */
    public static function default_reward_code(): string {
        return strtoupper((string) Settings::get('volunteer_default_reward', ''));
    }

    /** Resolve a tour code against the synced list. @return array|null */
    private static function resolve_code(string $code): ?array {
        $code = strtoupper(trim($code));
        if ($code === '') {
            return null;
        }
        foreach (self::synced() as $t) {
            if (strtoupper((string) $t['code']) === $code) {
                return ['code' => (string) $t['code'], 'url' => (string) $t['url'], 'label' => (string) $t['label'], 'per' => (int) $t['per'], 'type_label' => (string) ($t['type_label'] ?? '')];
            }
        }
        // Chosen but not in the synced list yet (stale/not synced) — still send it.
        return ['code' => $code, 'url' => TicketCode::redeem_url(), 'label' => '', 'per' => 2, 'type_label' => ''];
    }

    /**
     * Resolve what a volunteer on this opportunity receives in the 48h email:
     *   1. an explicit per-opportunity override, else
     *   2. the reward tour set on the event they signed up for, else
     *   3. the single default reward tour.
     * Returns null when nothing is configured (so no dead code is ever sent).
     *
     * @return array{code:string,url:string,label:string,per:int}|null
     */
    public static function reward_for_opportunity(int $opportunity): ?array {
        // 1. per-opportunity override.
        $override = strtoupper((string) get_post_meta($opportunity, self::M_REWARD, true));
        if ($override !== '') {
            return self::resolve_code($override);
        }
        // 2. the linked event's reward.
        $event = \OE\Volunteers::linked_event($opportunity);
        if ($event > 0) {
            $ev_code = self::event_reward_code($event);
            if ($ev_code !== '') {
                return self::resolve_code($ev_code);
            }
        }
        // 3. the single default.
        $default = self::default_reward_code();
        return $default !== '' ? self::resolve_code($default) : null;
    }

    /**
     * Persist the per-event offer + reward rows posted from Settings → Volunteers.
     * @param array<int,array<string,mixed>> $offers  event_id => [offer,code,type,per]
     * @param array<int,string>              $rewards event_id => reward code
     */
    public static function save_from_settings(array $offers, array $rewards): void {
        foreach ($offers as $event => $row) {
            $event = (int) $event;
            if ($event <= 0 || ! current_user_can('edit_post', $event)) {
                continue;
            }
            update_post_meta($event, self::M_OFFER, empty($row['offer']) ? '' : '1');
            update_post_meta($event, self::M_CODE, strtoupper((string) preg_replace('/[^A-Za-z0-9\-]/', '', sanitize_text_field((string) ($row['code'] ?? '')))));
            update_post_meta($event, self::M_TYPE, sanitize_key((string) ($row['type'] ?? '')));
            update_post_meta($event, self::M_PER, max(1, (int) ($row['per'] ?? 2)));
            update_post_meta($event, self::M_URL, esc_url_raw(trim((string) ($row['url'] ?? ''))));
        }
        foreach ($rewards as $event => $code) {
            $event = (int) $event;
            if ($event <= 0 || ! current_user_can('edit_post', $event)) {
                continue;
            }
            update_post_meta($event, self::M_EVENT_REWARD, strtoupper((string) preg_replace('/[^A-Za-z0-9\-]/', '', sanitize_text_field((string) $code))));
        }
        self::ensure_promos();
    }

}
