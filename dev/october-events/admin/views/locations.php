<?php
/**
 * Multiple locations admin: the native Location records listed inline, a
 * slide-in to add one, and a dry-runnable migrator that promotes the per-event
 * locations repeater into `oe_location` records.
 *
 * @var array            $scan      Migrator::scan()
 * @var \WP_Post[]        $records   native location records
 * @var callable          $edit_link fn(int $id): string
 * @var array|false       $preview   last promote result (transient)
 */
defined('ABSPATH') || exit;

use OE\Admin\SlideIn;
use OE\Locations\Meta;

$total_rows = 0;
$total_promoted = 0;
foreach ($scan as $s) { $total_rows += (int) $s['count']; $total_promoted += (int) $s['promoted']; }
$outstanding = max(0, $total_rows - $total_promoted);

SlideIn::enqueue();
?>
<div class="wrap oe-admin oe-locations">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Multiple locations', 'october-events'); ?></span>
        <span>
            <?php echo SlideIn::trigger('oe-loc-new', __('+ New location', 'october-events'), 'button button-primary'); ?>
        </span>
    </h1>
    <?php \OE\Admin\Admin::events_lens('locations'); ?>

    <?php if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification
        $m = sanitize_key((string) $_GET['oe_msg']);
        $notes = [
            'loc_created' => [__('Location created.', 'october-events'), 'success'],
            'loc_noname'  => [__('Give the location a name.', 'october-events'), 'error'],
            'loc_fail'    => [__('Could not create the location. Try again.', 'october-events'), 'error'],
        ];
        if (isset($notes[$m])) : ?>
            <div class="notice notice-<?php echo esc_attr($notes[$m][1]); ?> is-dismissible inline"><p><?php echo esc_html($notes[$m][0]); ?></p></div>
        <?php endif;
    endif; ?>

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
        <div class="oe-ad-stat oe-ad-stat--feature"><div class="l"><?php esc_html_e('Location records', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n(count($records))); ?></div><div class="s"><?php esc_html_e('native, reusable', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('On events', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($total_rows)); ?></div><div class="s"><?php echo esc_html(sprintf(__('rows across %d events', 'october-events'), count($scan))); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Outstanding', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($outstanding)); ?></div><div class="s"><?php esc_html_e('not yet promoted', 'october-events'); ?></div></div>
    </div>

    <?php /* The native Location records, inline — no separate CPT list page. */ ?>
    <?php if ($records) : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead><tr>
                <th><?php esc_html_e('Location', 'october-events'); ?></th>
                <th><?php esc_html_e('Address', 'october-events'); ?></th>
                <th><?php esc_html_e('Day', 'october-events'); ?></th>
                <th class="oe-ad-num"></th>
            </tr></thead>
            <tbody>
            <?php foreach ($records as $loc) :
                $addr = (string) get_post_meta($loc->ID, Meta::key('address'), true);
                $day  = (string) get_post_meta($loc->ID, Meta::key('day'), true);
            ?>
                <tr>
                    <td><strong><?php echo esc_html(get_the_title($loc) ?: ('#' . $loc->ID)); ?></strong></td>
                    <td><?php echo esc_html($addr ?: '—'); ?></td>
                    <td><?php echo esc_html($day ?: '—'); ?></td>
                    <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url($edit_link((int) $loc->ID)); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php else : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No locations yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Add one with “+ New location”, add locations to an event with the Multiple locations capability, or promote existing per-event rows below.', 'october-events'); ?></span>
        </div>
    <?php endif; ?>

    <?php /* Migrator: promote per-event location rows into native records. */ ?>
    <details class="oe-ad-card oe-locations-migrator"<?php echo $outstanding > 0 ? ' open' : ''; ?> style="margin-top:16px">
        <summary class="oe-section-label" style="cursor:pointer;margin:0"><?php esc_html_e('Promote per-event locations', 'october-events'); ?></summary>
        <div style="margin-top:12px">
            <p><?php esc_html_e('This promotes the per-event location rows (the repeater on each event) into native Location records you can manage, feature and reuse. It is safe to run repeatedly: already-promoted rows are skipped, and the original repeater is left untouched.', 'october-events'); ?></p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input type="hidden" name="action" value="oe_locations_promote">
                <?php wp_nonce_field('oe_locations_promote'); ?>
                <button type="submit" name="commit" value="0" class="button"><?php esc_html_e('Dry run', 'october-events'); ?></button>
                <button type="submit" name="commit" value="1" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Create native Location records now? The original repeater is left in place.', 'october-events')); ?>');"><?php esc_html_e('Promote now', 'october-events'); ?></button>
            </form>
            <?php if ($scan) : ?>
            <table class="oe-ad-table" style="margin-top:14px">
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
            <?php endif; ?>
            <p class="oe-ad-note"><?php esc_html_e('Migrating from a JetEngine portfolio CPT? That field shape varies per site, so it is not run from here automatically — map it with the Import tool or ask for a one-off migration script once the field mapping is confirmed.', 'october-events'); ?></p>
        </div>
    </details>

    <?php /* New-location slide-in. */ ?>
    <?php SlideIn::open('oe-loc-new', __('New location', 'october-events')); ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:grid;gap:14px">
            <input type="hidden" name="action" value="oe_location_create">
            <?php wp_nonce_field('oe_location_create'); ?>
            <label style="display:grid;gap:4px;font-weight:600"><?php esc_html_e('Name', 'october-events'); ?>
                <input type="text" name="oe_loc_name" class="widefat" required placeholder="<?php esc_attr_e('e.g. Serenbe Pavilion', 'october-events'); ?>"></label>
            <label style="display:grid;gap:4px;font-weight:600"><?php esc_html_e('Address', 'october-events'); ?>
                <input type="text" name="oe_loc_address" class="widefat" placeholder="<?php esc_attr_e('Street, city, state', 'october-events'); ?>"></label>
            <label style="display:grid;gap:4px;font-weight:600"><?php esc_html_e('Day (optional)', 'october-events'); ?>
                <input type="text" name="oe_loc_day" class="widefat" placeholder="<?php esc_attr_e('e.g. Saturday', 'october-events'); ?>"></label>
            <label style="display:grid;gap:4px;font-weight:600"><?php esc_html_e('Map link (optional)', 'october-events'); ?>
                <input type="url" name="oe_loc_maps_url" class="widefat" placeholder="https://maps.google.com/…"></label>
            <p class="description" style="margin:0"><?php esc_html_e('Create the record now; open it to add the architect, images and other details.', 'october-events'); ?></p>
            <p style="margin:0"><button type="submit" class="button button-primary"><?php esc_html_e('Create location', 'october-events'); ?></button></p>
        </form>
    <?php SlideIn::close(); ?>
</div>
