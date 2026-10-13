<?php
declare(strict_types=1);

namespace OE\Porter;

use OE\Crew\Crew;
use OE\Crew\Schema as CrewSchema;
use OE\Mail\Contacts;

defined('ABSPATH') || exit;

/**
 * CSV importer (ADMIN-BUILD AD13) with column mapping, a dry-run preview, and
 * dedupe-on-key upserts. Mapping templates are saved per target so a recurring
 * import is one click. Targets are limited to entities with a safe idempotent
 * upsert (contacts, team), keyed on email.
 */
final class Importer {

    private const TEMPLATES = 'oe_import_templates';

    /**
     * @return array<string,array{label:string,key:string,fields:array<string,string>}>
     */
    public static function targets(): array {
        return [
            'contacts' => [
                'label'  => __('Contacts', 'october-events'),
                'key'    => 'email',
                'fields' => [
                    'email'      => __('Email', 'october-events'),
                    'name'       => __('Name', 'october-events'),
                    'phone'      => __('Phone', 'october-events'),
                    'sms_opt_in' => __('SMS opt-in (1/0)', 'october-events'),
                ],
            ],
            'team' => [
                'label'  => __('Team / crew', 'october-events'),
                'key'    => 'email',
                'fields' => [
                    'email'       => __('Email', 'october-events'),
                    'name'        => __('Name', 'october-events'),
                    'phone'       => __('Phone', 'october-events'),
                    'tier'        => __('Tier (planning/council/board)', 'october-events'),
                    'role_title'  => __('Role title', 'october-events'),
                    'role_owns'   => __('What the role owns', 'october-events'),
                    'hours_month' => __('Hours / month', 'october-events'),
                    'role_email'  => __('Role email', 'october-events'),
                ],
            ],
        ];
    }

    public static function target(string $key): ?array {
        return self::targets()[$key] ?? null;
    }

    /** First row of the CSV as header strings. @return array<int,string> */
    public static function headers(string $path): array {
        $rows = self::read($path, 1);
        return $rows[0] ?? [];
    }

    /**
     * Read the CSV into rows of header=>value. Limited to $limit data rows when
     * > 0.
     *
     * @return array<int,array<string,string>>
     */
    public static function rows(string $path, int $limit = 0): array {
        $raw = self::read($path, $limit > 0 ? $limit + 1 : 0);
        if (! $raw) {
            return [];
        }
        $headers = array_shift($raw);
        $out = [];
        foreach ($raw as $line) {
            $row = [];
            foreach ($headers as $i => $h) {
                $row[(string) $h] = (string) ($line[$i] ?? '');
            }
            $out[] = $row;
        }
        return $out;
    }

