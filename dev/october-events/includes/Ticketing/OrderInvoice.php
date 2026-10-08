<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Invoices / paid receipts for ticket orders.
 *
 * An invoice covers one payment (a Stripe charge), which may span several order
 * rows (one per ticket type). Line items, buyer and totals come from those
 * rows; the seller block, tax identity and numbering come from Settings. The
 * document renders as print-first HTML and the browser's "Save as PDF" produces
 * the file — no PDF-library dependency. A swap point for Dompdf/mPDF is marked
 * in render().
 *
 * The invoice number and an optional "Bill to" line are assigned once per
 * payment and stored in the `oe_order_invoices` option (keyed by payment id),
 * so a number never changes on re-view — a hard requirement for accounting.
 */
final class OrderInvoice {

    private const STORE = 'oe_order_invoices';
    private const SEQ   = 'oe_order_invoice_seq';

    /** All stored invoice records, keyed by payment id. */
    private static function store(): array {
        $s = get_option(self::STORE, []);
        return is_array($s) ? $s : [];
    }

    private static function save_store(array $s): void {
        update_option(self::STORE, $s, false);
    }

    /**
     * The stored record for a payment, creating (and persisting) the number on
     * first call so it is stable thereafter.
     *
     * @return array{number:string,date:string,bill_to:string}
     */
    private static function record(string $payment_id, string $date): array {
        $store = self::store();
        if (isset($store[$payment_id]) && is_array($store[$payment_id])) {
            $rec = $store[$payment_id];
            return [
                'number'  => (string) ($rec['number'] ?? ''),
                'date'    => (string) ($rec['date'] ?? $date),
                'bill_to' => (string) ($rec['bill_to'] ?? ''),
            ];
        }
        $rec = [
            'number'  => self::next_number($date),
            'date'    => $date,
            'bill_to' => '',
        ];
        $store[$payment_id] = $rec;
        self::save_store($store);
        return $rec;
    }

    /** Set (or clear) the "Bill to" line for a payment; admin-entered. */
    public static function set_bill_to(string $payment_id, string $bill_to): void {
        if ($payment_id === '') {
            return;
        }
        $store = self::store();
        if (! isset($store[$payment_id]) || ! is_array($store[$payment_id])) {
            // Ensure a record exists so the number is fixed from now on.
            $now = current_time('mysql');
            $store[$payment_id] = [
                'number'  => self::next_number($now),
                'date'    => $now,
                'bill_to' => '',
            ];
        }
        $store[$payment_id]['bill_to'] = $bill_to;
        self::save_store($store);
    }

    private static function next_number(string $date): string {
        $seq = (int) get_option(self::SEQ, 1000);
        $seq++;
        update_option(self::SEQ, $seq, false);
        $prefix = (string) Settings::get('invoice_prefix', 'INV');
        $prefix = $prefix !== '' ? $prefix : 'INV';
        $year   = substr($date, 0, 4) ?: gmdate('Y');
        return $prefix . '-' . $year . '-' . $seq;
    }

