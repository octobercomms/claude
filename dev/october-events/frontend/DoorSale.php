<?php
declare(strict_types=1);

namespace OE\Frontend;

defined('ABSPATH') || exit;

/**
 * Fast door-sale checkout — the walk-up buyer's page.
 *
 * Reached by scanning a QR. Two ways to target it:
 *   - `?e=<event>`  — a specific event (the check-in app's live "Sell" QR).
 *   - `?city=<slug>` — a tour city (e.g. `atlanta-ga`), resolved to whichever
 *     event for that city is current (latest year with tickets on sale). This is
 *     the PERMANENT form: print it on a sign once and it keeps working every year,
 *     because the URL names the city, not a one-year event id.
 *
 * `?v=<venue>` optionally tags the sale to a door for the per-venue tally.
 * `?poster=1` renders a printable poster (big QR + heading) instead of the
 * checkout, so a sign can be produced straight from the browser.
 *
 * The page lists the on-sale ticket types and takes payment on-page (Stripe
 * Payment Element: card + Apple Pay / Google Pay), falling back to a hosted
 * Checkout redirect when no publishable key is set. The ticket is emailed by the
 * payment webhook so it works at the next stop.
 */
final class DoorSale {

    private static ?DoorSale $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function register_assets(): void {
        wp_register_style('oe-door', OE_URL . 'assets/css/door.css', [], OE_VERSION);
        // Stripe.js for the on-page Payment Element (card + Apple Pay / Google Pay).
        // Loaded from Stripe's own domain, as their terms require.
        wp_register_script('oe-stripe-js', 'https://js.stripe.com/v3/', [], null, true);
        // Local QR generator for poster mode (same lib the printed ticket uses).
        wp_register_script('oe-qr-gen', OE_URL . 'assets/js/qrcode.min.js', [], OE_VERSION, true);
        wp_register_script('oe-door', OE_URL . 'assets/js/door.js', ['oe-stripe-js', 'oe-qr-gen'], OE_VERSION, true);
    }

    /** Normalise a city to a comparison key: lowercase, alphanumerics only. */
    private function norm_city(string $s): string {
        return strtolower((string) preg_replace('/[^a-z0-9]/i', '', $s));
    }

    /** The event being sold: the explicit ?e=, else resolved from ?city=. */
    private function event_id(): int {
        if (isset($_GET['e'])) {
            $e = absint(wp_unslash($_GET['e']));
            if ($e) {
                return $e;
            }
        }
        $city = isset($_GET['city']) ? sanitize_text_field(wp_unslash($_GET['city'])) : '';
        return $city !== '' ? $this->resolve_city_event($city) : 0;
    }

    /**
     * Resolve a city slug to the current event for that tour: among published
     * events whose City meta matches, the latest YEAR that has tickets on sale
     * (so a future placeholder with no tickets yet is skipped until it's ready),
     * falling back to the latest-year match if none are on sale.
     */
    private function resolve_city_event(string $city): int {
        $want = $this->norm_city($city);
        if ($want === '') {
            return 0;
        }
        $best = 0; $best_year = -1;
        $best_live = 0; $best_live_year = -1;
        foreach (\OE\Volunteers\EventCodes::all_events() as $id => $title) {
            if ($this->norm_city(\OE\Volunteers\EventCodes::city_for($id)) !== $want) {
                continue;
            }
            $year = (int) preg_replace('/[^0-9]/', '', \OE\Volunteers\EventCodes::year_for($id));
            if ($year > $best_year) { $best_year = $year; $best = $id; }
            if ($this->sellable_types($id) && $year > $best_live_year) { $best_live_year = $year; $best_live = $id; }
        }
        return $best_live ?: $best;
    }

    /** The venue/door tag, from ?v= (free text, trimmed). */
    private function venue(): string {
        return isset($_GET['v']) ? substr(sanitize_text_field(wp_unslash($_GET['v'])), 0, 190) : '';
    }

    /**
     * Ticket types on open sale at the door: active, in stock and not members-only.
     * @return array<int,array{key:string,label:string,price:float,desc:string,max:int}>
     */
    private function sellable_types(int $event_id): array {
        if (! $event_id) {
            return [];
        }
        $out = [];
        foreach (\OE\Ticketing\TicketTypes::types($event_id) as $t) {
            if (empty($t['active']) || \OE\Ticketing\TicketTypes::is_members_only($t)) {
                continue;
            }
            if (\OE\Ticketing\TicketTypes::availability($event_id, $t)['state'] !== 'available') {
                continue;
            }
            $out[] = [
                'key'   => (string) $t['key'],
                'label' => (string) $t['label'],
                'price' => \OE\Ticketing\TicketTypes::effective_price($t),
                'desc'  => (string) ($t['description'] ?? ''),
                'max'   => \OE\Ticketing\TicketTypes::max_per_order($t),
            ];
        }
        return $out;
    }

    public function render(): string {
        wp_enqueue_style('oe-door');
        wp_enqueue_script('oe-stripe-js');
        wp_enqueue_script('oe-qr-gen');
        wp_enqueue_script('oe-door');

        $event_id = $this->event_id();
        $venue    = $this->venue();
        $title    = $event_id ? (string) get_the_title($event_id) : '';
        $city     = $event_id ? \OE\Volunteers\EventCodes::city_for($event_id) : '';
        $types    = $this->sellable_types($event_id);
        $currency = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $poster   = isset($_GET['poster']);

        // Door tag for the tally: the printed venue if given, else the tour city so
        // a city-level sign still groups its sales.
        $door_tag = $venue !== '' ? $venue : $city;

        // Return to this same page after Stripe (minus result/poster markers).
        $return  = home_url(remove_query_arg(['oe_paid', 'oe_cancelled', 'session_id']));
        // The URL a poster's QR should point at: this page as a buy page (drop the
        // poster flag), so scanning it opens the checkout — permanent when it names
        // a city rather than an event id.
        $buy_url = home_url(remove_query_arg(['poster', 'oe_paid', 'oe_cancelled', 'session_id']));

        wp_localize_script('oe-door', 'OE_DOOR', [
            'restUrl'   => esc_url_raw(rest_url('oe/v1')),
            'eventId'   => $event_id,
            'venue'     => $door_tag,
            'returnUrl' => esc_url_raw($return),
            'currency'  => $currency,
            'symbol'    => $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$'),
            'ready'     => \OE\Connectors\StripeConnector::is_ready(),
            'publishable' => (string) \OE\Settings::get('stripe_publishable_key', ''),
            'poster'    => $poster,
            'buyUrl'    => esc_url_raw($buy_url),
        ]);

        ob_start();
        $tpl_event_id = $event_id;
        $tpl_title    = $title;
        $tpl_venue    = $venue;
        $tpl_city     = $city;
        $tpl_types    = $types;
        $tpl_poster   = $poster;
        $tpl_buy_url  = $buy_url;
        require OE_DIR . 'frontend/templates/door.php';
        return (string) ob_get_clean();
    }
}
