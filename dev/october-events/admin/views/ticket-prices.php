<?php
/**
 * Ticket prices — what people actually paid per ticket. Each paid order's total
 * is divided by its admissions, so a group ticket counts per person. Pie of
 * price bands + the free/paid split and averages.
 *
 * @var array      $data         Orders::price_breakdown() result
 * @var \WP_Post[] $events       published events (for the filter)
 * @var int        $event_filter selected event id (0 = all)
 */
defined('ABSPATH') || exit;

$sym     = (string) ($data['symbol'] ?? '$');
$tickets = (int) ($data['tickets'] ?? 0);
$free    = (int) ($data['free'] ?? 0);
$paid    = (int) ($data['paid'] ?? 0);
$accent  = (string) \OE\Settings::get('theme_accent', '') ?: '#C8A96E';
$money   = static fn(float $v): string => $sym . number_format_i18n($v, 2);

// Pie (conic-gradient) + legend from the price bands (skip empty bands).
$palette = ['#9e9e9e', '#C8A96E', '#f9a825', '#2e7d32', '#1565c0', '#6a1b9a'];
$bands   = array_values(array_filter((array) ($data['bands'] ?? []), static fn($b) => (int) $b['count'] > 0));
$stops   = [];
$legend  = [];
$acc     = 0;
$i       = 0;
foreach ($bands as $b) {
    $n     = (int) $b['count'];
    $color = $palette[$i % count($palette)];
    $start = $tickets ? $acc / $tickets * 360 : 0;
    $acc  += $n;
    $end   = $tickets ? $acc / $tickets * 360 : 0;
    $stops[]  = $color . ' ' . round($start, 2) . 'deg ' . round($end, 2) . 'deg';
    $legend[] = ['label' => (string) $b['label'], 'n' => $n, 'color' => $color, 'pct' => $tickets ? round($n / $tickets * 100) : 0];
    $i++;
}
$gradient = $stops ? 'conic-gradient(' . implode(',', $stops) . ')' : '#eee';
$free_pct = $tickets ? round($free / $tickets * 100) : 0;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('prices'); ?>

    <form method="get" style="margin:16px 0">
        <input type="hidden" name="page" value="oe-tickets">
        <input type="hidden" name="tab" value="prices">
        <label><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select>
        </label>
    </form>

    <?php if (! $tickets) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px">
            <strong><?php esc_html_e('No paid tickets yet.', 'october-events'); ?></strong>
            <p class="description" style="margin:6px 0 0"><?php esc_html_e('Once tickets are issued (paid or comped), the price breakdown appears here.', 'october-events'); ?></p>
        </div>
    <?php else : ?>

        <?php /* Headline numbers. */ ?>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
            <?php
            $tiles = [
                [__('Tickets', 'october-events'), number_format_i18n($tickets), __('admissions counted', 'october-events')],
                [__('Free', 'october-events'), number_format_i18n($free) . ' · ' . $free_pct . '%', __('given away', 'october-events')],
                [__('Paid', 'october-events'), number_format_i18n($paid), __('tickets paid for', 'october-events')],
                [__('Avg per ticket', 'october-events'), $money((float) $data['avg_all']), __('across all tickets', 'october-events')],
                [__('Avg paid ticket', 'october-events'), $money((float) $data['avg_paid']), __('excludes free', 'october-events')],
                [__('Revenue', 'october-events'), $money((float) $data['revenue']), __('total collected', 'october-events')],
            ];
            foreach ($tiles as $tile) : ?>
                <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px">
                    <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php echo esc_html($tile[0]); ?></div>
                    <div style="font-weight:800;font-size:22px;margin:2px 0"><?php echo esc_html($tile[1]); ?></div>
                    <div class="description" style="font-size:11px"><?php echo esc_html($tile[2]); ?></div>
                </div>
            <?php endforeach; ?>
        </div>

        <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-bottom:18px">
            <?php /* Pie of price bands. */ ?>
            <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;display:flex;gap:20px;align-items:center;flex:1;min-width:340px">
                <div style="width:170px;height:170px;border-radius:50%;flex:none;background:<?php echo esc_attr($gradient); ?>"></div>
                <div style="flex:1;min-width:0">
                    <div class="oe-panel-label" style="margin-bottom:8px;font-weight:700"><?php esc_html_e('Price paid per ticket', 'october-events'); ?></div>
                    <?php foreach ($legend as $row) : ?>
                        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px">
                            <span style="width:12px;height:12px;border-radius:3px;flex:none;background:<?php echo esc_attr($row['color']); ?>"></span>
                            <span style="flex:1"><?php echo esc_html($row['label']); ?></span>
                            <strong><?php echo esc_html(number_format_i18n($row['n'])); ?></strong>
                            <span class="description" style="width:44px;text-align:right"><?php echo (int) $row['pct']; ?>%</span>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>

            <?php /* Distinct prices paid (group tickets divided per admission). */ ?>
            <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px;flex:1;min-width:300px">
                <div style="font-weight:700;margin-bottom:6px"><?php esc_html_e('Distinct prices paid', 'october-events'); ?></div>
                <p class="description" style="margin:0 0 10px"><?php esc_html_e('Per admission — a group ticket is split by the number it admits.', 'october-events'); ?></p>
                <table class="widefat striped">
                    <thead><tr><th><?php esc_html_e('Price / ticket', 'october-events'); ?></th><th><?php esc_html_e('Tickets', 'october-events'); ?></th><th><?php esc_html_e('Share', 'october-events'); ?></th></tr></thead>
                    <tbody>
                    <?php foreach ((array) $data['distinct'] as $d) : $pct = $tickets ? round((int) $d['count'] / $tickets * 100) : 0; ?>
                        <tr>
                            <td><?php echo (float) $d['price'] <= 0 ? esc_html__('Free', 'october-events') : esc_html($money((float) $d['price'])); ?></td>
                            <td><?php echo esc_html(number_format_i18n((int) $d['count'])); ?></td>
                            <td><?php echo (int) $pct; ?>%</td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>

        <?php if ($free_pct >= 50) : ?>
            <div class="notice notice-warning inline" style="margin:0"><p><?php echo esc_html(sprintf(
                /* translators: %d: percent free */
                __('Heads up: %d%% of tickets are free. If that is higher than intended, tighten which ticket types are comped or add a paid tier.', 'october-events'),
                $free_pct
            )); ?></p></div>
        <?php endif; ?>

    <?php endif; ?>
</div>