    /**
     * Build the full invoice model for a payment, or null if no such paid
     * transaction exists.
     *
     * @return array<string,mixed>|null
     */
    public static function for_payment(string $payment_id): ?array {
        $payment_id = trim($payment_id);
        if ($payment_id === '') {
            return null;
        }
        global $wpdb;
        $o = Schema::orders();
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT ticket_type_label, qty, unit_price, discount_amount, total, promo_code,
                        event_id, name, email, currency, created_at, status
                 FROM {$o} WHERE payment_id = %s ORDER BY id ASC",
                $payment_id
            )
        );
        if (! $rows) {
            return null;
        }

        $lines    = [];
        $subtotal = 0.0;
        $discount = 0.0;
        $total    = 0.0;
        $promos   = [];
        foreach ($rows as $r) {
            $qty  = (int) $r->qty;
            $unit = (float) $r->unit_price;
            $line = $unit * $qty;
            $lines[] = [
                'label' => (string) $r->ticket_type_label,
                'qty'   => $qty,
                'unit'  => $unit,
                'line'  => $line,
            ];
            $subtotal += $line;
            $discount += (float) $r->discount_amount;
            $total    += (float) $r->total;
            if ((string) $r->promo_code !== '') {
                $promos[(string) $r->promo_code] = true;
            }
        }

        $first    = $rows[0];
        $event_id = (int) $first->event_id;
        $date     = (string) $first->created_at;
        $rec      = self::record($payment_id, $date);

        return [
            'number'     => $rec['number'],
            'date'       => $date,
            'bill_to'    => $rec['bill_to'],
            'payment_id' => $payment_id,
            'event_id'   => $event_id,
            'event_name' => $event_id ? (get_the_title($event_id) ?: ('#' . $event_id)) : '',
            'buyer_name' => (string) $first->name,
            'buyer_email'=> (string) $first->email,
            'currency'   => strtoupper((string) $first->currency),
            'lines'      => $lines,
            'subtotal'   => $subtotal,
            'discount'   => $discount,
            'total'      => $total,
            'promos'     => array_keys($promos),
        ];
    }

    /** Resolve the payment id behind a ticket token (the buyer's own secret). */
    public static function payment_for_token(string $token): string {
        $ticket = Orders::ticket_by_token($token);
        if (! $ticket) {
            return '';
        }
        $order = Orders::get((int) $ticket->order_id);
        return $order ? (string) ($order->payment_id ?? '') : '';
    }

    private static function money(float $n, string $currency): string {
        $sym = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');
        return $sym . number_format($n, 2) . ' ' . $currency;
    }

    /**
     * Render the print-ready invoice document.
     *
     * Swap point: pass this HTML to Dompdf/mPDF here if a true server-side PDF
     * (e.g. an auto-attached file) is ever required.
     */
    public static function render(array $inv, bool $admin = false): string {
        $cur       = (string) $inv['currency'];
        $biz_name  = (string) (Settings::get('invoice_business_name', '') ?: Settings::get('brand_name', get_bloginfo('name')));
        $biz_addr  = (string) (Settings::get('invoice_business_address', '') ?: Settings::get('mail_footer_address', ''));
        $biz_email = (string) (Settings::get('invoice_business_email', '') ?: Settings::get('mail_from_email', ''));
        $biz_phone = (string) Settings::get('invoice_business_phone', '');
        $tax_label = (string) Settings::get('invoice_tax_label', '');
        $tax_no    = (string) Settings::get('invoice_tax_number', '');
        $notes     = (string) Settings::get('invoice_notes', '');
        $logo      = (string) (Settings::get('theme_logo_light', '') ?: Settings::get('theme_logo_dark', ''));
        $paper     = ((string) Settings::get('paper_size', 'letter')) === 'a4' ? 'A4' : 'Letter';
        $accent    = (string) (Settings::get('theme_accent', '') ?: '#111');
        $date_fmt  = (string) get_option('date_format', 'F j, Y');
        $when      = $inv['date'] !== '' ? mysql2date($date_fmt, (string) $inv['date']) : '';

        ob_start();
        ?><!doctype html><html <?php language_attributes(); ?>><head>
<meta charset="<?php echo esc_attr(get_bloginfo('charset')); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html((string) $inv['number']); ?></title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#111;margin:0;background:#f3f2ee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:720px;margin:28px auto;background:#fff;border:2px solid #111;padding:34px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:8px}
  .logo img{max-width:200px;max-height:72px;display:block}
  .brand{font-size:20px;font-weight:800}
  .biz{font-size:12px;color:#444;line-height:1.5;margin-top:8px;white-space:pre-line}
  .doc{text-align:right;flex:0 0 auto}
  .doc h1{font-size:24px;font-weight:800;margin:0 0 6px;letter-spacing:.02em}
  .doc .meta{font-size:12px;color:#444;line-height:1.6}
  .paid{display:inline-block;margin-top:8px;padding:3px 12px;border:2px solid #1e7a33;color:#1e7a33;font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
  .parties{display:flex;gap:40px;margin:24px 0 10px;flex-wrap:wrap}
  .parties .box{flex:1;min-width:200px}
  .parties .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#888;margin:0 0 4px}
  .parties .v{font-size:14px;line-height:1.5}
  hr.rule{border:0;border-top:3px solid #111;margin:18px 0}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:10px 8px;font-size:14px}
  thead th{border-bottom:2px solid #111;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  tbody td{border-bottom:1px solid #e6e3dd}
  .r{text-align:right;white-space:nowrap}
  tfoot td{font-size:14px;padding:6px 8px}
  tfoot .tot td{font-size:16px;font-weight:800;border-top:2px solid #111;padding-top:10px}
  .notes{margin-top:22px;font-size:12px;color:#555;line-height:1.6;white-space:pre-line}
  .printbtn{text-align:center;margin:18px auto;max-width:720px}
  .printbtn button{font:inherit;font-weight:700;border:2px solid #111;background:#111;color:#fff;padding:10px 22px;cursor:pointer}
  @page{size:<?php echo esc_html($paper); ?>;margin:14mm}
  @media print{body{background:#fff}.sheet{border:0;margin:0;max-width:none;padding:0}.noprint{display:none}}
</style></head><body>
  <div class="sheet">
    <div class="top">
      <div class="seller">
        <?php if ($logo !== '') : ?>
          <div class="logo"><img src="<?php echo esc_url($logo); ?>" alt="<?php echo esc_attr($biz_name); ?>"></div>
        <?php else : ?>
          <div class="brand"><?php echo esc_html($biz_name); ?></div>
        <?php endif; ?>
        <div class="biz"><?php
          echo esc_html($biz_name);
          if ($biz_addr !== '')  { echo "\n" . esc_html($biz_addr); }
          if ($biz_email !== '') { echo "\n" . esc_html($biz_email); }
          if ($biz_phone !== '') { echo "\n" . esc_html($biz_phone); }
          if ($tax_no !== '')    { echo "\n" . esc_html(($tax_label !== '' ? $tax_label : __('Tax no.', 'october-events')) . ': ' . $tax_no); }
        ?></div>
      </div>
      <div class="doc">
        <h1 style="color:<?php echo esc_attr($accent); ?>"><?php esc_html_e('Invoice', 'october-events'); ?></h1>
        <div class="meta">
          <strong><?php echo esc_html((string) $inv['number']); ?></strong><br>
          <?php echo esc_html($when); ?>
        </div>
        <div class="paid"><?php esc_html_e('Paid', 'october-events'); ?></div>
      </div>
    </div>

    <div class="parties">
      <div class="box">
        <p class="k"><?php esc_html_e('Billed to', 'october-events'); ?></p>
        <div class="v">
          <?php if ((string) $inv['bill_to'] !== '') : ?><strong><?php echo esc_html((string) $inv['bill_to']); ?></strong><br><?php endif; ?>
          <?php echo esc_html((string) $inv['buyer_name']); ?><?php if ((string) $inv['buyer_name'] !== '') : ?><br><?php endif; ?>
          <?php echo esc_html((string) $inv['buyer_email']); ?>
        </div>
      </div>
      <div class="box">
        <p class="k"><?php esc_html_e('For', 'october-events'); ?></p>
        <div class="v">
          <?php echo esc_html((string) $inv['event_name']); ?><br>
          <?php if ((string) $inv['payment_id'] !== '') : ?><span style="font-size:12px;color:#888"><?php echo esc_html(sprintf(__('Payment ref: %s', 'october-events'), (string) $inv['payment_id'])); ?></span><?php endif; ?>
        </div>
      </div>
    </div>

    <hr class="rule">

    <table>
      <thead><tr>
        <th><?php esc_html_e('Item', 'october-events'); ?></th>
        <th class="r"><?php esc_html_e('Qty', 'october-events'); ?></th>
        <th class="r"><?php esc_html_e('Unit', 'october-events'); ?></th>
        <th class="r"><?php esc_html_e('Amount', 'october-events'); ?></th>
      </tr></thead>
      <tbody>
        <?php foreach ((array) $inv['lines'] as $ln) : ?>
          <tr>
            <td><?php echo esc_html((string) $ln['label']); ?></td>
            <td class="r"><?php echo (int) $ln['qty']; ?></td>
            <td class="r"><?php echo esc_html(self::money((float) $ln['unit'], $cur)); ?></td>
            <td class="r"><?php echo esc_html(self::money((float) $ln['line'], $cur)); ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
      <tfoot>
        <?php if ((float) $inv['discount'] > 0) : ?>
          <tr>
            <td colspan="3" class="r"><?php esc_html_e('Subtotal', 'october-events'); ?></td>
            <td class="r"><?php echo esc_html(self::money((float) $inv['subtotal'], $cur)); ?></td>
          </tr>
          <tr>
            <td colspan="3" class="r"><?php echo esc_html($inv['promos'] ? sprintf(__('Discount (%s)', 'october-events'), implode(', ', (array) $inv['promos'])) : __('Discount', 'october-events')); ?></td>
            <td class="r">−<?php echo esc_html(self::money((float) $inv['discount'], $cur)); ?></td>
          </tr>
        <?php endif; ?>
        <tr class="tot">
          <td colspan="3" class="r"><?php echo esc_html($tax_label !== '' ? sprintf(__('Total (incl. %s)', 'october-events'), $tax_label) : __('Total', 'october-events')); ?></td>
          <td class="r"><?php echo esc_html(self::money((float) $inv['total'], $cur)); ?></td>
        </tr>
      </tfoot>
    </table>

    <?php if ($notes !== '') : ?><div class="notes"><?php echo esc_html($notes); ?></div><?php endif; ?>
  </div>

  <div class="printbtn noprint"><button type="button" onclick="window.print()"><?php esc_html_e('Download / print invoice', 'october-events'); ?></button></div>

  <?php if ($admin) : ?>
    <form class="noprint" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"
          style="max-width:720px;margin:0 auto 28px;background:#fff;border:2px solid #111;padding:14px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-family:-apple-system,Arial,sans-serif">
      <input type="hidden" name="action" value="oe_invoice_billto">
      <input type="hidden" name="payment_id" value="<?php echo esc_attr((string) $inv['payment_id']); ?>">
      <?php wp_nonce_field('oe_invoice_billto'); ?>
      <label style="font-weight:700;font-size:13px"><?php esc_html_e('Bill to (company / name)', 'october-events'); ?></label>
      <input type="text" name="bill_to" value="<?php echo esc_attr((string) $inv['bill_to']); ?>"
             placeholder="<?php esc_attr_e('e.g. Savannah College of Art and Design', 'october-events'); ?>"
             style="flex:1;min-width:240px;padding:7px 10px;border:2px solid #111;font:inherit">
      <button type="submit" style="font:inherit;font-weight:700;border:2px solid #111;background:#111;color:#fff;padding:8px 18px;cursor:pointer"><?php esc_html_e('Save', 'october-events'); ?></button>
      <span style="font-size:12px;color:#777;width:100%"><?php esc_html_e('Admin only — this box is not shown to the customer.', 'october-events'); ?></span>
    </form>
  <?php endif; ?>
</body></html>
        <?php
        return (string) ob_get_clean();
    }
}
