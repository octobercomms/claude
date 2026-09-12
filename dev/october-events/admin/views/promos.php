<?php
/**
 * Promo / discount code CRUD (with edit).
 *
 * @var array       $promos
 * @var \WP_Post[]  $events
 * @var object|null $editing  the code being edited, or null when adding
 */
defined('ABSPATH') || exit;
$ed        = $editing ?? null;
$ed_event  = $ed ? (int) $ed->event_id : 0;
$ed_type   = $ed ? (string) $ed->discount_type : 'percent';
$ed_active = $ed ? (bool) $ed->active : true;
$ed_expiry = $ed && $ed->expires_at ? str_replace(' ', 'T', substr((string) $ed->expires_at, 0, 16)) : '';
$ed_keys   = $ed ? \OE\Ticketing\Promo::applies_to($ed) : [];
$types_by_event = $types_by_event ?? [];
$promos_url = admin_url('admin.php?page=oe-tickets&tab=promos');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('promos'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('promos'); ?>

    <h2><?php echo $ed ? esc_html(sprintf(__('Edit code: %s', 'october-events'), $ed->code)) : esc_html__('Add a code', 'october-events'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="oe_save_promo">
        <?php if ($ed) : ?><input type="hidden" name="id" value="<?php echo (int) $ed->id; ?>"><?php endif; ?>
        <?php wp_nonce_field('oe_save_promo'); ?>
        <label><?php esc_html_e('Code', 'october-events'); ?><br><input type="text" name="code" required style="text-transform:uppercase" value="<?php echo esc_attr($ed ? (string) $ed->code : ''); ?>"></label>
        <label><?php esc_html_e('Event', 'october-events'); ?><br>
            <select name="event_id"><option value=""><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?><option value="<?php echo (int) $ev->ID; ?>" <?php selected($ed_event, $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option><?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Type', 'october-events'); ?><br>
            <select name="discount_type"><option value="percent" <?php selected($ed_type, 'percent'); ?>>% percent</option><option value="fixed" <?php selected($ed_type, 'fixed'); ?>>fixed</option></select></label>
        <label><?php esc_html_e('Value', 'october-events'); ?><br><input type="number" step="0.01" min="0" name="discount_value" required style="width:80px" value="<?php echo $ed ? esc_attr($ed->discount_value) : ''; ?>"></label>
        <label><?php esc_html_e('Max uses', 'october-events'); ?><br><input type="number" min="0" name="max_uses" placeholder="∞" style="width:80px" value="<?php echo $ed && $ed->max_uses !== null ? (int) $ed->max_uses : ''; ?>"></label>
        <label><?php esc_html_e('Expires', 'october-events'); ?><br><input type="datetime-local" name="expires_at" value="<?php echo esc_attr($ed_expiry); ?>"></label>
        <label><input type="checkbox" name="active" value="1" <?php checked($ed_active); ?>> <?php esc_html_e('Active', 'october-events'); ?></label>
        <div id="oe-promo-tickets-wrap" style="flex-basis:100%;<?php echo $ed_event ? '' : 'display:none'; ?>">
            <strong><?php esc_html_e('Limit to tickets', 'october-events'); ?></strong> <span class="oe-optional">(<?php esc_html_e('optional', 'october-events'); ?>)</span>
            <div id="oe-promo-tickets" style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px"></div>
            <p class="description" style="margin:6px 0 0"><?php esc_html_e('Leave all unticked to discount the whole event. When some are ticked, a fixed amount comes off each selected ticket and a percentage applies to the selected tickets only.', 'october-events'); ?></p>
        </div>
        <button class="button button-primary"><?php echo $ed ? esc_html__('Update code', 'october-events') : esc_html__('Save code', 'october-events'); ?></button>
        <?php if ($ed) : ?><a class="button" href="<?php echo esc_url($promos_url); ?>"><?php esc_html_e('Cancel', 'october-events'); ?></a><?php endif; ?>
    </form>

    <h2 style="margin-top:24px"><?php esc_html_e('Existing codes', 'october-events'); ?></h2>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Code', 'october-events'); ?></th><th><?php esc_html_e('Event', 'october-events'); ?></th>
            <th><?php esc_html_e('Discount', 'october-events'); ?></th><th><?php esc_html_e('Used', 'october-events'); ?></th>
            <th><?php esc_html_e('Expires', 'october-events'); ?></th><th><?php esc_html_e('Active', 'october-events'); ?></th>
            <th><?php esc_html_e('Share link', 'october-events'); ?></th><th></th>
        </tr></thead>
        <tbody>
        <?php if (! $promos) : ?><tr><td colspan="8"><?php esc_html_e('No codes yet.', 'october-events'); ?></td></tr><?php endif; ?>
        <?php foreach ($promos as $p) :
            $del  = wp_nonce_url(admin_url('admin-post.php?action=oe_delete_promo&id=' . $p->id), 'oe_delete_promo');
            $edit = add_query_arg(['page' => 'oe-tickets', 'tab' => 'promos', 'edit' => (int) $p->id], admin_url('admin.php')); ?>
            <tr>
                <td><code><?php echo esc_html($p->code); ?></code></td>
                <td><?php echo $p->event_id ? esc_html(get_the_title((int) $p->event_id)) : esc_html__('All', 'october-events'); ?>
                    <?php
                    $pk = \OE\Ticketing\Promo::applies_to($p);
                    if ($pk && $p->event_id && ! empty($types_by_event[(int) $p->event_id])) {
                        $labels = [];
                        foreach ($types_by_event[(int) $p->event_id] as $t) {
                            if (in_array($t['key'], $pk, true)) { $labels[] = $t['label']; }
                        }
                        if ($labels) {
                            echo '<br><span class="description">' . esc_html(implode(', ', $labels)) . '</span>';
                        }
                    }
                    ?></td>
                <td><?php echo $p->discount_type === 'percent' ? esc_html($p->discount_value . '%') : esc_html($p->discount_value); ?></td>
                <td><?php echo (int) $p->used_count; ?><?php echo $p->max_uses !== null ? ' / ' . (int) $p->max_uses : ''; ?></td>
                <td><?php echo $p->expires_at ? esc_html($p->expires_at) : '—'; ?></td>
                <td><?php echo $p->active ? '✓' : '—'; ?></td>
                <td>
                    <?php $perma = $p->event_id ? get_permalink((int) $p->event_id) : ''; ?>
                    <?php if ($perma) :
                        $share = add_query_arg('promo', rawurlencode((string) $p->code), $perma); ?>
                        <input type="text" readonly value="<?php echo esc_attr($share); ?>" onfocus="this.select()" style="width:210px;font-size:11px;vertical-align:middle" aria-label="<?php esc_attr_e('Shareable checkout link', 'october-events'); ?>">
                        <button type="button" class="button button-small oe-copy-link" data-clip="<?php echo esc_attr($share); ?>"><?php esc_html_e('Copy', 'october-events'); ?></button>
                    <?php else : ?>
                        <span class="description"><?php echo esc_html(sprintf(__('Add %s to any event link', 'october-events'), '?promo=' . $p->code)); ?></span>
                        <button type="button" class="button button-small oe-copy-link" data-clip="<?php echo esc_attr('?promo=' . $p->code); ?>"><?php esc_html_e('Copy', 'october-events'); ?></button>
                    <?php endif; ?>
                </td>
                <td><a class="button button-small" href="<?php echo esc_url($edit); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a>
                    <a class="button button-small" href="<?php echo esc_url($del); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this code?', 'october-events')); ?>')"><?php esc_html_e('Delete', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <script>
    (function () {
        var MAP = <?php echo wp_json_encode((object) $types_by_event); ?>;
        var SAVED = <?php echo wp_json_encode(array_values($ed_keys)); ?>;
        var sel = document.querySelector('form select[name="event_id"]');
        var wrap = document.getElementById('oe-promo-tickets-wrap');
        var box = document.getElementById('oe-promo-tickets');
        if (!sel || !wrap || !box) { return; }
        function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
        function render() {
            var types = MAP[sel.value] || [];
            box.innerHTML = '';
            if (!types.length) { wrap.style.display = 'none'; return; }
            wrap.style.display = '';
            types.forEach(function (t) {
                var on = SAVED.indexOf(t.key) !== -1 ? ' checked' : '';
                var l = document.createElement('label');
                l.style.fontWeight = 'normal';
                l.innerHTML = '<input type="checkbox" name="ticket_type_keys[]" value="' + esc(t.key) + '"' + on + '> ' + esc(t.label || t.key);
                box.appendChild(l);
            });
        }
        sel.addEventListener('change', function () { SAVED = []; render(); });
        render();
    })();
    document.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.oe-copy-link') : null;
        if (!btn) { return; }
        var text = btn.getAttribute('data-clip') || '';
        var done = function () { var o = btn.textContent; btn.textContent = '<?php echo esc_js(__('Copied', 'october-events')); ?>'; setTimeout(function () { btn.textContent = o; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {});
        } else {
            var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
            try { document.execCommand('copy'); } catch (err) {} document.body.removeChild(t); done();
        }
    });
    </script>
</div>
