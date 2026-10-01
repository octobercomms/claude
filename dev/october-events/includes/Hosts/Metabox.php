<?php
declare(strict_types=1);

namespace OE\Hosts;

defined('ABSPATH') || exit;

/**
 * "Hosts & info pack" metabox on events and tours: the host-contact rows, the
 * PDF pack (per-post, with a master fallback from Settings), a "Send info pack
 * now" button and a preview. Reminders (2 weeks / 2 days before) are automatic.
 */
final class Metabox {

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
        add_action('save_post', [self::class, 'save'], 10, 2);
        add_action('admin_enqueue_scripts', [self::class, 'assets']);
        add_action('admin_post_oe_host_send', [self::class, 'handle_send']);
        add_action('admin_post_oe_host_preview', [self::class, 'handle_preview']);
    }

    public static function add(): void {
        foreach (HostMailer::host_post_types() as $pt) {
            add_meta_box('oe-hosts', __('Hosts & info pack', 'october-events'), [self::class, 'render'], $pt, 'normal', 'default');
        }
    }

    public static function assets(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        $screen = get_current_screen();
        if (! $screen || ! in_array($screen->post_type, HostMailer::host_post_types(), true)) {
            return;
        }
        wp_enqueue_media();
        wp_enqueue_style('oe-hosts-admin', OE_URL . 'assets/css/host-admin.css', [], OE_VERSION);
        wp_enqueue_script('oe-hosts-admin', OE_URL . 'assets/js/host-admin.js', ['jquery'], OE_VERSION, true);
        wp_localize_script('oe-hosts-admin', 'OE_HOSTS', [
            'choosePdf' => __('Choose the info-pack PDF', 'october-events'),
            'usePdf'    => __('Use this PDF', 'october-events'),
        ]);
    }

    public static function render(\WP_Post $post): void {
        $id   = (int) $post->ID;
        $kind = HostMailer::kind($id);
        wp_nonce_field('oe_hosts_' . $id, 'oe_hosts_nonce');
        $contacts = Contacts::get($id);
        $pdf_id   = (int) get_post_meta($id, HostMailer::META_PDF, true);
        $pdf_name = $pdf_id ? get_the_title($pdf_id) : '';
        $master   = (int) \OE\Settings::get($kind === 'tour' ? 'host_pack_tour_pdf' : 'host_pack_event_pdf', 0);
        $date     = HostMailer::date_label($id);
        $info_sent = HostMailer::was_sent($id, 'info');
        ?>
        <div class="oe-hosts">
            <?php if (isset($_GET['oe_host_sent'])) : // phpcs:ignore WordPress.Security.NonceVerification -- read-only confirmation
                $n = absint($_GET['oe_host_sent']); ?>
                <p class="oe-hosts-ok"><?php echo esc_html($n > 0
                    ? sprintf(_n('Info pack sent to %d host.', 'Info pack sent to %d hosts.', $n, 'october-events'), $n)
                    : __('Nothing sent — add a host with an email first.', 'october-events')); ?></p>
            <?php endif; ?>

            <p class="description"><?php echo esc_html($kind === 'tour'
                ? __('The people we deal with about this tour (homeowner, architect, realtor…). They receive the tour host pack and reminders.', 'october-events')
                : __('The people we deal with about this event. They receive the event info pack and reminders.', 'october-events')); ?></p>

            <table class="widefat oe-hosts-table">
                <thead><tr>
                    <th><?php esc_html_e('Name', 'october-events'); ?></th>
                    <th><?php esc_html_e('Email', 'october-events'); ?></th>
                    <th><?php esc_html_e('Phone', 'october-events'); ?></th>
                    <th><?php esc_html_e('Role', 'october-events'); ?></th>
                    <th></th>
                </tr></thead>
                <tbody id="oe-hosts-rows">
                    <?php foreach (($contacts ?: [[]]) as $i => $c) { self::row((int) $i, (array) $c); } ?>
                </tbody>
            </table>
            <p><button type="button" class="button" id="oe-hosts-add"><?php esc_html_e('Add contact', 'october-events'); ?></button></p>

            <template id="oe-hosts-tpl"><?php self::row(9999, []); ?></template>

            <hr>
            <p><strong><?php esc_html_e('Info-pack PDF', 'october-events'); ?></strong></p>
            <p>
                <input type="hidden" name="oe_host_pdf" id="oe-host-pdf" value="<?php echo esc_attr((string) $pdf_id); ?>">
                <span id="oe-host-pdf-name"><?php echo $pdf_name !== '' ? esc_html($pdf_name) : esc_html__('none', 'october-events'); ?></span>
                <button type="button" class="button" id="oe-host-pdf-pick"><?php esc_html_e('Choose PDF', 'october-events'); ?></button>
                <button type="button" class="button" id="oe-host-pdf-clear"><?php esc_html_e('Clear', 'october-events'); ?></button>
            </p>
            <p class="description"><?php echo $master > 0
                ? esc_html__('Leave blank to use the master pack set in Settings for this type. A PDF here overrides it for this one.', 'october-events')
                : esc_html__('No master pack is set in Settings yet, so set a PDF here (or upload a master in Settings → Host comms).', 'october-events'); ?></p>

            <hr>
            <p class="oe-hosts-status">
                <?php if ($date !== '') : ?>
                    <?php echo esc_html(sprintf(__('Date: %s.', 'october-events'), $date)); ?>
                <?php else : ?>
                    <?php esc_html_e('No date set, so the automatic reminders can’t be timed. Set the date to enable them.', 'october-events'); ?>
                <?php endif; ?>
                <?php if ($info_sent) : ?>
                    <strong><?php esc_html_e('Info pack sent.', 'october-events'); ?></strong>
                    <?php echo esc_html__('Reminders go automatically 2 weeks and 2 days before.', 'october-events'); ?>
                <?php else : ?>
                    <?php esc_html_e('Info pack not sent yet.', 'october-events'); ?>
                <?php endif; ?>
            </p>
            <p>
                <?php $send = wp_nonce_url(admin_url('admin-post.php?action=oe_host_send&id=' . $id), 'oe_host_send_' . $id); ?>
                <a href="<?php echo esc_url($send); ?>" class="button button-primary"><?php echo $info_sent ? esc_html__('Resend info pack', 'october-events') : esc_html__('Send info pack now', 'october-events'); ?></a>
                <?php $prev = wp_nonce_url(admin_url('admin-post.php?action=oe_host_preview&id=' . $id), 'oe_host_preview_' . $id); ?>
                <a href="<?php echo esc_url($prev); ?>" class="button" target="_blank" rel="noopener"><?php esc_html_e('Preview', 'october-events'); ?></a>
                <span class="description"><?php esc_html_e('Save the post first so the latest contacts and PDF are used.', 'october-events'); ?></span>
            </p>
        </div>
        <?php
    }

    /** @param array<string,mixed> $c */
    private static function row(int $i, array $c): void {
        $role = (string) ($c['role'] ?? 'homeowner');
        ?>
        <tr class="oe-hosts-row">
            <td><input type="text" name="oe_host[rows][<?php echo (int) $i; ?>][name]" value="<?php echo esc_attr((string) ($c['name'] ?? '')); ?>" class="widefat"></td>
            <td><input type="email" name="oe_host[rows][<?php echo (int) $i; ?>][email]" value="<?php echo esc_attr((string) ($c['email'] ?? '')); ?>" class="widefat"></td>
            <td><input type="text" name="oe_host[rows][<?php echo (int) $i; ?>][phone]" value="<?php echo esc_attr((string) ($c['phone'] ?? '')); ?>" class="widefat"></td>
            <td>
                <select name="oe_host[rows][<?php echo (int) $i; ?>][role]" class="oe-host-role">
                    <?php foreach (Contacts::ROLES as $k => $label) : ?>
                        <option value="<?php echo esc_attr($k); ?>" <?php selected($role, $k); ?>><?php echo esc_html($label); ?></option>
                    <?php endforeach; ?>
                </select>
                <input type="text" name="oe_host[rows][<?php echo (int) $i; ?>][role_label]" value="<?php echo esc_attr((string) ($c['role_label'] ?? '')); ?>" placeholder="<?php esc_attr_e('role', 'october-events'); ?>" class="oe-host-role-other" style="<?php echo $role === 'other' ? '' : 'display:none'; ?>">
            </td>
            <td><button type="button" class="button-link oe-hosts-del" aria-label="<?php esc_attr_e('Remove', 'october-events'); ?>">&times;</button></td>
        </tr>
        <?php
    }

    public static function save(int $post_id, \WP_Post $post): void {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (! in_array($post->post_type, HostMailer::host_post_types(), true)) {
            return;
        }
        if (! isset($_POST['oe_hosts_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oe_hosts_nonce'])), 'oe_hosts_' . $post_id)) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }
        $rows = isset($_POST['oe_host']['rows']) && is_array($_POST['oe_host']['rows'])
            ? wp_unslash($_POST['oe_host']['rows']) // sanitized field-by-field in Contacts::save
            : [];
        Contacts::save($post_id, (array) $rows);

        $pdf = absint($_POST['oe_host_pdf'] ?? 0);
        if ($pdf > 0) {
            update_post_meta($post_id, HostMailer::META_PDF, $pdf);
        } else {
            delete_post_meta($post_id, HostMailer::META_PDF);
        }
    }

    /* ------------------------------------------------------------------ *
     * Admin actions
     * ------------------------------------------------------------------ */

    public static function handle_send(): void {
        $id = absint($_GET['id'] ?? 0);
        if (! $id || ! current_user_can('edit_post', $id) || ! check_admin_referer('oe_host_send_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $sent = HostMailer::send($id, 'info');
        wp_safe_redirect(add_query_arg('oe_host_sent', $sent, get_edit_post_link($id, 'url')));
        exit;
    }

    public static function handle_preview(): void {
        $id = absint($_GET['id'] ?? 0);
        if (! $id || ! current_user_can('edit_post', $id) || ! check_admin_referer('oe_host_preview_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $occ  = in_array((string) ($_GET['occasion'] ?? 'info'), HostMailer::OCCASIONS, true) ? (string) $_GET['occasion'] : 'info';
        $html = HostMailer::preview_html($id, $occ);
        if ($html === '') {
            $html = '<p>' . esc_html__('This post type does not send a host pack.', 'october-events') . '</p>';
        }
        // phpcs:ignore WordPress.Security.EscapeOutput -- built from esc_html in HostMailer::body + wrapped chrome
        echo $html;
        exit;
    }
}
