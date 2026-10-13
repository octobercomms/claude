<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Porter\Exporter;
use OE\Porter\Importer;

defined('ABSPATH') || exit;

/**
 * Import / export screen (ADMIN-BUILD AD13).
 *
 * Export tab: pick an entity and format (CSV / JSON) and download — streamed by
 * a dedicated admin-post handler so nothing is buffered before the headers.
 *
 * Import tab: upload a CSV, map its columns to the target's fields (auto-matched
 * by header, or loaded from a saved template), dry-run to preview create /
 * update / skip counts, then commit with dedupe-on-email. Templates are saved
 * per target. The uploaded file lives in a private uploads subfolder keyed by a
 * token and is removed after commit.
 */
final class PorterScreen {

    public static function init(): void {
        add_action('admin_post_oe_porter_export', [self::class, 'export']);
    }

    private static function require_cap(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
    }

    /* ----------------------------------------------------------- export */

    public static function export(): void {
        self::require_cap();
        if (! check_admin_referer('oe_porter_export')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $entity = isset($_GET['entity']) ? sanitize_key((string) $_GET['entity']) : '';
        $format = (isset($_GET['format']) && $_GET['format'] === 'json') ? 'json' : 'csv';
        if (! isset(Exporter::entities()[$entity])) {
            wp_die(esc_html__('Unknown entity.', 'october-events'));
        }
        Exporter::stream($entity, $format);
    }

    /* ------------------------------------------------------------- page */

    public static function render(): void {
        self::require_cap();
        $tab    = (isset($_GET['tab']) && $_GET['tab'] === 'import') ? 'import' : 'export';
        $notice = '';

        // Handle import-flow POSTs (upload / preview / commit / templates).
        $token   = isset($_REQUEST['token']) ? sanitize_file_name((string) $_REQUEST['token']) : '';
        $target  = isset($_REQUEST['target']) ? sanitize_key((string) $_REQUEST['target']) : '';
        $headers = [];
        $map     = [];
        $preview = null;

        if (! empty($_POST['oe_porter_action'])) {
            check_admin_referer('oe_porter_import');
            $action = sanitize_key((string) $_POST['oe_porter_action']);
            $tab    = 'import';

            if ($action === 'upload' && Importer::target($target)) {
                $token = self::store_upload();
                if ($token === '') {
                    $notice = __('Upload failed — please choose a .csv file.', 'october-events');
                } else {
                    $headers = Importer::headers(self::path($token));
                    $map     = self::auto_map($target, $headers);
                }
            } elseif (in_array($action, ['preview', 'commit', 'save_template'], true) && $token !== '' && Importer::target($target)) {
                $path    = self::path($token);
                $headers = Importer::headers($path);
                $map     = self::posted_map($target);

                if ($action === 'save_template') {
                    $name = sanitize_text_field((string) wp_unslash($_POST['template_name'] ?? ''));
                    if ($name !== '') {
                        Importer::save_template($target, $name, $map);
                        $notice = __('Mapping template saved.', 'october-events');
                    }
                } elseif ($action === 'preview') {
                    $preview = Importer::preview($target, $path, $map);
                } elseif ($action === 'commit') {
                    $res = Importer::commit($target, $path, $map);
                    @unlink($path);
                    $token = '';
                    $notice = sprintf(
                        __('Import complete: %1$d created, %2$d updated, %3$d skipped (of %4$d rows).', 'october-events'),
                        $res['created'], $res['updated'], $res['skipped'], $res['total']
                    );
                }
            }
        }

        // Apply a saved template if asked (GET).
        if ($tab === 'import' && $token !== '' && $target !== '' && isset($_GET['use_template'])) {
            $tpl = Importer::templates($target)[sanitize_text_field((string) wp_unslash($_GET['use_template']))] ?? [];
            if ($tpl) {
                $map = $tpl;
            }
            $headers = Importer::headers(self::path($token));
        }

        require OE_DIR . 'admin/views/porter.php';
    }

    /* --------------------------------------------------------- helpers */

    private static function dir(): string {
        $up = wp_upload_dir();
        $dir = trailingslashit($up['basedir']) . 'oe-import';
        if (! is_dir($dir)) {
            wp_mkdir_p($dir);
            // Keep the folder private.
            @file_put_contents($dir . '/index.html', '');
            @file_put_contents($dir . '/.htaccess', "Deny from all\n");
        }
        return $dir;
    }

    private static function path(string $token): string {
        return self::dir() . '/' . $token . '.csv';
    }

    private static function store_upload(): string {
        if (empty($_FILES['oe_csv']['tmp_name']) || ! is_uploaded_file($_FILES['oe_csv']['tmp_name'])) {
            return '';
        }
        $name = (string) ($_FILES['oe_csv']['name'] ?? '');
        if (strtolower((string) pathinfo($name, PATHINFO_EXTENSION)) !== 'csv') {
            return '';
        }
        $token = wp_generate_password(16, false, false);
        $dest  = self::path($token);
        if (! @move_uploaded_file($_FILES['oe_csv']['tmp_name'], $dest)) {
            return '';
        }
        return $token;
    }

    /** @return array<string,string> field => header */
    private static function auto_map(string $target, array $headers): array {
        $spec = Importer::target($target);
        if (! $spec) {
            return [];
        }
        $map   = [];
        $lower = [];
        foreach ($headers as $h) {
            $lower[strtolower(trim((string) $h))] = (string) $h;
        }
        foreach (array_keys($spec['fields']) as $field) {
            // Match on the field key or a normalised version of it.
            $cands = [$field, str_replace('_', ' ', $field), str_replace('_', '', $field)];
            foreach ($cands as $c) {
                if (isset($lower[strtolower($c)])) {
                    $map[$field] = $lower[strtolower($c)];
                    break;
                }
            }
        }
        return $map;
    }

    /** @return array<string,string> field => header */
    private static function posted_map(string $target): array {
        $spec = Importer::target($target);
        if (! $spec) {
            return [];
        }
        $raw = isset($_POST['map']) && is_array($_POST['map']) ? wp_unslash($_POST['map']) : [];
        $map = [];
        foreach (array_keys($spec['fields']) as $field) {
            $header = isset($raw[$field]) ? sanitize_text_field((string) $raw[$field]) : '';
            if ($header !== '') {
                $map[$field] = $header;
            }
        }
        return $map;
    }
}
