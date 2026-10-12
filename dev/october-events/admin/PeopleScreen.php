<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\People\Repository;

defined('ABSPATH') || exit;

/**
 * "People" admin screen (BUILD-PLAN M5 — CRM unification). Search the unified
 * people table and open one person to see their merged activity (orders,
 * volunteer signups) joined live. A Rebuild action recomputes the table from
 * the source records; the daily cron keeps it fresh otherwise.
 */
final class PeopleScreen {

    public static function init(): void {
        add_action('admin_post_oe_people_rebuild', [self::class, 'rebuild']);
    }

    public static function render(): void {
        if (! current_user_can(SectionAccess::cap('contacts'))) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $view = isset($_GET['person']) ? (int) $_GET['person'] : 0;
        echo '<div class="wrap">';
        if ($view > 0) {
            self::profile($view);
            echo '</div>';
            return;
        }

        $term = isset($_GET['s']) ? sanitize_text_field((string) wp_unslash($_GET['s'])) : '';
        echo '<h1>' . esc_html__('People', 'october-events') . ' <span class="title-count">' . (int) Repository::count() . '</span></h1>';
        echo '<p class="description">' . esc_html__('Everyone on this site, merged on email from ticket orders, volunteer signups, the recruitment pool and the contact list.', 'october-events') . '</p>';

        // Rebuild + search.
        $rebuild = wp_nonce_url(admin_url('admin-post.php?action=oe_people_rebuild'), 'oe_people_rebuild');
        echo '<p><a href="' . esc_url($rebuild) . '" class="button">' . esc_html__('Rebuild from records', 'october-events') . '</a>';
        if (isset($_GET['rebuilt'])) {
            echo ' <span style="color:#1a7f37">' . esc_html(sprintf(__('Rebuilt — %d people.', 'october-events'), (int) $_GET['rebuilt'])) . '</span>';
        }
        echo '</p>';
        echo '<form method="get" style="margin:0 0 12px"><input type="hidden" name="page" value="oe-people">';
        echo '<input type="search" name="s" value="' . esc_attr($term) . '" placeholder="' . esc_attr__('Search name or email', 'october-events') . '" style="min-width:260px"> ';
        echo '<button class="button">' . esc_html__('Search', 'october-events') . '</button></form>';

        $people = Repository::search($term, 100);
        if (! $people) {
            echo '<p>' . esc_html__('No people yet. Click “Rebuild from records” to populate from existing orders, volunteers and contacts.', 'october-events') . '</p></div>';
            return;
        }

        $cur = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');
        echo '<table class="widefat striped"><thead><tr>';
        foreach ([__('Name', 'october-events'), __('Email', 'october-events'), __('Orders', 'october-events'), __('Tickets', 'october-events'), __('Spent', 'october-events'), __('Volunteer', 'october-events'), __('Flags', 'october-events'), __('Last seen', 'october-events')] as $h) {
            echo '<th>' . esc_html($h) . '</th>';
        }
        echo '</tr></thead><tbody>';
        foreach ($people as $p) {
            $url = admin_url('admin.php?page=oe-people&person=' . (int) $p->id);
            $flags = array_filter([
                $p->pool ? esc_html__('pool', 'october-events') : '',
                $p->subscribed ? esc_html__('subscribed', 'october-events') : '',
            ]);
            printf(
                '<tr><td><a href="%s"><strong>%s</strong></a></td><td>%s</td><td>%d</td><td>%d</td><td>%s</td><td>%d</td><td>%s</td><td>%s</td></tr>',
                esc_url($url),
                esc_html((string) ($p->name ?: '—')),
                esc_html((string) $p->email),
                (int) $p->orders,
                (int) $p->tickets,
                esc_html($sym . number_format((float) $p->revenue, 2)),
                (int) $p->volunteer,
                esc_html(implode(' · ', $flags)),
                esc_html((string) ($p->last_seen ?: ''))
            );
        }
        echo '</tbody></table></div>';
    }

    private static function profile(int $id): void {
        $p = Repository::get($id);
        if (! $p) {
            echo '<h1>' . esc_html__('Person not found', 'october-events') . '</h1>';
            return;
        }
        $detail = Repository::profile((string) $p->email);
        $cur = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');

        echo '<p><a href="' . esc_url(admin_url('admin.php?page=oe-people')) . '">&larr; ' . esc_html__('All people', 'october-events') . '</a></p>';
        echo '<h1>' . esc_html((string) ($p->name ?: $p->email)) . '</h1>';
        echo '<p class="description">' . esc_html((string) $p->email) . ($p->phone ? ' · ' . esc_html((string) $p->phone) : '') . '</p>';

        echo '<p>';
        printf('<strong>%d</strong> %s · ', (int) $p->orders, esc_html__('orders', 'october-events'));
        printf('<strong>%d</strong> %s · ', (int) $p->tickets, esc_html__('tickets', 'october-events'));
        printf('<strong>%s</strong> %s · ', esc_html($sym . number_format((float) $p->revenue, 2)), esc_html__('spent', 'october-events'));
        printf('<strong>%d</strong> %s', (int) $p->volunteer, esc_html__('volunteer signups', 'october-events'));
        if ($p->pool) { echo ' · ' . esc_html__('in the volunteer pool', 'october-events'); }
        if ($p->subscribed) { echo ' · ' . esc_html__('subscribed', 'october-events'); }
        echo '</p>';

        if ($detail['orders']) {
            echo '<h2>' . esc_html__('Orders', 'october-events') . '</h2><table class="widefat striped" style="max-width:720px"><tbody>';
            foreach ($detail['orders'] as $o) {
                printf(
                    '<tr><td>#%d</td><td>%s</td><td>%d</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                    (int) $o->id,
                    esc_html((string) ($o->ticket_type_label ?: get_the_title((int) $o->event_id))),
                    (int) $o->qty,
                    esc_html(strtoupper((string) $o->currency) . ' ' . number_format((float) $o->total, 2)),
                    esc_html((string) $o->status),
                    esc_html((string) $o->created_at)
                );
            }
            echo '</tbody></table>';
        }
        if ($detail['volunteer']) {
            echo '<h2>' . esc_html__('Volunteer signups', 'october-events') . '</h2><table class="widefat striped" style="max-width:720px"><tbody>';
            foreach ($detail['volunteer'] as $v) {
                printf(
                    '<tr><td>#%d</td><td>%s</td><td>%s</td><td>%s</td></tr>',
                    (int) $v->id,
                    esc_html((string) get_the_title((int) $v->opportunity_id)),
                    esc_html((string) $v->status),
                    esc_html((string) $v->created_at)
                );
            }
            echo '</tbody></table>';
        }
    }

    public static function rebuild(): void {
        if (! current_user_can(SectionAccess::cap('contacts')) || ! check_admin_referer('oe_people_rebuild')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $n = Repository::rebuild();
        wp_safe_redirect(add_query_arg('rebuilt', $n, admin_url('admin.php?page=oe-people')));
        exit;
    }
}
