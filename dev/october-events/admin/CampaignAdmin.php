<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Mail\Campaigns;

defined('ABSPATH') || exit;

/**
 * Native campaign composer (ADMIN-BUILD).
 *
 * The campaign engine — the store, batched SES/Brevo sending, open and click
 * tracking — already lives in {@see Campaigns}; it used to be driven from the
 * retired planning platform over REST. This controller is the in-plugin UI that
 * replaces it: a composer screen and the save / send / test / delete actions,
 * so campaigns are written, sent and measured here with the same contacts and
 * audiences shown on the Email screen.
 */
final class CampaignAdmin {

    public static function init(): void {
        add_action('admin_post_oe_campaign_save', [self::class, 'handle_save']);
        add_action('admin_post_oe_campaign_delete', [self::class, 'handle_delete']);
    }

    private static function cap(): string {
        return SectionAccess::cap('contacts');
    }

    private static function can(): bool {
        return current_user_can(self::cap());
    }

    private static function back(string $args = ''): string {
        return admin_url('admin.php?page=oe-email' . ($args !== '' ? '&' . $args : ''));
    }

    /** The composer screen (hidden submenu oe-email-compose; ?campaign=ID edits). */
    public static function render(): void {
        if (! self::can()) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $id = isset($_GET['campaign']) ? (int) $_GET['campaign'] : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        $campaign = $id > 0 ? Campaigns::get($id) : null;
        if ($id > 0 && ! $campaign) {
            $id = 0;
        }
        $audiences = Campaigns::audiences();
        $selected  = $campaign ? array_filter(array_map('trim', explode(',', (string) $campaign->audience))) : ['subscribed'];
        require OE_DIR . 'admin/views/campaign-edit.php';
    }

    /** Collect + sanitise the posted composer fields. */
    private static function posted(): array {
        $audience = isset($_POST['audience']) && is_array($_POST['audience'])
            ? implode(',', array_map('sanitize_text_field', array_map('strval', (array) wp_unslash($_POST['audience']))))
            : 'subscribed';
        return [
            'name'      => sanitize_text_field((string) wp_unslash($_POST['name'] ?? '')),
            'subject'   => sanitize_text_field((string) wp_unslash($_POST['subject'] ?? '')),
            'preheader' => sanitize_text_field((string) wp_unslash($_POST['preheader'] ?? '')),
            'body_html' => wp_kses_post((string) wp_unslash($_POST['body_html'] ?? '')),
            'audience'  => $audience,
        ];
    }

    private static function guard(int $id): void {
        if (! self::can() || ! check_admin_referer('oe_campaign_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
    }

    /**
     * One handler for the composer form; the clicked button carries `do` =
     * save | send | test. Every path saves the draft first, so Send and Test
     * always use exactly what is on screen.
     */
    public static function handle_save(): void {
        $id = isset($_POST['campaign_id']) ? (int) $_POST['campaign_id'] : 0;
        self::guard($id);
        $id = Campaigns::save(self::posted(), $id);
        $do = sanitize_key((string) wp_unslash($_POST['do'] ?? 'save'));

        if ($do === 'send') {
            $queued = Campaigns::send($id);
            wp_safe_redirect(self::back('oe_msg=camp_sent&n=' . (int) $queued));
            exit;
        }
        if ($do === 'test') {
            $email = sanitize_email((string) wp_unslash($_POST['test_email'] ?? ''));
            $ok    = $email !== '' && Campaigns::send_test($id, $email);
            wp_safe_redirect(add_query_arg([
                'page'     => 'oe-email-compose',
                'campaign' => $id,
                'oe_msg'   => $ok ? 'camp_test_ok' : 'camp_test_fail',
            ], admin_url('admin.php')));
            exit;
        }
        wp_safe_redirect(add_query_arg(['page' => 'oe-email-compose', 'campaign' => $id, 'oe_msg' => 'camp_saved'], admin_url('admin.php')));
        exit;
    }

    public static function handle_delete(): void {
        $id = isset($_GET['campaign']) ? (int) $_GET['campaign'] : 0;
        if (! self::can() || ! check_admin_referer('oe_campaign_delete_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        if ($id > 0) {
            Campaigns::delete($id);
        }
        wp_safe_redirect(self::back('oe_msg=camp_deleted'));
        exit;
    }
}
