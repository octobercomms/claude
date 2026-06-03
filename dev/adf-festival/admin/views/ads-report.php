<?php
/** @var array $campaigns @var int $selected @var array $stats @var array $by_source */
defined('ABSPATH') || exit;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Ad Report', 'adf-festival'); ?></h1>
    <form method="get">
        <input type="hidden" name="page" value="adf-ad-report">
        <select name="campaign" onchange="this.form.submit()">
            <?php foreach ($campaigns as $c) : ?>
                <option value="<?php echo (int) $c->id; ?>" <?php selected($selected, (int) $c->id); ?>><?php echo esc_html($c->name); ?></option>
            <?php endforeach; ?>
        </select>
    </form>

    <?php if (! $campaigns) : ?>
        <p><?php esc_html_e('No campaigns to report on yet.', 'adf-festival'); ?></p>
    <?php else : ?>
        <table class="widefat striped" style="max-width:420px;margin-top:16px">
            <tbody>
                <tr><td><?php esc_html_e('Impressions', 'adf-festival'); ?></td><td><strong><?php echo (int) $stats['impressions']; ?></strong></td></tr>
                <tr><td><?php esc_html_e('Clicks', 'adf-festival'); ?></td><td><strong><?php echo (int) $stats['clicks']; ?></strong></td></tr>
                <tr><td><?php esc_html_e('CTR', 'adf-festival'); ?></td><td><strong><?php echo esc_html($stats['ctr']); ?>%</strong></td></tr>
            </tbody>
        </table>

        <h2 style="margin-top:20px"><?php esc_html_e('Impressions by page', 'adf-festival'); ?></h2>
        <table class="widefat striped" style="max-width:680px">
            <thead><tr><th><?php esc_html_e('Source page', 'adf-festival'); ?></th><th><?php esc_html_e('Impressions', 'adf-festival'); ?></th></tr></thead>
            <tbody>
            <?php if (! $by_source) : ?><tr><td colspan="2"><?php esc_html_e('No data yet.', 'adf-festival'); ?></td></tr><?php endif; ?>
            <?php foreach ($by_source as $r) : ?>
                <tr><td><?php echo esc_html($r->source_url ?: '—'); ?></td><td><?php echo (int) $r->hits; ?></td></tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
