<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Planning\Events;
use OE\Planning\Gating;

defined('ABSPATH') || exit;

/**
 * Event planning admin: the confirm→green meta box on the `events` CPT and a
 * "Event Planning" overview list (completion meters + one-click confirm).
 * Usable in wp-admin now; the same data feeds the platform later via REST.
 */
final class PlanningAdmin {

    private static ?PlanningAdmin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('add_meta_boxes', [$this, 'add_meta_box']);
        add_action('save_post_' . Events::slug(), [$this, 'save_event_meta']);
        add_action('admin_post_oe_event_confirm', [$this, 'handle_confirm']);
        add_action('admin_post_oe_event_unconfirm', [$this, 'handle_unconfirm']);
    }

    /* ---- Meta box on the event ---- */

    public function add_meta_box(): void {
        add_meta_box('oe_event_planning', __('Event readiness', 'october-events'), [$this, 'render_meta_box'], Events::slug(), 'normal', 'high');
    }

    public function render_meta_box(\WP_Post $post): void {
        wp_nonce_field('oe_save_planning', 'oe_planning_nonce');
        $g = static fn($f) => esc_attr((string) Events::get($post->ID, $f, ''));
        $readiness = Events::readiness($post->ID);
        $status    = Events::status($post->ID);
        $sessions  = Events::sessions($post->ID);
        ?>
        <div class="oe-admin">
            <p>
                <strong><?php esc_html_e('Status:', 'october-events'); ?></strong>
                <span class="oe-status oe-status-<?php echo esc_attr($status); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', $status))); ?></span>
                — <?php echo (int) $readiness['percent']; ?>% ready
            </p>
            <ul style="margin:0 0 12px;list-style:none;padding:0">
                <?php foreach ($readiness['required'] as $key) :
                    $ok = ! in_array($key, $readiness['missing'], true); ?>
                    <li style="color:<?php echo $ok ? '#1a7f37' : '#9a5b00'; ?>">
                        <?php echo $ok ? '✓' : '○'; ?> <?php echo esc_html(Gating::field_label($key)); ?>
                    </li>
                <?php endforeach; ?>
            </ul>

            <table class="form-table">
                <tr><th><?php esc_html_e('Event title', 'october-events'); ?></th><td><input type="text" name="oe_plan[name]" class="regular-text" value="<?php echo $g('name'); ?>" placeholder="<?php echo esc_attr(get_the_title($post)); ?>"></td></tr>
                <tr><th><?php esc_html_e('Dates & times', 'october-events'); ?></th><td>
                    <input type="text" name="oe_plan[start_datetime]" class="regular-text" value="<?php echo $g('start_datetime'); ?>" placeholder="Sun 28 Sept 2026, 10:30am–1:00pm">
                    <p class="description"><?php esc_html_e('Optional separate end:', 'october-events'); ?> <input type="text" name="oe_plan[end_datetime]" value="<?php echo $g('end_datetime'); ?>"></p></td></tr>
                <tr><th><?php esc_html_e('Price', 'october-events'); ?></th><td><input type="text" name="oe_plan[price]" value="<?php echo $g('price'); ?>" placeholder="Free / $25 / From $10"></td></tr>
                <tr><th><?php esc_html_e('Location', 'october-events'); ?></th><td><input type="text" name="oe_plan[location]" class="regular-text" value="<?php echo $g('location'); ?>"></td></tr>
                <tr><th><?php esc_html_e('Organiser', 'october-events'); ?></th><td><input type="text" name="oe_plan[organiser]" class="regular-text" value="<?php echo $g('organiser'); ?>"></td></tr>
                <tr><th><?php esc_html_e('Description', 'october-events'); ?></th><td><textarea name="oe_plan[description]" rows="3" class="large-text"><?php echo esc_textarea((string) Events::get($post->ID, 'description', '')); ?></textarea></td></tr>
                <tr><th><?php esc_html_e('Ticketed?', 'october-events'); ?></th><td><label><input type="checkbox" name="oe_plan[ticket_required]" value="1" <?php checked(Events::get($post->ID, 'ticket_required', '') === '1'); ?>> <?php esc_html_e('Requires a ticket', 'october-events'); ?></label></td></tr>
                <tr><th><?php esc_html_e('Internal notes', 'october-events'); ?></th><td><textarea name="oe_plan[notes]" rows="3" class="large-text" placeholder="<?php esc_attr_e('Not published', 'october-events'); ?>"><?php echo esc_textarea((string) Events::get($post->ID, 'notes', '')); ?></textarea></td></tr>
            </table>

            <h4><?php esc_html_e('Sessions', 'october-events'); ?> <span class="description">— <?php esc_html_e('title | time | speakers (comma-separated)', 'october-events'); ?></span></h4>
            <textarea name="oe_plan_sessions" rows="4" class="large-text" placeholder="The Design | 2:00–3:00pm | Ashley McClure, Alex Wu"><?php
                $lines = [];
                foreach ($sessions as $s) {
                    $lines[] = ($s['title'] ?? '') . ' | ' . ($s['time'] ?? '') . ' | ' . implode(', ', (array) ($s['speakers'] ?? []));
                }
                echo esc_textarea(implode("\n", $lines));
            ?></textarea>

            <p style="margin-top:12px">
                <?php if ($status !== Gating::STATUS_CONFIRMED) :
                    $url = wp_nonce_url(admin_url('admin-post.php?action=oe_event_confirm&id=' . $post->ID), 'oe_event_confirm_' . $post->ID);
                    $disabled = $readiness['complete'] ? '' : 'disabled title="' . esc_attr__('Complete the required fields first', 'october-events') . '"'; ?>
                    <a class="button button-primary" href="<?php echo esc_url($url); ?>" <?php echo $disabled; ?>><?php esc_html_e('Confirm — go green', 'october-events'); ?></a>
                    <span class="description"><?php esc_html_e('Save the event first, then confirm. Confirming publishes it.', 'october-events'); ?></span>
                <?php else :
                    $url = wp_nonce_url(admin_url('admin-post.php?action=oe_event_unconfirm&id=' . $post->ID), 'oe_event_unconfirm_' . $post->ID); ?>
                    <span class="oe-status oe-status-confirmed"><?php esc_html_e('Confirmed & live', 'october-events'); ?></span>
                    <a class="button" href="<?php echo esc_url($url); ?>"><?php esc_html_e('Un-confirm', 'october-events'); ?></a>
                <?php endif; ?>
            </p>
        </div>
        <?php
    }

    public function save_event_meta(int $post_id): void {
        if (! isset($_POST['oe_planning_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oe_planning_nonce'])), 'oe_save_planning')) {
            return;
        }
        if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || ! current_user_can('edit_post', $post_id)) {
            return;
        }
        Events::save_fields($post_id, (array) wp_unslash($_POST['oe_plan'] ?? []));

        $sessions = [];
        foreach (preg_split('/\r\n|\r|\n/', (string) wp_unslash($_POST['oe_plan_sessions'] ?? '')) as $line) {
            $parts = array_map('trim', explode('|', $line));
            if (($parts[0] ?? '') === '') {
                continue;
            }
            $sessions[] = [
                'title'    => $parts[0],
                'time'     => $parts[1] ?? '',
                'speakers' => array_filter(array_map('trim', explode(',', $parts[2] ?? ''))),
            ];
        }
        Events::set_sessions($post_id, $sessions);
    }

    /* ---- Confirm / unconfirm actions ---- */

    public function handle_confirm(): void {
        $id = $this->guard('oe_event_confirm');
        $r = Events::confirm($id);
        $msg = is_wp_error($r) ? 'notready' : 'confirmed';
        wp_safe_redirect(add_query_arg('oe_msg', $msg, get_edit_post_link($id, 'raw')));
        exit;
    }

    public function handle_unconfirm(): void {
        $id = $this->guard('oe_event_unconfirm');
        Events::unconfirm($id);
        wp_safe_redirect(get_edit_post_link($id, 'raw'));
        exit;
    }

    private function guard(string $action): int {
        $id = isset($_REQUEST['id']) ? absint($_REQUEST['id']) : 0;
        if (! current_user_can('edit_post', $id)) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer($action . '_' . $id);
        return $id;
    }

    /* ---- Planning overview list ---- */

    public function render_list(): void {
        $events = array_map([Events::class, 'summary'], Events::all_event_ids());
        require OE_DIR . 'admin/views/planning-list.php';
    }
}
