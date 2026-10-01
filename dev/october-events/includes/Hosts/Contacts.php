<?php
declare(strict_types=1);

namespace OE\Hosts;

defined('ABSPATH') || exit;

/**
 * Host contacts for an event or tour — the people we deal with about each one
 * (homeowner, architect, realtor, organiser …). Stored as structured rows on the
 * post so emails address the right person by name, and so a send can later target
 * one role. This is distinct from the marketing contact list.
 *
 * @see docs/october-events/HOST-COMMS-SPEC.md
 */
final class Contacts {

    /** Post meta holding the JSON array of contact rows. */
    public const META = '_oe_host_contacts';

    /** Known roles (key => label). "Other" carries a free-text label of its own. */
    public const ROLES = [
        'homeowner' => 'Homeowner',
        'architect' => 'Architect',
        'realtor'   => 'Realtor',
        'designer'  => 'Designer',
        'organiser' => 'Organiser',
        'other'     => 'Other',
    ];

    /**
     * The contacts on a post, each a row {name, email, phone, role, role_label}.
     *
     * @return array<int,array{name:string,email:string,phone:string,role:string,role_label:string}>
     */
    public static function get(int $post_id): array {
        $raw = get_post_meta($post_id, self::META, true);
        $rows = is_string($raw) && $raw !== '' ? json_decode($raw, true) : (is_array($raw) ? $raw : []);
        if (! is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $r) {
            if (! is_array($r)) {
                continue;
            }
            $email = sanitize_email((string) ($r['email'] ?? ''));
            $name  = sanitize_text_field((string) ($r['name'] ?? ''));
            if ($email === '' && $name === '') {
                continue; // an empty row
            }
            $role = sanitize_key((string) ($r['role'] ?? 'other'));
            if (! isset(self::ROLES[$role])) {
                $role = 'other';
            }
            $out[] = [
                'name'       => $name,
                'email'      => $email,
                'phone'      => sanitize_text_field((string) ($r['phone'] ?? '')),
                'role'       => $role,
                'role_label' => self::role_label($role, (string) ($r['role_label'] ?? '')),
            ];
        }
        return $out;
    }

    /** Only the contacts with a valid email — the ones a send can reach. */
    public static function mailable(int $post_id): array {
        return array_values(array_filter(self::get($post_id), static fn(array $r): bool => $r['email'] !== '' && is_email($r['email'])));
    }

    /** Persist a set of submitted rows (from the metabox) to the post. */
    public static function save(int $post_id, array $raw): void {
        $rows = [];
        foreach ($raw as $r) {
            if (! is_array($r)) {
                continue;
            }
            $email = sanitize_email((string) ($r['email'] ?? ''));
            $name  = sanitize_text_field((string) ($r['name'] ?? ''));
            if ($email === '' && $name === '') {
                continue;
            }
            $role = sanitize_key((string) ($r['role'] ?? 'other'));
            if (! isset(self::ROLES[$role])) {
                $role = 'other';
            }
            $rows[] = [
                'name'       => $name,
                'email'      => $email,
                'phone'      => sanitize_text_field((string) ($r['phone'] ?? '')),
                'role'       => $role,
                'role_label' => $role === 'other' ? sanitize_text_field((string) ($r['role_label'] ?? '')) : '',
            ];
        }
        if ($rows) {
            update_post_meta($post_id, self::META, wp_json_encode($rows));
        } else {
            delete_post_meta($post_id, self::META);
        }
    }

    /** A display label for a role: the known label, or the custom "Other" text. */
    private static function role_label(string $role, string $custom): string {
        if ($role === 'other') {
            $custom = sanitize_text_field($custom);
            return $custom !== '' ? $custom : self::ROLES['other'];
        }
        return self::ROLES[$role] ?? self::ROLES['other'];
    }
}
