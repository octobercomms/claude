<?php
declare(strict_types=1);

namespace OE\Seo;

use OE\PostTypes;
use OE\Settings;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * schema.org JSON-LD for single listing pages (UI-SPEC §6).
 *
 * Emits one `<script type="application/ld+json">` in <head> on a singular
 * listing view, mapping each listing type to the right schema.org type:
 *   - event       → Event (with Place, Offer, organizer, eventStatus)
 *   - destination → Place
 *   - story       → Article
 *   - directory   → Organization
 *
 * Conservative: only fields the listing actually has are included; the url is
 * the canonical permalink, which WordPress also emits as rel=canonical. Each
 * type passes through an `oe_jsonld_{type}` filter so a tenant can extend it,
 * and the whole feature is behind the `emit_schema` setting (default on).
 */
final class Schema {

    public static function init(): void {
        add_action('wp_head', [self::class, 'render'], 20);
    }

    public static function render(): void {
        if (! is_singular() || ! Settings::get('emit_schema', true)) {
            return;
        }
        $id   = (int) get_queried_object_id();
        if ($id <= 0) {
            return;
        }
        $slug = (string) get_post_type($id);
        $type = PostTypes::type_for_slug($slug);
        if ($type === '') {
            return;
        }

        switch ($type) {
            case 'event':
                $data = self::event($id);
                break;
            case 'destination':
                $data = self::place($id);
                break;
            case 'story':
                $data = self::article($id);
                break;
            case 'directory':
                $data = self::organization($id);
                break;
            default:
                return;
        }

        /** @var array<string,mixed> $data */
        $data = (array) apply_filters('oe_jsonld_' . $type, $data, $id);
        if (! $data) {
            return;
        }

        echo "\n<script type=\"application/ld+json\">"
            . wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            . "</script>\n";
    }

    /** @return array<string,mixed> */
    private static function event(int $id): array {
        $v = Events::values($id);
        $out = [
            '@context' => 'https://schema.org',
            '@type'    => 'Event',
            'name'     => (string) ($v['name'] ?? get_the_title($id)),
            'url'      => (string) get_permalink($id),
        ];

        $start = self::iso((string) ($v['start_datetime'] ?? ''));
        if ($start !== '') {
            $out['startDate'] = $start;
        }
        $end = self::iso((string) ($v['end_datetime'] ?? ''));
        if ($end !== '') {
            $out['endDate'] = $end;
        }

        $desc = self::description($id, (string) ($v['description'] ?? ''));
        if ($desc !== '') {
            $out['description'] = $desc;
        }

        $img = get_the_post_thumbnail_url($id, 'full');
        if ($img) {
            $out['image'] = (string) $img;
        }

        $loc = trim((string) ($v['location'] ?? ''));
        if ($loc !== '') {
            $out['location'] = [
                '@type'   => 'Place',
                'name'    => $loc,
                'address' => $loc,
            ];
        }

        $org = trim((string) ($v['organiser'] ?? ''));
        if ($org !== '') {
            $out['organizer'] = ['@type' => 'Organization', 'name' => $org];
        }

        // Event status from the preset.
        $status_map = [
            'cancelled'   => 'https://schema.org/EventCancelled',
            'rescheduled' => 'https://schema.org/EventRescheduled',
        ];
        $preset = (string) ($v['status_preset'] ?? '');
        $out['eventStatus'] = $status_map[$preset] ?? 'https://schema.org/EventScheduled';

        // Offers: only when the free-text price yields something usable.
        $offer = self::offer((string) ($v['price'] ?? ''), $preset, (string) get_permalink($id));
        if ($offer) {
            $out['offers'] = $offer;
        }

        return $out;
    }

    /**
     * Turn a free-text display price ("Free", "£45", "From £10") into an Offer,
     * or [] when nothing numeric is present and it isn't explicitly free.
     *
     * @return array<string,mixed>
     */
    private static function offer(string $price, string $preset, string $url): array {
        $price = trim($price);
        if ($price === '') {
            return [];
        }
        $availability = $preset === 'soldout'
            ? 'https://schema.org/SoldOut'
            : 'https://schema.org/InStock';
        $currency = strtoupper((string) Settings::get('currency', 'usd'));

        $offer = [
            '@type'        => 'Offer',
            'url'          => $url,
            'availability' => $availability,
        ];

        if (preg_match('/free/i', $price)) {
            $offer['price'] = '0';
            $offer['priceCurrency'] = $currency;
            return $offer;
        }
        // Pull the first number (handles "From £10", "$25", "10.50").
        if (preg_match('/([0-9]+(?:[.,][0-9]{1,2})?)/', $price, $m)) {
            $offer['price'] = str_replace(',', '.', $m[1]);
            $offer['priceCurrency'] = $currency;
            return $offer;
        }
        return [];
    }

    /** @return array<string,mixed> */
    private static function place(int $id): array {
        $out = [
            '@context' => 'https://schema.org',
            '@type'    => 'Place',
            'name'     => get_the_title($id),
            'url'      => (string) get_permalink($id),
        ];
        $desc = self::description($id, '');
        if ($desc !== '') {
            $out['description'] = $desc;
        }
        $img = get_the_post_thumbnail_url($id, 'full');
        if ($img) {
            $out['image'] = (string) $img;
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private static function article(int $id): array {
        $post = get_post($id);
        $out = [
            '@context'      => 'https://schema.org',
            '@type'         => 'Article',
            'headline'      => get_the_title($id),
            'url'           => (string) get_permalink($id),
            'datePublished' => (string) get_the_date('c', $id),
            'dateModified'  => (string) get_the_modified_date('c', $id),
        ];
        $desc = self::description($id, '');
        if ($desc !== '') {
            $out['description'] = $desc;
        }
        $img = get_the_post_thumbnail_url($id, 'full');
        if ($img) {
            $out['image'] = (string) $img;
        }
        if ($post) {
            $author = get_the_author_meta('display_name', (int) $post->post_author);
            if ($author !== '') {
                $out['author'] = ['@type' => 'Person', 'name' => $author];
            }
        }
        return $out;
    }

    /** @return array<string,mixed> */
    private static function organization(int $id): array {
        $out = [
            '@context' => 'https://schema.org',
            '@type'    => 'Organization',
            'name'     => get_the_title($id),
            'url'      => (string) get_permalink($id),
        ];
        $desc = self::description($id, '');
        if ($desc !== '') {
            $out['description'] = $desc;
        }
        $img = get_the_post_thumbnail_url($id, 'full');
        if ($img) {
            $out['logo'] = (string) $img;
            $out['image'] = (string) $img;
        }
        return $out;
    }

    /**
     * A clean plain-text description: the field value if given, else the post
     * excerpt or a trimmed body. Capped so the markup stays lean.
     */
    private static function description(int $id, string $field): string {
        $text = trim($field);
        if ($text === '') {
            $post = get_post($id);
            if ($post) {
                $text = $post->post_excerpt !== '' ? $post->post_excerpt : $post->post_content;
            }
        }
        $text = trim(wp_strip_all_tags((string) $text));
        if ($text === '') {
            return '';
        }
        return wp_trim_words($text, 55, '');
    }

    /**
     * Convert a stored "YYYY-MM-DD HH:MM" (site timezone, bare) to ISO 8601
     * with the site's UTC offset. Returns '' if unparseable.
     */
    private static function iso(string $value): string {
        $value = trim($value);
        if ($value === '') {
            return '';
        }
        try {
            $dt = new \DateTimeImmutable($value, wp_timezone());
            return $dt->format('c');
        } catch (\Exception $e) {
            return '';
        }
    }
}
