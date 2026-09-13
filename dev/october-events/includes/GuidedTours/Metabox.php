<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Access;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Admin metabox on the tour Location post type (Settings → location_post_type):
 * add/edit guided-tour slots, generate a run of them, and see + export the
 * reservations. Slot times are entered in 24-hour <input type="time"> controls
 * (the browser requires it); the public page always renders 12-hour.
 */
final class Metabox {

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
        add_action('admin_post_oe_gt_export', [self::class, 'export']);
    }

    private static function post_type(): string {
        $pt = (string) Settings::get('location_post_type', '');
        return $pt !== '' ? $pt : \OE\PostTypes::slug('event');
    }

    public static function add(): void {
        $pt = self::post_type();
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-gt-slots', __('Guided tour slots', 'october-events'), [self::class, 'render'], $pt, 'normal', 'default');
    }

    public static function render(\WP_Post $post): void {
        wp_nonce_field('oe_gt_slots_' . $post->ID, 'oe_gt_slots_nonce');
        $slots   = Slots::all($post->ID);
        $default = Slots::default_capacity($post->ID);
        ?>
        <p class="description"><?php
            /* translators: %d: default capacity */
            echo esc_html(sprintf(__('Add each start time. Capacity defaults to %d. Times are 24-hour here; the public page shows 12-hour AM/PM.', 'october-events'), $default));
        ?></p>
        <table class="widefat striped" id="oe-gt-slot-table">
            <thead><tr>
                <th style="width:150px"><?php esc_html_e('Date', 'october-events'); ?></th>
                <th style="width:120px"><?php esc_html_e('Start', 'october-events'); ?></th>
                <th style="width:110px"><?php esc_html_e('Capacity', 'october-events'); ?></th>
                <th style="width:90px"><?php esc_html_e('Active', 'october-events'); ?></th>
                <th><?php esc_html_e('Booked', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
                <?php foreach ($slots as $s) :
                    $held = Reservations::count_held($post->ID, $s['uid']);
                    $wait = Reservations::waitlist_count($post->ID, $s['uid']); ?>
                    <tr>
                        <td><input type="hidden" name="oe_gt_slot[uid][]" value="<?php echo esc_attr($s['uid']); ?>"><input type="date" name="oe_gt_slot[date][]" value="<?php echo esc_attr($s['date']); ?>"></td>
                        <td><input type="time" name="oe_gt_slot[start][]" value="<?php echo esc_attr($s['start']); ?>"></td>
                        <td><input type="number" min="1" name="oe_gt_slot[capacity][]" value="<?php echo esc_attr((string) $s['capacity']); ?>" style="width:80px"></td>
                        <td style="text-align:center"><input type="checkbox" name="oe_gt_slot[active][<?php echo esc_attr($s['uid']); ?>]" value="1" <?php checked($s['active']); ?>></td>
                        <td><?php echo esc_html($held . ' / ' . $s['capacity']); ?><?php echo $wait ? ' · ' . esc_html(sprintf(/* translators: %d waiting */ __('%d waiting', 'october-events'), $wait)) : ''; ?></td>
                        <td><button type="button" class="button-link oe-gt-del" style="color:#b32d2e"><?php esc_html_e('Remove', 'october-events'); ?></button></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        <p><button type="button" class="button" id="oe-gt-add-row"><?php esc_html_e('Add a slot', 'october-events'); ?></button></p>

        <fieldset style="border:1px solid #dcdcde;border-radius:6px;padding:10px 14px;margin-top:8px">
            <legend style="font-weight:600"><?php esc_html_e('Generate a run of slots', 'october-events'); ?></legend>
            <p class="description"><?php esc_html_e('Fills every interval between the times, across the date range. Skips any slot already listed above.', 'october-events'); ?></p>
            <label><?php esc_html_e('From', 'october-events'); ?> <input type="date" name="oe_gt_gen[from]"></label>
            <label><?php esc_html_e('To', 'october-events'); ?> <input type="date" name="oe_gt_gen[to]"></label>
            <label><?php esc_html_e('Start', 'october-events'); ?> <input type="time" name="oe_gt_gen[start]"></label>
            <label><?php esc_html_e('End', 'october-events'); ?> <input type="time" name="oe_gt_gen[end]"></label>
            <label><?php esc_html_e('Every', 'october-events'); ?> <input type="number" min="5" step="5" name="oe_gt_gen[interval]" value="30" style="width:70px"> <?php esc_html_e('min', 'october-events'); ?></label>
            <label><?php esc_html_e('Capacity', 'october-events'); ?> <input type="number" min="1" name="oe_gt_gen[capacity]" value="<?php echo esc_attr((string) $default); ?>" style="width:70px"></label>
        </fieldset>

        <?php $count = count(Reservations::for_location($post->ID)); if ($count > 0) :
            $url = wp_nonce_url(admin_url('admin-post.php?action=oe_gt_export&location=' . $post->ID), 'oe_gt_export_' . $post->ID); ?>
            <p style="margin-top:12px"><a class="button" href="<?php echo esc_url($url); ?>"><?php
                /* translators: %d: reservation count */
                echo esc_html(sprintf(__('Download reservations CSV (%d)', 'october-events'), $count)); ?></a></p>
        <?php endif; ?>

        <template id="oe-gt-row-tpl">
            <tr>
                <td><input type="hidden" name="oe_gt_slot[uid][]" value=""><input type="date" name="oe_gt_slot[date][]"></td>
                <td><input type="time" name="oe_gt_slot[start][]"></td>
                <td><input type="number" min="1" name="oe_gt_slot[capacity][]" value="<?php echo esc_attr((string) $default); ?>" style="width:80px"></td>
                <td style="text-align:center"><input type="checkbox" checked disabled title="<?php esc_attr_e('New slots are active', 'october-events'); ?>"></td>
                <td>—</td>
                <td><button type="button" class="button-link oe-gt-del" style="color:#b32d2e"><?php esc_html_e('Remove', 'october-events'); ?></button></td>
            </tr>
        </template>
        <script>
        (function(){
            var t=document.getElementById('oe-gt-slot-table');if(!t)return;
            var add=document.getElementById('oe-gt-add-row'),tpl=document.getElementById('oe-gt-row-tpl');
            if(add&&tpl){add.addEventListener('click',function(){t.querySelector('tbody').appendChild(tpl.content.cloneNode(true));});}
            t.addEventListener('click',function(e){var d=e.target.closest('.oe-gt-del');if(d){e.preventDefault();var r=d.closest('tr');if(r)r.remove();}});
        })();
        </script>
        <?php
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if ($post->post_type !== self::post_type()) {
            return;
        }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        $nonce = isset($_POST['oe_gt_slots_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['oe_gt_slots_nonce'])) : '';
        if (! wp_verify_nonce($nonce, 'oe_gt_slots_' . $post_id) || ! current_user_can('edit_post', $post_id)) {
            return;
        }

        // Manual rows.
        $rows = [];
        if (isset($_POST['oe_gt_slot']) && is_array($_POST['oe_gt_slot'])) {
            $in    = wp_unslash($_POST['oe_gt_slot']); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
            $uids  = (array) ($in['uid'] ?? []);
            $dates = (array) ($in['date'] ?? []);
            $times = (array) ($in['start'] ?? []);
            $caps  = (array) ($in['capacity'] ?? []);
            $active = (array) ($in['active'] ?? []);
            foreach ($dates as $i => $date) {
                $uid = (string) ($uids[$i] ?? '');
                $rows[] = [
                    'uid'      => $uid,
                    'date'     => sanitize_text_field((string) $date),
                    'start'    => sanitize_text_field((string) ($times[$i] ?? '')),
                    'capacity' => (int) ($caps[$i] ?? 0),
                    // New rows (no uid) default active; existing rows honour their checkbox.
                    'inactive' => ($uid !== '' && empty($active[$uid])),
                ];
            }
        }
        Slots::save($post_id, $rows);

        // Optional generator.
        if (isset($_POST['oe_gt_gen']) && is_array($_POST['oe_gt_gen'])) {
            $g = wp_unslash($_POST['oe_gt_gen']); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
            if (! empty($g['from']) && ! empty($g['start']) && ! empty($g['end'])) {
                Slots::generate(
                    $post_id,
                    sanitize_text_field((string) $g['from']),
                    sanitize_text_field((string) ($g['to'] ?: $g['from'])),
                    sanitize_text_field((string) $g['start']),
                    sanitize_text_field((string) $g['end']),
                    (int) ($g['interval'] ?? 30),
                    (int) ($g['capacity'] ?? 0)
                );
            }
        }
    }

    /** Stream a reservations CSV for one location. */
    public static function export(): void {
        $location = isset($_GET['location']) ? (int) $_GET['location'] : 0;
        $nonce    = isset($_GET['_wpnonce']) ? sanitize_text_field(wp_unslash((string) $_GET['_wpnonce'])) : '';
        if (! wp_verify_nonce($nonce, 'oe_gt_export_' . $location) || ! Access::can_manage() || ! current_user_can('edit_post', $location)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $rows = Reservations::for_location($location);
        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="guided-tour-' . $location . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['Name', 'Email', 'Status', 'When']);
        foreach ($rows as $r) {
            $ts   = Slots::start_ts($location, (string) $r->slot_uid);
            $when = $ts ? wp_date('Y-m-d g:i A', $ts) : '';
            fputcsv($out, [(string) $r->name, (string) $r->email, (string) $r->status, $when]);
        }
        fclose($out);
        exit;
    }
}
