<?php
declare(strict_types=1);

namespace OE\People;

defined('ABSPATH') || exit;

/**
 * Smart groups for the CRM / People screen (ADMIN-BUILD AD8).
 *
 * A segment is a set of rules over the unified {@see Repository} table. Built-in
 * presets drive the quick "group chips"; admins can compose their own rules in
 * the rule builder and save them as named chips (stored in one option). Rules
 * are evaluated to a parameterised WHERE clause against a strict column +
 * operator whitelist, so nothing user-supplied reaches SQL unescaped.
 *
 * Rule shape: ['field' => <col>, 'op' => <op>, 'value' => <scalar>].
 */
final class Segments {

    private const OPTION = 'oe_people_segments';

    /** Column => value kind. Only these can appear in a rule. */
    private const FIELDS = [
        'orders'     => 'int',
        'tickets'    => 'int',
        'revenue'    => 'float',
        'volunteer'  => 'int',
        'pool'       => 'bool',
        'subscribed' => 'bool',
        'last_seen'  => 'days',   // "value" = number of days
        'first_seen' => 'days',
    ];

    /** Operator => SQL comparison. */
    private const OPS = [
        'gte' => '>=',
        'lte' => '<=',
        'gt'  => '>',
        'lt'  => '<',
        'eq'  => '=',
    ];

    public static function fields(): array {
        return [
            'orders'     => __('Orders', 'october-events'),
            'tickets'    => __('Tickets', 'october-events'),
            'revenue'    => __('Spent', 'october-events'),
            'volunteer'  => __('Volunteer signups', 'october-events'),
            'pool'       => __('In volunteer pool', 'october-events'),
            'subscribed' => __('Subscribed', 'october-events'),
            'last_seen'  => __('Seen in last N days', 'october-events'),
            'first_seen' => __('First seen in last N days', 'october-events'),
        ];
    }

    public static function ops(): array {
        return [
            'gte' => '≥',
            'lte' => '≤',
            'gt'  => '>',
            'lt'  => '<',
            'eq'  => '=',
        ];
    }

    /**
     * Built-in presets (the always-present chips).
     *
     * @return array<string,array{label:string,rules:array<int,array<string,mixed>>}>
     */
    public static function presets(): array {
        return [
            'all'         => ['label' => __('Everyone', 'october-events'),     'rules' => []],
            'buyers'      => ['label' => __('Buyers', 'october-events'),       'rules' => [['field' => 'orders', 'op' => 'gte', 'value' => 1]]],
            'subscribers' => ['label' => __('Subscribers', 'october-events'),  'rules' => [['field' => 'subscribed', 'op' => 'eq', 'value' => 1]]],
            'volunteers'  => ['label' => __('Volunteers', 'october-events'),   'rules' => [['field' => 'volunteer', 'op' => 'gte', 'value' => 1]]],
            'pool'        => ['label' => __('Volunteer pool', 'october-events'),'rules' => [['field' => 'pool', 'op' => 'eq', 'value' => 1]]],
            'vip'         => ['label' => __('VIP (spent 250+)', 'october-events'), 'rules' => [['field' => 'revenue', 'op' => 'gte', 'value' => 250]]],
            'new'         => ['label' => __('New (90 days)', 'october-events'), 'rules' => [['field' => 'first_seen', 'op' => 'lte', 'value' => 90]]],
        ];
    }

    /** @return array<string,array{label:string,rules:array}> saved custom segments */
    public static function saved(): array {
        $raw = get_option(self::OPTION, []);
        return is_array($raw) ? $raw : [];
    }

    /** Save a named custom segment. Returns its key. */
    public static function save(string $label, array $rules): string {
        $label = trim(sanitize_text_field($label));
        if ($label === '') {
            return '';
        }
        $rules = self::sanitize_rules($rules);
        $key   = 'c_' . substr(md5($label . microtime()), 0, 8);
        $all   = self::saved();
        $all[$key] = ['label' => $label, 'rules' => $rules];
        update_option(self::OPTION, $all, false);
        return $key;
    }

    public static function delete(string $key): void {
        $all = self::saved();
        unset($all[$key]);
        update_option(self::OPTION, $all, false);
    }

