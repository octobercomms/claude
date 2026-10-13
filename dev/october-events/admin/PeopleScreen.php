<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\People\Repository;
use OE\People\Segments;

defined('ABSPATH') || exit;

/**
 * "People" / CRM admin screen (BUILD-PLAN M5, redesigned for ADMIN-BUILD AD8).
 *
 * The unified people table with group chips (built-in + saved smart groups), a
 * smart-group rule builder, a designed table, and a person record that opens as
 * a slide-in panel. Segments resolve to parameterised SQL in {@see Segments}.
 */
final class PeopleScreen {

    public static function init(): void {
        add_action('admin_post_oe_people_rebuild', [self::class, 'rebuild']);
        add_action('admin_post_oe_people_save_segment', [self::class, 'save_segment']);
        add_action('admin_post_oe_people_delete_segment', [self::class, 'delete_segment']);
    }

    private static function cap(): string {
        return SectionAccess::cap('contacts');
    }

    /** Resolve the active rule set + its source from the request. */
    private static function active_rules(): array {
        // phpcs:disable WordPress.Security.NonceVerification -- read-only filtering
        $group = isset($_GET['group']) ? sanitize_key((string) $_GET['group']) : 'all';
        if ($group !== '' && $group !== 'custom') {
            $rules = Segments::rules_for($group);
            if ($rules !== null) {
                return ['group' => $group, 'rules' => $rules];
            }
        }
        // Ad-hoc rule builder.
        $rules = [];
        if (isset($_GET['rbf']) && is_array($_GET['rbf'])) {
            $fs = array_map('strval', (array) $_GET['rbf']);
            $os = isset($_GET['rbo']) ? array_map('strval', (array) $_GET['rbo']) : [];
            $vs = isset($_GET['rbv']) ? array_map('strval', (array) $_GET['rbv']) : [];
            foreach ($fs as $i => $f) {
                if ($f === '') { continue; }
                $rules[] = ['field' => $f, 'op' => $os[$i] ?? 'gte', 'value' => $vs[$i] ?? ''];
            }
            $rules = Segments::sanitize_rules($rules);
        }
        // phpcs:enable
        return ['group' => $rules ? 'custom' : 'all', 'rules' => $rules];
    }

