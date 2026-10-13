<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Event Studio — a split-pane event editor (ADMIN-BUILD).
 *
 * Left: the event's structured fields (the same set as the native "Event
 * details" metabox, saved through Events::save_fields, so nothing about the
 * data model changes). Right: a live preview that is the REAL plugin-rendered
 * event page in an iframe — the native single-template (section shortcodes),
 * which the plugin owns and renders itself, with no JetEngine/Elementor
 * dependency. Edits autosave the draft and reload the frame, so the preview is
 * always the true output rather than a client-side approximation.
 */
final class EventStudio {

    private const SAVE_NONCE = 'oe_event_studio_save';
    private const AUTO_NONCE = 'oe_event_studio_autosave';

    public static function init(): void {
        add_action('admin_post_oe_event_studio_save', [self::class, 'save']);
        add_action('wp_ajax_oe_event_studio_autosave', [self::class, 'autosave']);
    }

    /** May the current user edit events through the studio? */
    private static function can(): bool {
        return current_user_can('manage_options') || current_user_can(SectionAccess::cap('events'));
    }

    public static function render(): void {
        if (! self::can()) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        wp_enqueue_media();

        $id     = isset($_GET['event']) ? (int) $_GET['event'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        $post   = $id > 0 ? get_post($id) : null;
        $is_event = $post && $post->post_type === Events::slug();
        if (! $is_event) {
            $id = 0;
            $post = null;
        }
        $values = $id > 0 ? Events::values($id) : array_fill_keys(array_keys(Events::FIELDS), '');
        $status = $post ? (string) $post->post_status : 'draft';
        $thumb  = $id > 0 ? (int) get_post_thumbnail_id($id) : 0;
        $thumb_src = $thumb ? (string) wp_get_attachment_image_url($thumb, 'medium') : '';
        $preview = $id > 0 ? (string) get_preview_post_link($id) : '';

        require OE_DIR . 'admin/views/event-studio.php';
    }

    /**
     * Autosave from the studio (AJAX). Creates the event as a draft on first
     * call, then updates it, saves the fields, and returns the preview URL so
     * the right pane can reload the real rendered page.
     */
    public static function autosave(): void {
        if (! self::can() || ! check_ajax_referer(self::AUTO_NONCE, 'nonce', false)) {
            wp_send_json_error(['message' => __('Not allowed.', 'october-events')], 403);
        }
        [$id, $preview] = self::persist(true);
        wp_send_json_success(['id' => $id, 'preview' => $preview]);
    }

    /** Explicit Save (admin-post): sets the chosen status, then redirects back. */
    public static function save(): void {
        if (! self::can() || ! check_admin_referer(self::SAVE_NONCE)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        [$id] = self::persist(false);
        wp_safe_redirect(add_query_arg(['page' => 'oe-event-studio', 'event' => $id, 'saved' => 1], admin_url('admin.php')));
        exit;
    }

    /**
     * Create or update the event from the posted form.
     *
     * @param bool $autosave When true, never changes a published event's status
     *                       and new events are created as drafts; the explicit
     *                       Save honours the posted status instead.
     * @return array{0:int,1:string} [event id, preview url]
     */
    private static function persist(bool $autosave): array {
        $id    = isset($_POST['event_id']) ? (int) $_POST['event_id'] : 0;
        $input = isset($_POST['oe_event']) && is_array($_POST['oe_event']) ? (array) wp_unslash($_POST['oe_event']) : [];

        $title = trim((string) ($input['name'] ?? ''));
        if ($title === '') {
            $title = __('Untitled event', 'october-events');
        }
        $desc = (string) ($input['description'] ?? '');

        $existing = $id > 0 ? get_post($id) : null;
        $is_event = $existing && $existing->post_type === Events::slug();

        // Decide the status. Autosave keeps a live event live and a draft a draft;
        // the explicit Save honours the chosen status (draft|pending|publish).
        $posted_status = isset($_POST['post_status']) ? sanitize_key((string) wp_unslash($_POST['post_status'])) : 'draft';
        $posted_status = in_array($posted_status, ['draft', 'pending', 'publish'], true) ? $posted_status : 'draft';
        if ($autosave) {
            $status = $is_event ? (string) $existing->post_status : 'draft';
            if ($status === 'auto-draft') {
                $status = 'draft';
            }
        } else {
            $status = $posted_status;
        }

        $postarr = [
            'post_type'    => Events::slug(),
            'post_title'   => $title,
            'post_content' => $desc,
            'post_status'  => $status,
        ];
        if ($is_event) {
            $postarr['ID'] = $id;
            $res = wp_update_post($postarr, true);
        } else {
            $res = wp_insert_post($postarr, true);
        }
        if (is_wp_error($res)) {
            if (wp_doing_ajax()) {
                wp_send_json_error(['message' => $res->get_error_message()], 400);
            }
            wp_die(esc_html($res->get_error_message()));
        }
        $id = (int) $res;

        if (! current_user_can('edit_post', $id)) {
            if (wp_doing_ajax()) {
                wp_send_json_error(['message' => __('Not allowed.', 'october-events')], 403);
            }
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }

        Events::save_fields($id, $input);

        $thumb = isset($_POST['featured_image']) ? (int) $_POST['featured_image'] : 0;
        if ($thumb > 0) {
            set_post_thumbnail($id, $thumb);
        } else {
            delete_post_thumbnail($id);
        }

        return [$id, (string) get_preview_post_link($id)];
    }
}
