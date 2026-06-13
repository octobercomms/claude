<?php
declare(strict_types=1);

namespace OE\Mail;

defined('ABSPATH') || exit;

/**
 * Contact lists & segments.
 *
 * A list groups contacts. Two kinds (the `type` column):
 *  - "manual"  — explicit membership (add/import/snapshot), stored in oe_list_members.
 *  - "dynamic" — a saved rule (the `rules` JSON); membership is computed on the fly
 *                by {@see Segments} (added in a later phase). Stored with no rows in
 *                the members table until snapshotted.
 *
 * Campaigns can target a list as their audience (`list:<id>`).
 */
final class Lists {

    /** Brevo list id => name (from the festival's export, for one-shot import). */
    private const BREVO_LIST_NAMES = [
        2  => 'Subscribers',
        4  => 'Industry — Atlanta Arts Community',
        5  => 'Industry — Architects & Designers',
        6  => 'Industry — Design Retail Stores',
        7  => 'Friends & Partners',
        8  => 'Press — ATL Press + Influencers',
        9  => 'Press — MA Press',
        10 => 'Friends & Partners — MA Friends + Influencers',
        11 => 'Friends & Partners — Sponsors / Partners',
        12 => 'Friends & Partners — MA Commercial Designers',
        13 => 'Friends & Partners — VIPs',
        14 => 'Event — BoConcept',
        15 => 'Event — Jannat Open House',
        16 => 'Students',
        17 => 'Event — Tours',
        19 => 'identified_contacts',
        20 => 'Volunteers',
        21 => 'ADF Team',
        22 => 'Soho House',
        24 => 'Contacts involved in conversations',
        25 => 'Event Espresso',
        29 => 'Instagram Followers',
        31 => 'Tours Waitlist',
        32 => 'CEU Target',
    ];

