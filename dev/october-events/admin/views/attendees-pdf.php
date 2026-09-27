<?php
/**
 * Printable attendee sheet — a standalone, branded HTML page the browser saves
 * as PDF (matches the ticket/door print pattern; no server-side PDF library).
 *
 * @var array<int,object> $rows        attendee rows
 * @var string            $brand       brand name
 * @var string            $accent      accent hex (brand colour)
 * @var string            $ink         accent-on hex (text/foreground on the accent)
 * @var int               $event       event filter id (0 = all events)
 * @var string            $title       event title (or "All events")
 * @var string            $generated   human date/time generated
 * @var int               $total       total attendees
 * @var int               $checked_in  checked-in count
 */
defined('ABSPATH') || exit;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php echo esc_attr(get_bloginfo('charset')); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html($brand . ' — ' . __('Attendees', 'october-events') . ' — ' . $title); ?></title>
<style>
    :root { --accent: <?php echo esc_html($accent); ?>; --accent-on: <?php echo esc_html($ink); ?>; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 32px; background: #fff; }
    .sheet { max-width: 900px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid var(--accent); padding-bottom: 12px; margin-bottom: 4px; }
    .head h1 { font-size: 22px; margin: 0; }
    .head .brand { font-weight: 700; text-transform: uppercase; letter-spacing: .06em; font-size: 13px; color: #555; }
    .head .ev { font-size: 15px; color: #333; margin-top: 2px; }
    .meta { display: flex; gap: 18px; font-size: 12px; color: #666; margin: 8px 0 18px; }
    .meta strong { color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    thead th { text-align: left; border-bottom: 2px solid #1a1a1a; padding: 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    tbody td { padding: 8px 6px; border-bottom: 1px solid #e2e2e2; vertical-align: top; }
    tbody tr:nth-child(even) { background: #faf9f6; }
    .tick { width: 34px; text-align: center; }
    .box { display: inline-block; width: 15px; height: 15px; border: 1.5px solid #888; border-radius: 3px; }
    .in { color: #2e7d32; font-weight: 700; }
    .no { color: #999; }
    .num { white-space: nowrap; color: #666; }
    .toolbar { max-width: 900px; margin: 0 auto 18px; }
    .toolbar button { font-size: 14px; font-weight: 700; padding: 10px 20px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-on); cursor: pointer; }
    .empty { padding: 40px; text-align: center; color: #999; }
    @media print {
        body { padding: 0; }
        .noprint { display: none !important; }
        thead { display: table-header-group; }
        tbody tr { page-break-inside: avoid; }
        tbody tr:nth-child(even) { background: #f2f2f2 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @page { margin: 14mm; }
</style>
</head>
<body>
<div class="toolbar noprint">
    <button type="button" onclick="window.print()"><?php esc_html_e('Save as PDF / Print', 'october-events'); ?></button>
</div>
<div class="sheet">
    <div class="head">
        <div>
            <div class="brand"><?php echo esc_html($brand); ?></div>
            <h1><?php esc_html_e('Attendee list', 'october-events'); ?></h1>
            <div class="ev"><?php echo esc_html($title); ?></div>
        </div>
    </div>
    <div class="meta">
        <span><strong><?php echo (int) $total; ?></strong> <?php esc_html_e('attendees', 'october-events'); ?></span>
        <span><strong><?php echo (int) $checked_in; ?></strong> <?php esc_html_e('checked in', 'october-events'); ?></span>
        <span><?php echo esc_html(sprintf(__('Generated %s', 'october-events'), $generated)); ?></span>
    </div>

    <?php if ($total === 0) : ?>
        <p class="empty"><?php esc_html_e('No attendees yet.', 'october-events'); ?></p>
    <?php else : ?>
        <table>
            <thead>
                <tr>
                    <th class="tick"><?php esc_html_e('In', 'october-events'); ?></th>
                    <th><?php esc_html_e('Attendee', 'october-events'); ?></th>
                    <th><?php esc_html_e('Ticket type', 'october-events'); ?></th>
                    <th><?php esc_html_e('Ticket', 'october-events'); ?></th>
                    <?php if (! $event) : ?><th><?php esc_html_e('Event', 'october-events'); ?></th><?php endif; ?>
                    <th><?php esc_html_e('Buyer', 'october-events'); ?></th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($rows as $r) :
                    $name = (string) $r->attendee_name !== '' ? (string) $r->attendee_name : (string) $r->buyer;
                    $done = (int) $r->scans > 0;
                    ?>
                    <tr>
                        <td class="tick"><?php echo $done ? '<span class="in">✓</span>' : '<span class="box"></span>'; ?></td>
                        <td><?php echo esc_html($name); ?></td>
                        <td><?php echo esc_html((string) $r->ticket_type_label); ?></td>
                        <td class="num"><?php echo esc_html($r->ticket_number . '/' . $r->total_in_order); ?></td>
                        <?php if (! $event) : ?><td><?php echo esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)); ?></td><?php endif; ?>
                        <td><?php echo esc_html((string) $r->buyer); ?></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
<script>
/* Open the print dialog automatically — this link is a "download PDF" action. */
window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
</script>
</body>
</html>