    /**
     * Dry-run: classify each mapped row as create / update / skip without
     * writing. $map is target field => CSV header.
     *
     * @param array<string,string> $map
     * @return array{created:int,updated:int,skipped:int,sample:array<int,array<string,string>>,total:int}
     */
    public static function preview(string $target, string $path, array $map, int $limit = 2000): array {
        $spec = self::target($target);
        $res  = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'sample' => [], 'total' => 0];
        if (! $spec) {
            return $res;
        }
        $keyfield = $spec['key'];
        $keycol   = $map[$keyfield] ?? '';
        foreach (self::rows($path, $limit) as $row) {
            $res['total']++;
            $mapped = self::map_row($row, $map, $spec['fields']);
            $keyval = strtolower(trim((string) ($mapped[$keyfield] ?? '')));
            if ($keyval === '' || ! is_email($keyval)) {
                $res['skipped']++;
                continue;
            }
            $exists = self::exists($target, $keyval);
            $exists ? $res['updated']++ : $res['created']++;
            if (count($res['sample']) < 8) {
                $mapped['_action'] = $exists ? 'update' : 'create';
                $res['sample'][] = $mapped;
            }
        }
        return $res;
    }

    /**
     * Commit the import. Returns the same counts as preview (minus sample).
     *
     * @param array<string,string> $map
     * @return array{created:int,updated:int,skipped:int,total:int}
     */
    public static function commit(string $target, string $path, array $map): array {
        $spec = self::target($target);
        $res  = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'total' => 0];
        if (! $spec) {
            return $res;
        }
        $keyfield = $spec['key'];
        foreach (self::rows($path) as $row) {
            $res['total']++;
            $mapped = self::map_row($row, $map, $spec['fields']);
            $keyval = strtolower(trim((string) ($mapped[$keyfield] ?? '')));
            if ($keyval === '' || ! is_email($keyval)) {
                $res['skipped']++;
                continue;
            }
            $existed = self::exists($target, $keyval);
            $ok = self::upsert($target, $keyval, $mapped);
            if (! $ok) {
                $res['skipped']++;
            } elseif ($existed) {
                $res['updated']++;
            } else {
                $res['created']++;
            }
        }
        return $res;
    }

    /* ---------------------------------------------------- target plumbing */

    private static function exists(string $target, string $email): bool {
        if ($target === 'contacts') {
            return (bool) Contacts::get($email);
        }
        if ($target === 'team') {
            global $wpdb;
            $t = CrewSchema::table();
            return (bool) $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE email = %s LIMIT 1", $email));
        }
        return false;
    }

    /** @param array<string,string> $mapped */
    private static function upsert(string $target, string $email, array $mapped): bool {
        if ($target === 'contacts') {
            return (bool) Contacts::capture($email, [
                'name'       => (string) ($mapped['name'] ?? ''),
                'phone'      => (string) ($mapped['phone'] ?? ''),
                'sms_opt_in' => in_array(strtolower(trim((string) ($mapped['sms_opt_in'] ?? ''))), ['1', 'yes', 'true'], true) ? 1 : 0,
                'source'     => 'import',
            ]);
        }
        if ($target === 'team') {
            $data = [
                'email'       => $email,
                'name'        => (string) ($mapped['name'] ?? ''),
                'phone'       => (string) ($mapped['phone'] ?? ''),
                'tier'        => (string) ($mapped['tier'] ?? Crew::TIER_PLANNING),
                'role_title'  => (string) ($mapped['role_title'] ?? ''),
                'role_owns'   => (string) ($mapped['role_owns'] ?? ''),
                'hours_month' => (string) ($mapped['hours_month'] ?? ''),
                'role_email'  => (string) ($mapped['role_email'] ?? ''),
            ];
            global $wpdb;
            $t  = CrewSchema::table();
            $id = (int) $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE email = %s LIMIT 1", $email));
            if ($id) {
                return Crew::update($id, $data);
            }
            return Crew::insert($data) > 0;
        }
        return false;
    }

    /* ------------------------------------------------------- CSV helpers */

    /** @return array<int,array<int,string>> */
    private static function read(string $path, int $max = 0): array {
        if (! is_readable($path)) {
            return [];
        }
        $out = [];
        $fh = fopen($path, 'r');
        if (! $fh) {
            return [];
        }
        $n = 0;
        while (($line = fgetcsv($fh)) !== false) {
            $out[] = array_map('strval', $line);
            $n++;
            if ($max > 0 && $n >= $max) {
                break;
            }
        }
        fclose($fh);
        return $out;
    }

    /**
     * @param array<string,string> $row    header=>value
     * @param array<string,string> $map    field=>header
     * @param array<string,string> $fields field=>label (the allowed fields)
     * @return array<string,string>
     */
    private static function map_row(array $row, array $map, array $fields): array {
        $clean = [];
        foreach (array_keys($fields) as $field) {
            $header = $map[$field] ?? '';
            $clean[$field] = ($header !== '' && array_key_exists($header, $row)) ? trim((string) $row[$header]) : '';
        }
        return $clean;
    }

    /* ----------------------------------------------------------- templates */

    /** @return array<string,array<string,string>> name => map, for a target */
    public static function templates(string $target): array {
        $all = get_option(self::TEMPLATES, []);
        $all = is_array($all) ? $all : [];
        return isset($all[$target]) && is_array($all[$target]) ? $all[$target] : [];
    }

    /** @param array<string,string> $map */
    public static function save_template(string $target, string $name, array $map): void {
        $name = trim(sanitize_text_field($name));
        if ($target === '' || $name === '') {
            return;
        }
        $all = get_option(self::TEMPLATES, []);
        $all = is_array($all) ? $all : [];
        if (! isset($all[$target]) || ! is_array($all[$target])) {
            $all[$target] = [];
        }
        $clean = [];
        foreach ($map as $field => $header) {
            $clean[sanitize_key((string) $field)] = sanitize_text_field((string) $header);
        }
        $all[$target][$name] = $clean;
        update_option(self::TEMPLATES, $all, false);
    }

    public static function delete_template(string $target, string $name): void {
        $all = get_option(self::TEMPLATES, []);
        if (is_array($all) && isset($all[$target][$name])) {
            unset($all[$target][$name]);
            update_option(self::TEMPLATES, $all, false);
        }
    }
}
