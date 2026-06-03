<?php
declare(strict_types=1);

namespace ADF\Admin;

use ADF\Ads\Campaigns;
use ADF\Ads\Bookings;
use ADF\Ads\Tracking;
use ADF\Ads\Formats;

defined('ABSPATH') || exit;

/**
 * Ad Manager admin: campaign + creative CRUD (full manual entry), the bookings
 * review screen (activate/decline) and a per-campaign report.
 */
final class AdsAdmin {

    private static ?AdsAdmin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('admin_post_adf_save_campaign', [$this, 'handle_save_campaign']);
        add_action('admin_post_adf_delete_campaign', [$this, 'handle_delete_campaign']);
        add_action('admin_post_adf_toggle_campaign', [$this, 'handle_toggle_campaign']);
        add_action('admin_post_adf_activate_booking', [$this, 'handle_activate_booking']);
        add_action('admin_post_adf_decline_booking', [$this, 'handle_decline_booking']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue']);
    }

    public function enqueue(string $hook): void {
        if (strpos($hook, 'adf-ads') !== false) {
            wp_enqueue_media();
        }
    }

    /* ---- Screens ---- */

    public function render_campaigns(): void {
        $action = isset($_GET['action']) ? sanitize_key((string) $_GET['action']) : '';
        if ($action === 'edit' || $action === 'new') {
            $campaign = $action === 'edit' ? Campaigns::get(absint($_GET['id'] ?? 0)) : null;
            $creatives = $campaign ? Campaigns::creatives((int) $campaign->id) : [];
            $creative_map = [];
            foreach ($creatives as $cr) {
                $creative_map[$cr->format] = $cr;
            }
            require ADF_DIR . 'admin/views/ads-campaign-form.php';
            return;
        }
        $campaigns = Campaigns::all();
        require ADF_DIR . 'admin/views/ads-campaigns.php';
    }

    public function render_bookings(): void {
        $bookings = Bookings::all();
        require ADF_DIR . 'admin/views/ads-bookings.php';
    }

    public function render_report(): void {
        $campaigns = Campaigns::all();
        $selected  = absint($_GET['campaign'] ?? ($campaigns[0]->id ?? 0));
        $stats     = $selected ? Campaigns::stats($selected) : ['impressions' => 0, 'clicks' => 0, 'ctr' => 0];
        $by_source = $selected ? Tracking::by_source($selected, 'impression') : [];
        require ADF_DIR . 'admin/views/ads-report.php';
    }

    /* ---- Handlers ---- */

    public function handle_save_campaign(): void {
        $this->guard('adf_save_campaign');
        $id = absint($_POST['id'] ?? 0);
        $campaign_id = Campaigns::save([
            'name'                 => $_POST['name'] ?? '',
            'client_name'          => $_POST['client_name'] ?? '',
            'url'                  => $_POST['url'] ?? '',
            'status'               => empty($_POST['active']) ? 'inactive' : 'active',
            'start_date'           => $_POST['start_date'] ?? '',
            'end_date'             => $_POST['end_date'] ?? '',
            'max_impressions'      => $_POST['max_impressions'] ?? '',
            'max_clicks'           => $_POST['max_clicks'] ?? '',
            'restrict_impressions' => ! empty($_POST['restrict_impressions']),
            'restrict_clicks'      => ! empty($_POST['restrict_clicks']),
        ], $id);

        foreach (Formats::keys() as $format) {
            $url = esc_url_raw((string) ($_POST['creative'][$format]['image_url'] ?? ''));
            $alt = sanitize_text_field((string) ($_POST['creative'][$format]['alt'] ?? ''));
            if (! empty($_POST['creative'][$format]['remove'])) {
                Campaigns::delete_creative($campaign_id, $format);
            } elseif ($url !== '') {
                Campaigns::save_creative($campaign_id, $format, $url, $alt);
            }
        }
        wp_safe_redirect(admin_url('admin.php?page=adf-ads&action=edit&id=' . $campaign_id . '&saved=1'));
        exit;
    }

    public function handle_delete_campaign(): void {
        $this->guard('adf_delete_campaign');
        Campaigns::delete(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=adf-ads'));
        exit;
    }

    public function handle_toggle_campaign(): void {
        $this->guard('adf_toggle_campaign');
        $c = Campaigns::get(absint($_REQUEST['id'] ?? 0));
        if ($c) {
            Campaigns::set_status((int) $c->id, $c->status === 'active' ? 'inactive' : 'active');
        }
        wp_safe_redirect(admin_url('admin.php?page=adf-ads'));
        exit;
    }

    public function handle_activate_booking(): void {
        $this->guard('adf_activate_booking');
        Bookings::activate(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=adf-ad-bookings'));
        exit;
    }

    public function handle_decline_booking(): void {
        $this->guard('adf_decline_booking');
        Bookings::decline(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=adf-ad-bookings'));
        exit;
    }

    private function guard(string $action): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer($action);
    }
}