    public static function lists_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_lists';
    }

    public static function members_table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_list_members';
    }

    public static function install(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $l = self::lists_table();
        $m = self::members_table();
        dbDelta("CREATE TABLE {$l} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(190) NOT NULL,
            description VARCHAR(255) NOT NULL DEFAULT '',
            type VARCHAR(20) NOT NULL DEFAULT 'manual',
            rules LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY type (type)
        ) {$charset};");
        dbDelta("CREATE TABLE {$m} (
            list_id BIGINT UNSIGNED NOT NULL,
            contact_id BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (list_id, contact_id),
            KEY contact_id (contact_id)
        ) {$charset};");
    }

    /** @return array<int,object> lists with a member_count column. */
    public static function all(): array {
        global $wpdb;
        $l = self::lists_table();
        $m = self::members_table();
        return $wpdb->get_results(
            "SELECT l.*, (SELECT COUNT(*) FROM {$m} WHERE list_id = l.id) AS member_count
             FROM {$l} l ORDER BY l.name ASC"
        ) ?: [];
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::lists_table() . ' WHERE id = %d', $id)) ?: null;
    }

    /** @param array<string,mixed>|null $rules */
    public static function create(string $name, string $description = '', string $type = 'manual', ?array $rules = null): int {
        global $wpdb;
        $name = sanitize_text_field($name);
        if ($name === '') {
            return 0;
        }
        $now = current_time('mysql', true);
        $wpdb->insert(self::lists_table(), [
            'name'        => $name,
            'description' => sanitize_text_field($description),
            'type'        => $type === 'dynamic' ? 'dynamic' : 'manual',
            'rules'       => $rules ? wp_json_encode($rules) : null,
            'created_at'  => $now,
            'updated_at'  => $now,
        ]);
        return (int) $wpdb->insert_id;
    }

    /** @param array<string,mixed> $data */
    public static function update(int $id, array $data): void {
        global $wpdb;
        $row = ['updated_at' => current_time('mysql', true)];
        if (isset($data['name']))        { $row['name'] = sanitize_text_field((string) $data['name']); }
        if (isset($data['description'])) { $row['description'] = sanitize_text_field((string) $data['description']); }
        if (array_key_exists('rules', $data)) { $row['rules'] = $data['rules'] ? wp_json_encode($data['rules']) : null; }
        $wpdb->update(self::lists_table(), $row, ['id' => $id]);
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(self::lists_table(), ['id' => $id]);
        $wpdb->delete(self::members_table(), ['list_id' => $id]);
    }

    public static function add_contact(int $list_id, int $contact_id): void {
        global $wpdb;
        if ($list_id <= 0 || $contact_id <= 0) {
            return;
        }
        $wpdb->query($wpdb->prepare(
            'INSERT IGNORE INTO ' . self::members_table() . ' (list_id, contact_id, created_at) VALUES (%d, %d, %s)',
            $list_id, $contact_id, current_time('mysql', true)
        ));
    }

    public static function remove_contact(int $list_id, int $contact_id): void {
        global $wpdb;
        $wpdb->delete(self::members_table(), ['list_id' => $list_id, 'contact_id' => $contact_id]);
    }

    /**
     * Replace a list's membership with a set of contact ids (used to snapshot a
     * segment). @param int[] $contact_ids
     */
    public static function set_contacts(int $list_id, array $contact_ids): void {
        global $wpdb;
        $wpdb->delete(self::members_table(), ['list_id' => $list_id]);
        foreach (array_unique(array_map('intval', $contact_ids)) as $cid) {
            self::add_contact($list_id, $cid);
        }
    }

    /** @return int[] list ids the contact belongs to. */
    public static function for_contact(int $contact_id): array {
        global $wpdb;
        return array_map('intval', $wpdb->get_col($wpdb->prepare(
            'SELECT list_id FROM ' . self::members_table() . ' WHERE contact_id = %d',
            $contact_id
        )) ?: []);
    }

    public static function count(int $list_id): int {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . self::members_table() . ' WHERE list_id = %d', $list_id));
    }

    /** Contact rows in a list (optionally filtered by search). @return array<int,object> */
    public static function contacts(int $list_id, string $term = '', int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $c = Contacts::table();
        $m = self::members_table();
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        if ($term !== '') {
            $like = '%' . $wpdb->esc_like($term) . '%';
            return $wpdb->get_results($wpdb->prepare(
                "SELECT c.* FROM {$m} mm INNER JOIN {$c} c ON c.id = mm.contact_id
                 WHERE mm.list_id = %d AND (c.email LIKE %s OR c.name LIKE %s)
                 ORDER BY c.updated_at DESC LIMIT %d OFFSET %d",
                $list_id, $like, $like, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare(
            "SELECT c.* FROM {$m} mm INNER JOIN {$c} c ON c.id = mm.contact_id
             WHERE mm.list_id = %d ORDER BY c.updated_at DESC LIMIT %d OFFSET %d",
            $list_id, $limit, $offset
        )) ?: [];
    }

    /** Subscribed recipients of a list, for sending. @return array<int,object> */
    public static function member_recipients(int $list_id): array {
        global $wpdb;
        $c = Contacts::table();
        $m = self::members_table();
        return $wpdb->get_results($wpdb->prepare(
            "SELECT c.email, c.name FROM {$m} mm INNER JOIN {$c} c ON c.id = mm.contact_id WHERE mm.list_id = %d AND c.status = 'subscribed'",
            $list_id
        )) ?: [];
    }

    /**
     * One-shot import of a Brevo contact export. Reads the `_listIds`
     * (`[2|21|24]`), `_SUBSCRIBED` and `_BLOCKLISTED` columns: captures every
     * contact (name from FIRSTNAME/LASTNAME, phone from SMS), sets consent/status,
     * and auto-creates + assigns the lists (named from the festival's Brevo list
     * map, falling back to "Brevo list <id>"). Idempotent — safe to re-run.
     *
     * @param array<int,string> $names  brevo list id => name (defaults to the baked map)
     * @return array{ok:bool,contacts?:int,lists_created?:int,members?:int}
     */
    public static function import_brevo(string $path, array $names = []): array {
        if (! is_readable($path)) {
            return ['ok' => false];
        }
        $names = $names ?: self::BREVO_LIST_NAMES;
        $fh = fopen($path, 'r');
        if (! $fh) {
            return ['ok' => false];
        }
        $header = fgetcsv($fh);
        if (! is_array($header)) {
            fclose($fh);
            return ['ok' => false];
        }
        $cols = array_map(static function ($h) { return strtolower(trim((string) $h)); }, $header);
        $idx  = static function (string $n) use ($cols) {
            $i = array_search($n, $cols, true);
            return $i !== false ? (int) $i : -1;
        };
        $i_email = $idx('email');
        $i_first = $idx('firstname');
        $i_last  = $idx('lastname');
        $i_sms   = $idx('sms');
        $i_land  = $idx('landline_number');
        $i_lists = $idx('_listids');
        $i_sub   = $idx('_subscribed');
        $i_block = $idx('_blocklisted');
        if ($i_email < 0) {
            fclose($fh);
            return ['ok' => false];
        }

        global $wpdb;
        $now      = current_time('mysql', true);
        $ext_to_id = [];   // brevo list id => internal list id (cached for the run)
        $contacts = 0;
        $members  = 0;
        $created  = 0;

        while (($row = fgetcsv($fh)) !== false) {
            $email = trim((string) ($row[$i_email] ?? ''));
            if (! is_email($email)) {
                continue;
            }
            $name  = trim(($i_first >= 0 ? (string) ($row[$i_first] ?? '') : '') . ' ' . ($i_last >= 0 ? (string) ($row[$i_last] ?? '') : ''));
            $phone = $i_sms >= 0 ? trim((string) ($row[$i_sms] ?? '')) : '';
            if ($phone === '' && $i_land >= 0) { $phone = trim((string) ($row[$i_land] ?? '')); }
            $sub   = $i_sub >= 0 ? (string) ($row[$i_sub] ?? '') : '';
            $block = $i_block >= 0 ? trim((string) ($row[$i_block] ?? '')) : '';

            $cid = Contacts::capture($email, [
                'name'       => $name,
                'phone'      => $phone,
                'sms_opt_in' => strpos($sub, 'sms_marketing') !== false ? 1 : 0,
                'source'     => 'brevo',
            ]);
            if ($cid <= 0) {
                continue;
            }
            $contacts++;

            // Respect consent: blocklisted or no email-marketing opt-in => unsubscribed.
            if ($block !== '' || strpos($sub, 'email_marketing') === false) {
                $wpdb->update(Contacts::table(), ['status' => Contacts::STATUS_UNSUBSCRIBED, 'updated_at' => $now], ['id' => $cid]);
            }

            $raw = $i_lists >= 0 ? trim((string) ($row[$i_lists] ?? ''), " \t\n\r\0\x0B[]") : '';
            if ($raw === '') {
                continue;
            }
            foreach (explode('|', $raw) as $lid) {
                $lid = (int) trim($lid);
                if ($lid <= 0) {
                    continue;
                }
                if (! isset($ext_to_id[$lid])) {
                    $label    = $names[$lid] ?? ('Brevo list ' . $lid);
                    $existing = $wpdb->get_var($wpdb->prepare('SELECT id FROM ' . self::lists_table() . ' WHERE name = %s', $label));
                    if ($existing) {
                        $ext_to_id[$lid] = (int) $existing;
                    } else {
                        $ext_to_id[$lid] = self::create($label);
                        $created++;
                    }
                }
                self::add_contact($ext_to_id[$lid], $cid);
                $members++;
            }
        }
        fclose($fh);
        return ['ok' => true, 'contacts' => $contacts, 'lists_created' => $created, 'members' => $members];
    }

    /**
     * Import a CSV into a list — captures each contact and adds it as a member.
     * Same column detection as {@see Contacts::import_csv}. Returns rows added.
     */
    public static function import_csv_to_list(int $list_id, string $path): int {
        if ($list_id <= 0 || ! is_readable($path)) {
            return 0;
        }
        $fh = fopen($path, 'r');
        if (! $fh) {
            return 0;
        }
        $header = fgetcsv($fh);
        if (! is_array($header)) {
            fclose($fh);
            return 0;
        }
        $cols = array_map(static function ($h) { return strtolower(trim((string) $h)); }, $header);
        $find = static function (array $names) use ($cols) {
            foreach ($names as $n) {
                $i = array_search($n, $cols, true);
                if ($i !== false) { return (int) $i; }
            }
            return -1;
        };
        $i_email = $find(['email', 'email address', 'e-mail']);
        $i_name  = $find(['name', 'full name', 'contact name']);
        $i_first = $find(['first name', 'firstname', 'first']);
        $i_last  = $find(['last name', 'lastname', 'last']);
        $i_phone = $find(['phone', 'sms', 'mobile', 'phone number']);
        if ($i_email < 0) { $i_email = 0; }

        $added = 0;
        while (($row = fgetcsv($fh)) !== false) {
            $email = isset($row[$i_email]) ? trim((string) $row[$i_email]) : '';
            if (! is_email($email)) {
                continue;
            }
            $name = $i_name >= 0 ? trim((string) ($row[$i_name] ?? '')) : trim(
                ($i_first >= 0 ? (string) ($row[$i_first] ?? '') : '') . ' ' . ($i_last >= 0 ? (string) ($row[$i_last] ?? '') : '')
            );
            $cid = Contacts::capture($email, [
                'name'   => $name,
                'phone'  => $i_phone >= 0 ? (string) ($row[$i_phone] ?? '') : '',
                'source' => 'import',
            ]);
            if ($cid > 0) {
                self::add_contact($list_id, $cid);
                $added++;
            }
        }
        fclose($fh);
        return $added;
    }
}