    public static function render(): void {
        if (! current_user_can(self::cap())) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $view = isset($_GET['person']) ? (int) $_GET['person'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
        // Deep link by email (e.g. from the Accounts list → the shared record).
        if (! $view && isset($_GET['person_email'])) { // phpcs:ignore WordPress.Security.NonceVerification
            $view = Repository::id_by_email(sanitize_email((string) wp_unslash($_GET['person_email']))); // phpcs:ignore WordPress.Security.NonceVerification
        }
        $term = isset($_GET['s']) ? sanitize_text_field((string) wp_unslash($_GET['s'])) : ''; // phpcs:ignore WordPress.Security.NonceVerification

        $state  = self::active_rules();
        $rules  = $state['rules'];
        $group  = $state['group'];
        $people = Segments::query($rules, $term, 200);

        echo '<div class="wrap oe-admin oe-crm">';
        \OE\Admin\Admin::people_header('crm', '<a class="button" href="' . esc_url(admin_url('admin.php?page=oe-contacts')) . '">' . esc_html__('Contacts &amp; lists', 'october-events') . '</a> <span class="oe-crm-total">' . esc_html(number_format_i18n((int) Repository::count())) . '</span>');
        \OE\Admin\Admin::bento('contacts');

        self::notices();
        self::chips($group, $term);
        self::rule_builder($rules, $group);

        echo '<div class="oe-ad-card" style="padding:0;margin-top:16px;">';
        self::table($people, $view);
        echo '</div>';
        echo '<p class="oe-ad-note">' . esc_html(sprintf(__('Showing %1$s people in “%2$s”. Built automatically on email from orders, volunteer signups, the pool and contacts; the daily rebuild keeps it current.', 'october-events'), number_format_i18n(count($people)), self::group_label($group))) . '</p>';

        // Slide-in person record.
        if ($view > 0) {
            self::slide_in($view);
        }
        echo '</div>';
    }

    private static function notices(): void {
        $rebuild = wp_nonce_url(admin_url('admin-post.php?action=oe_people_rebuild'), 'oe_people_rebuild');
        echo '<p style="margin:4px 0 14px"><a href="' . esc_url($rebuild) . '" class="button">' . esc_html__('Rebuild from records', 'october-events') . '</a>';
        if (isset($_GET['rebuilt'])) { // phpcs:ignore WordPress.Security.NonceVerification
            echo ' <span style="color:#1a7f37">' . esc_html(sprintf(__('Rebuilt — %d people.', 'october-events'), (int) $_GET['rebuilt'])) . '</span>';
        }
        if (isset($_GET['saved_group'])) { // phpcs:ignore WordPress.Security.NonceVerification
            echo ' <span style="color:#1a7f37">' . esc_html__('Smart group saved.', 'october-events') . '</span>';
        }
        echo '</p>';
    }

    /** Group chips: presets then saved, each with a live count. */
    private static function chips(string $active, string $term): void {
        $base = ['page' => 'oe-people'];
        if ($term !== '') { $base['s'] = $term; }

        echo '<div class="oe-ad-fchiprow oe-crm-chips">';
        foreach (Segments::presets() as $key => $seg) {
            self::chip($key, $seg['label'], Segments::count($seg['rules']), $active === $key, $base, false);
        }
        foreach (Segments::saved() as $key => $seg) {
            self::chip($key, $seg['label'], Segments::count((array) $seg['rules']), $active === $key, $base, true);
        }
        echo '</div>';
    }

    private static function chip(string $key, string $label, int $count, bool $on, array $base, bool $removable): void {
        $url = add_query_arg(array_merge($base, ['group' => $key]), admin_url('admin.php'));
        echo '<span class="oe-crm-chipwrap">';
        echo '<a class="oe-ad-fchip' . ($on ? ' is-on' : '') . '" href="' . esc_url($url) . '">'
            . esc_html($label) . ' <b>' . esc_html(number_format_i18n($count)) . '</b></a>';
        if ($removable) {
            $del = wp_nonce_url(admin_url('admin-post.php?action=oe_people_delete_segment&key=' . rawurlencode($key)), 'oe_people_delete_segment');
            echo '<a class="oe-crm-chipdel" href="' . esc_url($del) . '" title="' . esc_attr__('Delete this group', 'october-events') . '" onclick="return confirm(\'' . esc_js(__('Delete this smart group?', 'october-events')) . '\');">×</a>';
        }
        echo '</span>';
    }

    /** The smart-group rule builder — add field/op/value rows and save as a chip. */
    private static function rule_builder(array $rules, string $group): void {
        $fields = Segments::fields();
        $ops    = Segments::ops();
        if (! $rules) {
            $rules = [['field' => '', 'op' => 'gte', 'value' => '']];
        }
        echo '<details class="oe-ad-card oe-crm-rb"' . ($group === 'custom' ? ' open' : '') . '>';
        echo '<summary style="cursor:pointer;font-weight:700;">' . esc_html__('Build a smart group', 'october-events') . '</summary>';
        echo '<form method="get" action="' . esc_url(admin_url('admin.php')) . '" class="oe-crm-rbform" style="margin-top:12px;">';
        echo '<input type="hidden" name="page" value="oe-people">';
        echo '<div class="oe-crm-rules">';
        foreach ($rules as $r) {
            self::rule_row($fields, $ops, (array) $r);
        }
        echo '</div>';
        echo '<p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        echo '<button type="button" class="button button-small" id="oe-crm-addrule">+ ' . esc_html__('Add condition', 'october-events') . '</button>';
        echo '<button type="submit" class="button button-primary button-small">' . esc_html__('Apply', 'october-events') . '</button>';
        echo '<a class="button button-small" href="' . esc_url(admin_url('admin.php?page=oe-people')) . '">' . esc_html__('Clear', 'october-events') . '</a>';
        echo '</p>';
        echo '</form>';

        // Save-as-group (POSTs the same rules with a name).
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="oe-crm-saveform" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        echo '<input type="hidden" name="action" value="oe_people_save_segment">';
        wp_nonce_field('oe_people_save_segment');
        foreach ($rules as $r) {
            $r = (array) $r;
            if (empty($r['field'])) { continue; }
            echo '<input type="hidden" name="rbf[]" value="' . esc_attr((string) $r['field']) . '">';
            echo '<input type="hidden" name="rbo[]" value="' . esc_attr((string) ($r['op'] ?? 'gte')) . '">';
            echo '<input type="hidden" name="rbv[]" value="' . esc_attr((string) ($r['value'] ?? '')) . '">';
        }
        echo '<input type="text" name="label" placeholder="' . esc_attr__('Name this group', 'october-events') . '" style="min-width:200px">';
        echo '<button type="submit" class="button button-small">' . esc_html__('Save as group', 'october-events') . '</button>';
        echo '<span class="description">' . esc_html__('Saved groups appear as chips above.', 'october-events') . '</span>';
        echo '</form>';
        echo '</details>';

        self::rule_builder_js($fields, $ops);
    }

    private static function rule_row(array $fields, array $ops, array $r): void {
        $f = (string) ($r['field'] ?? '');
        $o = (string) ($r['op'] ?? 'gte');
        $v = (string) ($r['value'] ?? '');
        echo '<div class="oe-crm-rule">';
        echo '<select name="rbf[]"><option value="">' . esc_html__('— field —', 'october-events') . '</option>';
        foreach ($fields as $fk => $fl) {
            echo '<option value="' . esc_attr($fk) . '" ' . selected($f, $fk, false) . '>' . esc_html($fl) . '</option>';
        }
        echo '</select>';
        echo '<select name="rbo[]">';
        foreach ($ops as $ok => $ol) {
            echo '<option value="' . esc_attr($ok) . '" ' . selected($o, $ok, false) . '>' . esc_html($ol) . '</option>';
        }
        echo '</select>';
        echo '<input type="text" name="rbv[]" value="' . esc_attr($v) . '" placeholder="' . esc_attr__('value', 'october-events') . '" style="width:90px">';
        echo '<button type="button" class="button-link oe-crm-delrule" title="' . esc_attr__('Remove', 'october-events') . '">×</button>';
        echo '</div>';
    }

    private static function rule_builder_js(array $fields, array $ops): void {
        $fopts = '<option value="">' . esc_html__('— field —', 'october-events') . '</option>';
        foreach ($fields as $fk => $fl) { $fopts .= '<option value="' . esc_attr($fk) . '">' . esc_html($fl) . '</option>'; }
        $oopts = '';
        foreach ($ops as $ok => $ol) { $oopts .= '<option value="' . esc_attr($ok) . '">' . esc_html($ol) . '</option>'; }
        ?>
        <script>
        (function () {
            var add = document.getElementById('oe-crm-addrule');
            var box = document.querySelector('.oe-crm-rules');
            if (!add || !box) { return; }
            function wire(row) {
                var del = row.querySelector('.oe-crm-delrule');
                if (del) { del.addEventListener('click', function () { if (box.children.length > 1) { row.remove(); } else { row.querySelectorAll('input,select').forEach(function (e) { e.value = ''; }); } }); }
            }
            box.querySelectorAll('.oe-crm-rule').forEach(wire);
            add.addEventListener('click', function () {
                var row = document.createElement('div');
                row.className = 'oe-crm-rule';
                row.innerHTML = '<select name="rbf[]"><?php echo esc_js($fopts); ?></select>'
                    + '<select name="rbo[]"><?php echo esc_js($oopts); ?></select>'
                    + '<input type="text" name="rbv[]" placeholder="<?php echo esc_js(__('value', 'october-events')); ?>" style="width:90px">'
                    + '<button type="button" class="button-link oe-crm-delrule" title="×">×</button>';
                box.appendChild(row);
                wire(row);
            });
        })();
        </script>
        <?php
    }

    private static function group_label(string $group): string {
        if ($group === 'custom') { return __('custom filter', 'october-events'); }
        $presets = Segments::presets();
        if (isset($presets[$group])) { return $presets[$group]['label']; }
        $saved = Segments::saved();
        if (isset($saved[$group])) { return (string) $saved[$group]['label']; }
        return __('Everyone', 'october-events');
    }

    /** @param array<int,object> $people */
    private static function table(array $people, int $active): void {
        if (! $people) {
            echo '<div style="padding:22px"><strong>' . esc_html__('No people match.', 'october-events') . '</strong><br><span class="description">' . esc_html__('Try a different group, widen the rules, or rebuild from records.', 'october-events') . '</span></div>';
            return;
        }
        $cur = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');
        echo '<table class="oe-ad-table"><thead><tr>';
        foreach ([__('Name', 'october-events'), __('Email', 'october-events'), __('Orders', 'october-events'), __('Tickets', 'october-events'), __('Spent', 'october-events'), __('Volunteer', 'october-events'), __('Tags', 'october-events'), __('Last seen', 'october-events'), ''] as $h) {
            echo '<th' . (in_array($h, ['Orders', 'Tickets', 'Spent', 'Volunteer'], true) ? ' class="oe-ad-num"' : '') . '>' . esc_html($h) . '</th>';
        }
        echo '</tr></thead><tbody>';
        foreach ($people as $p) {
            $url  = admin_url('admin.php?page=oe-people&person=' . (int) $p->id);
            $tags = array_filter([
                $p->pool ? __('pool', 'october-events') : '',
                $p->subscribed ? __('subscribed', 'october-events') : '',
            ]);
            echo '<tr' . ((int) $p->id === $active ? ' class="is-active"' : '') . '>';
            echo '<td><a href="' . esc_url($url) . '"><strong>' . esc_html((string) ($p->name ?: '—')) . '</strong></a></td>';
            echo '<td>' . esc_html((string) $p->email) . '</td>';
            echo '<td class="oe-ad-num">' . (int) $p->orders . '</td>';
            echo '<td class="oe-ad-num">' . (int) $p->tickets . '</td>';
            echo '<td class="oe-ad-num">' . esc_html($sym . number_format((float) $p->revenue, 0)) . '</td>';
            echo '<td class="oe-ad-num">' . (int) $p->volunteer . '</td>';
            echo '<td>';
            foreach ($tags as $tg) { echo '<span class="oe-ad-pill oe-ad-pill--info" style="margin-right:4px">' . esc_html($tg) . '</span>'; }
            echo '</td>';
            echo '<td>' . esc_html((string) ($p->last_seen ? date_i18n(get_option('date_format'), strtotime((string) $p->last_seen)) : '—')) . '</td>';
            echo '<td class="oe-ad-num"><a class="button button-small" href="' . esc_url($url) . '">' . esc_html__('Open', 'october-events') . '</a></td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
    }

    /** The person record as a right-hand slide-in panel. */
    private static function slide_in(int $id): void {
        $back = remove_query_arg('person');
        $p    = Repository::get($id);
        echo '<a class="oe-crm-backdrop" href="' . esc_url($back) . '" aria-label="' . esc_attr__('Close', 'october-events') . '"></a>';
        echo '<aside class="oe-crm-slide" role="dialog" aria-label="' . esc_attr__('Person record', 'october-events') . '">';
        echo '<a class="oe-crm-slide-x" href="' . esc_url($back) . '" aria-label="' . esc_attr__('Close', 'october-events') . '">×</a>';
        if (! $p) {
            echo '<h2>' . esc_html__('Person not found', 'october-events') . '</h2></aside>';
            return;
        }
        $detail = Repository::profile((string) $p->email);
        $cur = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');

        echo '<div class="oe-crm-slide-head">';
        echo '<h2>' . esc_html((string) ($p->name ?: $p->email)) . '</h2>';
        echo '<p class="description">' . esc_html((string) $p->email) . ($p->phone ? ' · ' . esc_html((string) $p->phone) : '') . '</p>';
        echo '</div>';

        echo '<div class="oe-crm-slide-stats">';
        foreach ([
            [__('Orders', 'october-events'), number_format_i18n((int) $p->orders)],
            [__('Tickets', 'october-events'), number_format_i18n((int) $p->tickets)],
            [__('Spent', 'october-events'), $sym . number_format((float) $p->revenue, 0)],
            [__('Volunteer', 'october-events'), number_format_i18n((int) $p->volunteer)],
        ] as $s) {
            echo '<div class="oe-crm-ministat"><div class="l">' . esc_html($s[0]) . '</div><div class="v">' . esc_html($s[1]) . '</div></div>';
        }
        echo '</div>';

        if (! empty($detail['orders'])) {
            echo '<h3>' . esc_html__('Orders', 'october-events') . '</h3><table class="oe-ad-table"><tbody>';
            foreach ($detail['orders'] as $o) {
                echo '<tr><td>#' . (int) $o->id . '</td><td>' . esc_html((string) ($o->ticket_type_label ?: get_the_title((int) $o->event_id))) . '</td>'
                    . '<td class="oe-ad-num">' . (int) $o->qty . '</td>'
                    . '<td class="oe-ad-num">' . esc_html(strtoupper((string) $o->currency) . ' ' . number_format((float) $o->total, 2)) . '</td>'
                    . '<td>' . esc_html((string) $o->status) . '</td></tr>';
            }
            echo '</tbody></table>';
        }
        if (! empty($detail['volunteer'])) {
            echo '<h3>' . esc_html__('Volunteer signups', 'october-events') . '</h3><table class="oe-ad-table"><tbody>';
            foreach ($detail['volunteer'] as $v) {
                echo '<tr><td>' . esc_html((string) get_the_title((int) $v->opportunity_id)) . '</td><td>' . esc_html((string) $v->status) . '</td><td>' . esc_html((string) $v->created_at) . '</td></tr>';
            }
            echo '</tbody></table>';
        }
        echo '<p style="margin-top:16px"><a class="button" href="mailto:' . esc_attr((string) $p->email) . '">' . esc_html__('Email this person', 'october-events') . '</a></p>';
        echo '</aside>';
    }

    /* ----------------------------------------------------------- handlers */

    public static function save_segment(): void {
        if (! current_user_can(self::cap()) || ! check_admin_referer('oe_people_save_segment')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $label = sanitize_text_field(wp_unslash((string) ($_POST['label'] ?? '')));
        $rules = [];
        if (isset($_POST['rbf']) && is_array($_POST['rbf'])) {
            $fs = array_map('strval', (array) wp_unslash($_POST['rbf']));
            $os = isset($_POST['rbo']) ? array_map('strval', (array) wp_unslash($_POST['rbo'])) : [];
            $vs = isset($_POST['rbv']) ? array_map('strval', (array) wp_unslash($_POST['rbv'])) : [];
            foreach ($fs as $i => $f) {
                if ($f === '') { continue; }
                $rules[] = ['field' => $f, 'op' => $os[$i] ?? 'gte', 'value' => $vs[$i] ?? ''];
            }
        }
        $key = ($label !== '' && $rules) ? Segments::save($label, $rules) : '';
        $args = ['page' => 'oe-people'];
        if ($key !== '') { $args['group'] = $key; $args['saved_group'] = 1; }
        wp_safe_redirect(add_query_arg($args, admin_url('admin.php')));
        exit;
    }

    public static function delete_segment(): void {
        $key = isset($_GET['key']) ? sanitize_text_field(wp_unslash((string) $_GET['key'])) : '';
        if (! current_user_can(self::cap()) || ! check_admin_referer('oe_people_delete_segment')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        if ($key !== '') { Segments::delete($key); }
        wp_safe_redirect(admin_url('admin.php?page=oe-people'));
        exit;
    }

    public static function rebuild(): void {
        if (! current_user_can(self::cap()) || ! check_admin_referer('oe_people_rebuild')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $n = Repository::rebuild();
        wp_safe_redirect(add_query_arg('rebuilt', $n, admin_url('admin.php?page=oe-people')));
        exit;
    }
}
