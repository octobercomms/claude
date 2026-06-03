<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Invoices (§4 — "generated as PDF on payment success, stored as post meta,
 * accessible in frontend dashboard").
 *
 * To avoid a hard PDF-library dependency, invoices are stored as structured
 * data in post meta and rendered to a print-ready HTML document on demand; the
 * browser's "Save as PDF" produces the downloadable artefact. A swap-in point
 * for Dompdf/mPDF is marked below for teams that want server-side PDFs.
 */
final class Invoice {

    /**
     * Record an invoice against a listing once its payment succeeds.
     */
    public static function create(int $listing_id, string $payment_intent_id): void {
        if (get_post_meta($listing_id, '_adf_invoice', true)) {
            return; // Idempotent — webhook + client confirm can both fire.
        }
        $type = (string) Fields::get($listing_id, 'listing_type');
        $tier = Fields::tier($listing_id);
        $cents = Settings::price($type, $tier);

        $invoice = [
            'number'     => self::next_number(),
            'date'       => current_time('mysql'),
            'listing_id' => $listing_id,
            'intent_id'  => $payment_intent_id,
            'type'       => $type,
            'tier'       => $tier,
            'amount'     => $cents,
            'currency'   => (string) Settings::get('currency', 'usd'),
            'status'     => 'paid',
        ];
        update_post_meta($listing_id, '_adf_invoice', $invoice);
        AuditLog::record('invoice_created', $listing_id, $type, $invoice['number']);
    }

    public static function mark_refunded(int $listing_id): void {
        $invoice = get_post_meta($listing_id, '_adf_invoice', true);
        if (is_array($invoice)) {
            $invoice['status'] = 'refunded';
            update_post_meta($listing_id, '_adf_invoice', $invoice);
        }
    }

    /**
     * All invoices for an account (for the dashboard Invoices tab).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function for_account(int $account_id): array {
        $posts = get_posts([
            'post_type'      => PostTypes::listing_slugs(),
            'post_status'    => 'any',
            'posts_per_page' => 200,
            'fields'         => 'ids',
            'meta_query'     => [
                ['key' => Fields::key('submitter_account_id'), 'value' => $account_id],
                ['key' => '_adf_invoice', 'compare' => 'EXISTS'],
            ],
        ]);
        $out = [];
        foreach ($posts as $pid) {
            $invoice = get_post_meta($pid, '_adf_invoice', true);
            if (is_array($invoice)) {
                $invoice['listing_name'] = get_the_title($pid);
                $out[] = $invoice;
            }
        }
        return $out;
    }

    private static function next_number(): string {
        $seq = (int) get_option('adf_invoice_seq', 1000);
        $seq++;
        update_option('adf_invoice_seq', $seq);
        return 'ADF-' . gmdate('Y') . '-' . $seq;
    }

    /**
     * Render a print-ready invoice document.
     *
     * Swap point: feed this HTML to Dompdf/mPDF here if a true server-side PDF
     * is required.
     */
    public static function render_html(array $invoice): string {
        $amount = Submission::format_money((int) $invoice['amount'], (string) $invoice['currency']);
        ob_start();
        ?>
        <!doctype html><html><head><meta charset="utf-8">
        <title><?php echo esc_html($invoice['number']); ?></title>
        <style>body{font-family:system-ui,Arial,sans-serif;max-width:680px;margin:40px auto;color:#111}
        h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:24px}
        td,th{text-align:left;padding:8px;border-bottom:1px solid #eee}.right{text-align:right}
        .status{display:inline-block;padding:2px 8px;border-radius:4px;background:#eee;font-size:12px}</style>
        </head><body>
        <h1><?php echo esc_html(get_bloginfo('name')); ?> — <?php esc_html_e('Invoice', 'adf-festival'); ?></h1>
        <p><strong><?php echo esc_html($invoice['number']); ?></strong><br>
        <?php echo esc_html(mysql2date(get_option('date_format'), $invoice['date'])); ?><br>
        <span class="status"><?php echo esc_html(ucfirst((string) $invoice['status'])); ?></span></p>
        <table>
            <tr><th><?php esc_html_e('Item', 'adf-festival'); ?></th><th class="right"><?php esc_html_e('Amount', 'adf-festival'); ?></th></tr>
            <tr>
                <td><?php echo esc_html(($invoice['listing_name'] ?? '') . ' — ' . ucfirst((string) $invoice['type']) . ' (' . ucfirst((string) $invoice['tier']) . ')'); ?></td>
                <td class="right"><?php echo esc_html($amount); ?></td>
            </tr>
            <tr><td class="right"><strong><?php esc_html_e('Total', 'adf-festival'); ?></strong></td><td class="right"><strong><?php echo esc_html($amount); ?></strong></td></tr>
        </table>
        </body></html>
        <?php
        return (string) ob_get_clean();
    }
}
