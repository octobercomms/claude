<?php
/**
 * Events overview (ADMIN-BUILD AD2).
 *
 * @var \WP_Post[] $events
 * @var array<int,int> $sold   event_id => tickets sold
 * @var string $filter
 */
defined('ABSPATH') || exit;

use OE\Admin\Admin;
use OE\PostTypes;
use OE\Packs\Registry;
use OE\Planning\Events;

$today = current_time('Y-m-d');

// Build a compact record per event, then filter + count in PHP.
$rows = [];
foreach ($events as $post) {
    $id    = (int) $post->ID;
    $start = (string) Events::get($id, 'start_datetime', '');
    $day   = $start !== '' ? substr($start, 0, 10) : '';
    $packs = [];
    foreach (Registry::PACKS as $pid => $def) {
        if (Registry::enabled($id, $pid)) {
            $packs[$pid] = $def;
        }
    }
    $rows[] = [
        'id'       => $id,
        'title'    => get_the_title($id) ?: __('(untitled)', 'october-events'),
        'start'    => $start,
        'upcoming' => $day !== '' && $day >= $today,
        'status'   => $post->post_status,
        'packs'    => $packs,
        'sold'     => (int) ($sold[$id] ?? 0),
    ];
}

$matches = static function (array $r, string $f): bool {
    switch ($f) {
        case 'upcoming': return $r['upcoming'];
        case 'past':     return ! $r['upcoming'] && $r['start'] !== '';
        case 'conference':
        case 'exhibition':
        case 'tour':     return isset($r['packs'][$f]);
        case 'ticketed': return isset($r['packs']['tickets']);
        default:         return true;
    }
};

$count = static function (string $f) use ($rows, $matches): int {
    $n = 0;
    foreach ($rows as $r) {
        if ($matches($r, $f)) {
            $n++;
        }
    }
    return $n;
};

$chips = [
    'all'        => __('All', 'october-events'),
    'upcoming'   => __('Upcoming', 'october-events'),
    'past'       => __('Past', 'october-events'),
    'conference' => __('Conference', 'october-events'),
    'exhibition' => __('Exhibition', 'october-events'),
    'tour'       => __('Tour', 'october-events'),
    'ticketed'   => __('Ticketed', 'october-events'),
];

$status_label = [
    'publish' => [__('Published', 'october-events'), 'pos'],
    'pending' => [__('Pending', 'october-events'), 'warn'],
    'draft'   => [__('Draft', 'october-events'), 'neu'],
    'future'  => [__('Scheduled', 'october-events'), 'info'],
    'private' => [__('Private', 'october-events'), 'neu'],
];

$new_url   = admin_url('post-new.php?post_type=' . PostTypes::slug('event'));
$base_url  = admin_url('admin.php?page=oe-events');
?>
<div class="wrap oe-admin">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Events', 'october-events'); ?></span>
        <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-countdown')); ?>"><?php esc_html_e('Countdown image', 'october-events'); ?></a>
            <a class="button button-primary" href="<?php echo esc_url($new_url); ?>"><?php esc_html_e('+ New event', 'october-events'); ?></a>
        </span>
    </h1>
    <?php Admin::bento('listing'); ?>

    <div class="oe-ad-fchiprow">
        <?php foreach ($chips as $key => $label) : ?>
            <a class="oe-ad-fchip<?php echo $filter === $key ? ' is-active' : ''; ?>" href="<?php echo esc_url(add_query_arg('oe_evf', $key, $base_url)); ?>">
                <?php echo esc_html($label); ?> (<?php echo (int) $count($key); ?>)
            </a>
        <?php endforeach; ?>
    </div>

    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead><tr>
                <th><?php esc_html_e('Event', 'october-events'); ?></th>
                <th><?php esc_html_e('Date', 'october-events'); ?></th>
                <th><?php esc_html_e('Capabilities', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('Sold', 'october-events'); ?></th>
                <th class="oe-ad-num"></th>
            </tr></thead>
            <tbody>
            <?php
            $shown = 0;
            foreach ($rows as $r) :
                if (! $matches($r, $filter)) {
                    continue;
                }
                $shown++;
                $edit = get_edit_post_link($r['id']);
                [$slabel, $stone] = $status_label[$r['status']] ?? [$r['status'], 'neu'];
                ?>
                <tr>
                    <td><strong><a href="<?php echo esc_url((string) $edit); ?>"><?php echo esc_html($r['title']); ?></a></strong></td>
                    <td><?php echo esc_html($r['start'] !== '' ? $r['start'] : '—'); ?></td>
                    <td>
                        <?php foreach ($r['packs'] as $def) : ?>
                            <span class="oe-ad-badge"><?php echo esc_html($def['icon']); ?> <?php echo esc_html($def['label']); ?></span>
                        <?php endforeach; ?>
                        <?php if (empty($r['packs'])) : ?><span class="subtle">—</span><?php endif; ?>
                    </td>
                    <td><span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($stone); ?>"><?php echo esc_html($slabel); ?></span></td>
                    <td class="oe-ad-num"><?php echo $r['sold'] > 0 ? esc_html(number_format_i18n($r['sold'])) : '—'; ?></td>
                    <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url((string) $edit); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
                </tr>
            <?php endforeach; ?>
            <?php if ($shown === 0) : ?>
                <tr><td colspan="6" style="padding:28px 16px;text-align:center;color:#888;"><?php esc_html_e('No events match that filter.', 'october-events'); ?></td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
    <p class="oe-ad-note"><?php esc_html_e('Capability badges show which packs are on. Click a row to edit the event.', 'october-events'); ?></p>
</div>
