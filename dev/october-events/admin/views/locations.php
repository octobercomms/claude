<?php
/**
 * Tour locations migrator screen (ROADMAP R1).
 *
 * @var array $scan     Migrator::scan()
 * @var string $loc_list native location list URL
 * @var string $new_loc  add-new location URL
 * @var array|false $preview last promote result (transient)
 */
defined('ABSPATH') || exit;

$total_rows = 0;
$total_promoted = 0;
foreach ($scan as $s) { $total_rows += (int) $s['count']; $total_promoted += (int) $s['promoted']; }
$outstanding = max(0, $total_rows - $total_promoted);
?>
<div class="wrap oe-admin oe-locations">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Tour locations', 'october-events'); ?></span>
        <span>
            <a class="button" href="<?php echo esc_url($loc_list); ?>"><?php esc_html_e('All locations', 'october-events'); ?></a>
            <a class="button button-primary" href="<?php echo esc_url($new_loc); ?>"><?php esc_html_e('+ New location', 'october-events'); ?></a>
        </span>
    </h1>

    <?php if (is_array($preview)) : ?>
        <div class="notice notice-<?php echo ! empty($preview['dry']) ? 'info' : 'success'; ?> is-dismissible inline"><p>
            <?php if (! empty($preview['dry'])) : ?>
                <?php echo esc_html(sprintf(__('Dry run: %1$d location(s) would be created across %2$d event(s); %3$d already promoted or skipped. Nothing was written.', 'october-events'), (int) $preview['created'], (int) $preview['events'], (int) $preview['skipped'])); ?>
            <?php else : ?>
                <?php echo esc_html(sprintf(__('Promoted %1$d location(s) across %2$d event(s); %3$d skipped (already promoted or unnamed).', 'october-events'), (int) $preview['created'], (int) $preview['events'], (int) $preview['skipped'])); ?>
            <?php endif; ?>
        </p></div>
    <?php endif; ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature"><div class="l"><?php esc_html_e('Location rows', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($total_rows)); ?></div><div class="s"><?php echo esc_html(sprintf(__('across %d events', 'october-events'), count($scan))); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Promoted', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($total_promoted)); ?></div><div class="s"><?php esc_html_e('already native', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Outstanding', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($outstanding)); ?></div><div class="s"><?php esc_html_e('not yet promoted', 'october-events'); ?></div></div>
    </div>

    <div class="oe-ad-card">
        <p><?php esc_html_e('This promotes the per-event Tour locations (the repeater on each event) into native Location records you can manage, feature and reuse. It is safe to run repeatedly: already-promoted rows are skipped, and the original repeater is left untouched.', 'october-events'); ?></p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="hidden" name="action" value="oe_locations_promote">
            <?php wp_nonce_field('oe_locations_promote'); ?>
            <button type="submit" name="commit" value="0" class="button"><?php esc_html_e('Dry run', 'october-events'); ?></button>
            <button type="submit" name="commit" value="1" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Create native Location records now? The original repeater is left in place.', 'october-events')); ?>');"><?php esc_html_e('Promote now', 'october-events'); ?></button>
        </form>
        <p class="oe-ad-note"><?php esc_html_e('Migrating from a JetEngine portfolio CPT? That field shape varies per site, so it is not run from here automatically — map it with the Import tool or ask for a one-off migration script once the field mapping is confirmed.', 'october-events'); ?></p>
    </div>

    <?php if ($scan) : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead><tr>
                <th><?php esc_html_e('Event', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('Locations', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('Promoted', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php foreach ($scan as $s) : ?>
                <tr>
                    <td><strong><?php echo esc_html((string) $s['title']); ?></strong> <span class="description">#<?php echo (int) $s['event_id']; ?></span></td>
                    <td class="oe-ad-num"><?php echo (int) $s['count']; ?></td>
                    <td class="oe-ad-num"><?php echo (int) $s['promoted']; ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php else : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No tour locations found.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Add locations to an event with the Tour pack, or create native Location records directly.', 'october-events'); ?></span>
        </div>
    <?php endif; ?>
</div>
