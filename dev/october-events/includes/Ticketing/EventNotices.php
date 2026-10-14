<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\AuditLog;
use OE\Mail\Transactional;
use OE\Planning\Events;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Notify ticket holders when an event is rescheduled or canceled (BUILD-PLAN
 * M6). A metabox on the event editor with two explicit, confirm-gated actions —
 * it never fires silently. The admin sees the holder count up front and a
 * browser confirm ("notify N holders?") before the send runs.
 *
 * Reuses Orders::attendees_for_event() (distinct paid holders) and the normal
 * transactional mailer; the send is admin-triggered, not automatic, so there is
 * no webhook or cron path. Each run is audit-logged.
 */
final class EventNotices {

    /** Max holders a single click will email, as a runaway guard. */
    private const CAP = 20000;

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('admin_post_oe_event_notice', [self::class, 'handle']);
    }

    public static function add(): void {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-event-notices', __('Notify ticket holders', 'october-events'), [self::class, 'render'], $pt, 'side', 'default');
    }

    public static function render(\WP_Post $post): void {
        $id = (int) $post->ID;
        $holders = count(Orders::attendees_for_event($id));

        if (isset($_GET['oe_notice_sent'])) {
            printf(
                '<div class="notice notice-success inline" style="margin:0 0 10px"><p>%s</p></div>',
                esc_html(sprintf(
                    /* translators: %d: number of holders emailed */
                    _n('Notice sent to %d ticket holder.', 'Notice sent to %d ticket holders.', (int) $_GET['oe_notice_sent'], 'october-events'),
                    (int) $_GET['oe_notice_sent']
                ))
            );
        }

        if ($holders === 0) {
            echo '<p class="description">' . esc_html__('No ticket holders yet. A notice will be available once this event has paid orders.', 'october-events') . '</p>';
            return;
        }

        echo '<p>' . esc_html(sprintf(
            /* translators: %d: holder count */
            _n('%d ticket holder on this event.', '%d ticket holders on this event.', $holders, 'october-events'),
            $holders
        )) . '</p>';

        echo '<p><label style="font-weight:600;display:block;margin-bottom:4px">' . esc_html__('Optional note (added to the email)', 'october-events') . '</label>';
        echo '<textarea name="oe_notice_note" form="oe-notice-form" style="width:100%;min-height:60px" placeholder="' . esc_attr__('e.g. the new date is two weeks later; same venue.', 'october-events') . '"></textarea></p>';

        $url = admin_url('admin-post.php');
        $confirm_r = esc_js(sprintf(__('Email all %d ticket holders that this event has been rescheduled?', 'october-events'), $holders));
        $confirm_c = esc_js(sprintf(__('Email all %d ticket holders that this event has been CANCELED? This cannot be undone.', 'october-events'), $holders));

        echo '<form id="oe-notice-form" method="post" action="' . esc_url($url) . '">';
        echo '<input type="hidden" name="action" value="oe_event_notice">';
        echo '<input type="hidden" name="id" value="' . esc_attr((string) $id) . '">';
        wp_nonce_field('oe_event_notice_' . $id);
        echo '<p><button type="submit" name="kind" value="rescheduled" class="button" onclick="return confirm(\'' . $confirm_r . '\')">' . esc_html__('Notify: rescheduled', 'october-events') . '</button></p>';
        echo '<p><button type="submit" name="kind" value="cancelled" class="button button-link-delete" onclick="return confirm(\'' . $confirm_c . '\')">' . esc_html__('Notify: canceled', 'october-events') . '</button></p>';
        echo '</form>';
        echo '<p class="description">' . esc_html__('Each button emails every holder once. You are asked to confirm first — it never sends on its own.', 'october-events') . '</p>';
    }

    public static function handle(): void {
        $id = absint($_POST['id'] ?? 0);
        if (! $id || ! current_user_can('edit_post', $id) || ! check_admin_referer('oe_event_notice_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $kind = (string) ($_POST['kind'] ?? '');
        if (! in_array($kind, ['rescheduled', 'cancelled'], true)) {
            wp_safe_redirect(get_edit_post_link($id, 'url'));
            exit;
        }
        $note = sanitize_textarea_field(wp_unslash((string) ($_POST['oe_notice_note'] ?? '')));
        $sent = self::send($id, $kind, $note);
        wp_safe_redirect(add_query_arg('oe_notice_sent', $sent, get_edit_post_link($id, 'url')));
        exit;
    }

    /** Email every distinct holder once; returns how many were emailed. */
    public static function send(int $event_id, string $kind, string $note = ''): int {
        $trigger = $kind === 'cancelled' ? 'event_cancelled' : 'event_rescheduled';
        $name    = (string) (Events::get($event_id, 'name', '') ?: get_the_title($event_id));
        $when    = $kind === 'rescheduled' ? (string) Events::get($event_id, 'start_datetime', '') : '';
        $url     = get_permalink($event_id) ?: '';

        $sent = 0;
        foreach (Orders::attendees_for_event($event_id) as $h) {
            if ($sent >= self::CAP) {
                break;
            }
            $email = (string) ($h->email ?? '');
            if ($email === '') {
                continue;
            }
            $ok = Transactional::send($trigger, ['email' => $email, 'name' => (string) ($h->name ?? '')], [
                'event_name' => $name,
                'when'       => $when,
                'note'       => $note,
                'event_url'  => $url,
            ]);
            if ($ok) {
                $sent++;
            }
        }
        AuditLog::record('event_' . $kind . '_notice', $event_id, 'event', (string) $sent);
        return $sent;
    }
}
