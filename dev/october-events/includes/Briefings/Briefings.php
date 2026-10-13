<?php
declare(strict_types=1);

namespace OE\Briefings;

defined('ABSPATH') || exit;

/**
 * Organizer briefings + onboarding checklist (ROADMAP R4).
 *
 * Two admin-managed lists, both stored as options:
 *   - briefings: reference notes shown to partners in their portal (title,
 *     body, optional link).
 *   - checklist: onboarding steps a partner ticks off; completion is per-user
 *     (user meta), so each partner has their own progress.
 */
final class Briefings {

    private const OPT_BRIEFINGS = 'oe_briefings';
    private const OPT_CHECKLIST = 'oe_checklist';
    private const STATE_META    = 'oe_checklist_state';

    /* ------------------------------------------------------- briefings */

    /** @return array<int,array{id:string,title:string,body:string,link:string}> */
    public static function briefings(): array {
        $raw = get_option(self::OPT_BRIEFINGS, []);
        return is_array($raw) ? array_values($raw) : [];
    }

    public static function save_briefing(string $id, string $title, string $body, string $link): string {
        $title = trim(sanitize_text_field($title));
        if ($title === '') {
            return '';
        }
        $id   = $id !== '' ? sanitize_key($id) : 'b_' . substr(md5($title . microtime()), 0, 8);
        $list = self::briefings();
        $new  = ['id' => $id, 'title' => $title, 'body' => sanitize_textarea_field($body), 'link' => esc_url_raw($link)];
        $found = false;
        foreach ($list as $i => $b) {
            if ($b['id'] === $id) { $list[$i] = $new; $found = true; break; }
        }
        if (! $found) { $list[] = $new; }
        update_option(self::OPT_BRIEFINGS, array_values($list), false);
        return $id;
    }

    public static function delete_briefing(string $id): void {
        $list = array_values(array_filter(self::briefings(), static fn($b) => $b['id'] !== $id));
        update_option(self::OPT_BRIEFINGS, $list, false);
    }

    /* ------------------------------------------------------- checklist */

    /** @return array<int,array{id:string,label:string,desc:string}> */
    public static function checklist(): array {
        $raw = get_option(self::OPT_CHECKLIST, []);
        return is_array($raw) ? array_values($raw) : [];
    }

    public static function save_item(string $id, string $label, string $desc): string {
        $label = trim(sanitize_text_field($label));
        if ($label === '') {
            return '';
        }
        $id   = $id !== '' ? sanitize_key($id) : 'c_' . substr(md5($label . microtime()), 0, 8);
        $list = self::checklist();
        $new  = ['id' => $id, 'label' => $label, 'desc' => sanitize_text_field($desc)];
        $found = false;
        foreach ($list as $i => $c) {
            if ($c['id'] === $id) { $list[$i] = $new; $found = true; break; }
        }
        if (! $found) { $list[] = $new; }
        update_option(self::OPT_CHECKLIST, array_values($list), false);
        return $id;
    }

    public static function delete_item(string $id): void {
        $list = array_values(array_filter(self::checklist(), static fn($c) => $c['id'] !== $id));
        update_option(self::OPT_CHECKLIST, $list, false);
    }

    /* ------------------------------------------------- per-user state */

    /** @return array<string,bool> item id => done */
    public static function state(int $user_id): array {
        $raw = get_user_meta($user_id, self::STATE_META, true);
        return is_array($raw) ? $raw : [];
    }

    public static function set_state(int $user_id, string $item_id, bool $done): void {
        $state = self::state($user_id);
        $item_id = sanitize_key($item_id);
        if ($done) {
            $state[$item_id] = true;
        } else {
            unset($state[$item_id]);
        }
        update_user_meta($user_id, self::STATE_META, $state);
    }

    /** Replace the whole state from a set of ticked ids (the known items only). */
    public static function set_all(int $user_id, array $done_ids): void {
        $valid = array_map(static fn($c) => $c['id'], self::checklist());
        $state = [];
        foreach ($done_ids as $id) {
            $id = sanitize_key((string) $id);
            if (in_array($id, $valid, true)) {
                $state[$id] = true;
            }
        }
        update_user_meta($user_id, self::STATE_META, $state);
    }

    /** @return array{done:int,total:int,pct:int} */
    public static function progress(int $user_id): array {
        $items = self::checklist();
        $state = self::state($user_id);
        $total = count($items);
        $done  = 0;
        foreach ($items as $c) {
            if (! empty($state[$c['id']])) { $done++; }
        }
        return ['done' => $done, 'total' => $total, 'pct' => $total > 0 ? (int) round($done / $total * 100) : 0];
    }
}