    /** Resolve a chip key (preset or saved) to its rules, or null. */
    public static function rules_for(string $key): ?array {
        $presets = self::presets();
        if (isset($presets[$key])) {
            return $presets[$key]['rules'];
        }
        $saved = self::saved();
        if (isset($saved[$key])) {
            return (array) $saved[$key]['rules'];
        }
        return null;
    }

    /**
     * Build a WHERE fragment (without the leading WHERE) and its bound params
     * from a rule set. Returns ['', []] for no rules.
     *
     * @param array<int,array<string,mixed>> $rules
     * @return array{0:string,1:array<int,mixed>}
     */
    public static function where(array $rules): array {
        $clauses = [];
        $params  = [];
        foreach ($rules as $rule) {
            $field = (string) ($rule['field'] ?? '');
            $op    = (string) ($rule['op'] ?? '');
            if (! isset(self::FIELDS[$field]) || ! isset(self::OPS[$op])) {
                continue;
            }
            $kind = self::FIELDS[$field];
            $sqlop = self::OPS[$op];

            if ($kind === 'days') {
                // last_seen >= now - N days  (op gte/lte flips the direction of
                // "recent"): treat value as a day window; "<=" means within.
                $days = max(0, (int) ($rule['value'] ?? 0));
                // Within N days -> column >= (now - N days). Older than -> column < .
                $cmp = in_array($op, ['lte', 'lt', 'eq'], true) ? '>=' : '<';
                $clauses[] = "{$field} {$cmp} %s";
                $params[]  = gmdate('Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS);
            } elseif ($kind === 'bool') {
                $clauses[] = "{$field} = %d";
                $params[]  = (int) (bool) ($rule['value'] ?? 0);
            } elseif ($kind === 'float') {
                $clauses[] = "{$field} {$sqlop} %f";
                $params[]  = (float) ($rule['value'] ?? 0);
            } else { // int
                $clauses[] = "{$field} {$sqlop} %d";
                $params[]  = (int) ($rule['value'] ?? 0);
            }
        }
        return [implode(' AND ', $clauses), $params];
    }

    /**
     * Count people matching a rule set.
     */
    public static function count(array $rules): int {
        global $wpdb;
        $t = Repository::table();
        [$where, $params] = self::where($rules);
        $sql = "SELECT COUNT(*) FROM {$t}";
        if ($where !== '') {
            $sql .= ' WHERE ' . $where;
            $sql  = $wpdb->prepare($sql, $params);
        }
        return (int) $wpdb->get_var($sql);
    }

    /**
     * People matching a rule set, with an optional free-text term.
     *
     * @return array<int,object>
     */
    public static function query(array $rules, string $term = '', int $limit = 100): array {
        global $wpdb;
        $t = Repository::table();
        [$where, $params] = self::where($rules);
        $clauses = [];
        if ($where !== '') {
            $clauses[] = $where;
        }
        if ($term !== '') {
            $like = '%' . $wpdb->esc_like($term) . '%';
            $clauses[] = '(email LIKE %s OR name LIKE %s)';
            $params[]  = $like;
            $params[]  = $like;
        }
        $sql = "SELECT * FROM {$t}";
        if ($clauses) {
            $sql .= ' WHERE ' . implode(' AND ', $clauses);
        }
        $sql     .= ' ORDER BY last_seen DESC LIMIT %d';
        $params[] = $limit;
        return $wpdb->get_results($wpdb->prepare($sql, $params)) ?: [];
    }

    /**
     * Sanitise a posted rule set down to the whitelist.
     *
     * @return array<int,array{field:string,op:string,value:mixed}>
     */
    public static function sanitize_rules(array $raw): array {
        $out = [];
        foreach ($raw as $rule) {
            if (! is_array($rule)) {
                continue;
            }
            $field = sanitize_key((string) ($rule['field'] ?? ''));
            $op    = sanitize_key((string) ($rule['op'] ?? ''));
            if (! isset(self::FIELDS[$field]) || ! isset(self::OPS[$op])) {
                continue;
            }
            $out[] = [
                'field' => $field,
                'op'    => $op,
                'value' => is_scalar($rule['value'] ?? '') ? $rule['value'] : '',
            ];
        }
        return $out;
    }
}
