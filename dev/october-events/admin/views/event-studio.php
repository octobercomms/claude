<?php
/**
 * Event Studio view — split pane: fields (left) + live preview (right).
 *
 * @var int                 $id         event id (0 = new)
 * @var \WP_Post|null       $post
 * @var array<string,mixed> $values     Events::values() (or blanks)
 * @var string              $status     draft|pending|publish
 * @var int                 $thumb      featured image id
 * @var string              $thumb_src  featured image URL
 * @var string              $preview    preview URL (empty for a brand-new event)
 */
defined('ABSPATH') || exit;

use OE\Planning\Events;

$v = static fn(string $f): string => (string) ($values[$f] ?? '');
$field = static function (string $name, string $label, string $value, string $type = 'text', string $ph = '') {
    printf(
        '<label class="oe-es-f"><span>%s</span><input type="%s" name="oe_event[%s]" value="%s" placeholder="%s" data-live></label>',
        esc_html($label),
        esc_attr($type),
        esc_attr($name),
        esc_attr($value),
        esc_attr($ph)
    );
};
?>
<div class="wrap oe-admin oe-es">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php echo $id > 0 ? esc_html__('Edit event', 'october-events') : esc_html__('New event', 'october-events'); ?></span>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-events')); ?>">&larr; <?php esc_html_e('All events', 'october-events'); ?></a>
    </h1>

    <?php if (isset($_GET['saved'])) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended ?>
        <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Event saved.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-es-grid" id="oe-es-form">
        <input type="hidden" name="action" value="oe_event_studio_save">
        <input type="hidden" name="event_id" id="oe-es-id" value="<?php echo (int) $id; ?>">
        <?php wp_nonce_field('oe_event_studio_save'); ?>

        <div class="oe-es-pane oe-es-left">
            <div class="oe-ad-card">
                <div class="oe-section-label"><?php esc_html_e('The basics', 'october-events'); ?></div>
                <?php
                $field('name', __('Event name', 'october-events'), $v('name'), 'text', 'e.g. Creative Futures Conference');
                $field('organiser', __('Organiser', 'october-events'), $v('organiser'), 'text', '');
                ?>
                <label class="oe-es-f"><span><?php esc_html_e('Description', 'october-events'); ?></span>
                    <textarea name="oe_event[description]" data-live rows="4"><?php echo esc_textarea($v('description')); ?></textarea>
                </label>
                <div class="oe-es-row">
                    <?php
                    $field('start_datetime', __('Start', 'october-events'), $v('start_datetime'), 'text', 'YYYY-MM-DD HH:MM');
                    $field('end_datetime', __('End', 'october-events'), $v('end_datetime'), 'text', 'YYYY-MM-DD HH:MM');
                    ?>
                </div>
                <div class="oe-es-row">
                    <?php
                    $field('start_time', __('Daily start (optional)', 'october-events'), $v('start_time'), 'text', 'HH:MM');
                    $field('end_time', __('Daily end (optional)', 'october-events'), $v('end_time'), 'text', 'HH:MM');
                    ?>
                </div>
                <div class="oe-es-row">
                    <?php
                    $field('location', __('Location', 'october-events'), $v('location'), 'text', 'e.g. The Old Selfridges Hotel');
                    $field('price', __('Display price', 'october-events'), $v('price'), 'text', 'e.g. Free, £45, From £10');
                    ?>
                </div>
            </div>

            <div class="oe-ad-card">
                <div class="oe-section-label"><?php esc_html_e('Tickets & status', 'october-events'); ?></div>
                <label class="oe-es-f oe-es-check"><input type="checkbox" name="oe_event[ticket_required]" value="1" data-live <?php checked($v('ticket_required') === '1'); ?>> <span><?php esc_html_e('A ticket is required to attend', 'october-events'); ?></span></label>
                <div class="oe-es-row">
                    <?php
                    $field('ticket_link', __('External ticket link (optional)', 'october-events'), $v('ticket_link'), 'url', 'https://…  blank = native checkout');
                    $field('ticket_link_text', __('External link button text', 'october-events'), $v('ticket_link_text'), 'text', 'e.g. Book tickets');
                    ?>
                </div>
                <div class="oe-es-row">
                    <label class="oe-es-f"><span><?php esc_html_e('Availability', 'october-events'); ?></span>
                        <select name="oe_event[availability]" data-live>
                            <option value=""><?php esc_html_e('Not specified', 'october-events'); ?></option>
                            <?php foreach (Events::AVAILABILITY as $k => $lbl) : ?>
                                <option value="<?php echo esc_attr($k); ?>" <?php selected($v('availability'), $k); ?>><?php echo esc_html($lbl); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label class="oe-es-f"><span><?php esc_html_e('Status badge', 'october-events'); ?></span>
                        <select name="oe_event[status_preset]" data-live>
                            <option value=""><?php esc_html_e('None (routine)', 'october-events'); ?></option>
                            <?php foreach (Events::STATUS_PRESETS as $k => $preset) : ?>
                                <option value="<?php echo esc_attr($k); ?>" <?php selected($v('status_preset'), $k); ?>><?php echo esc_html($preset[0]); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </div>
            </div>

            <div class="oe-ad-card">
                <div class="oe-section-label"><?php esc_html_e('Branding & media', 'october-events'); ?></div>
                <div class="oe-es-row">
                    <?php
                    $field('event_number', __('Reference number', 'october-events'), $v('event_number'), 'text', 'e.g. 013');
                    $field('brand_colour', __('Brand colour', 'october-events'), $v('brand_colour'), 'text', '#000000');
                    ?>
                </div>
                <div class="oe-es-media">
                    <span class="oe-es-f-label"><?php esc_html_e('Featured image', 'october-events'); ?></span>
                    <span class="oe-es-img" id="oe-es-img">
                        <img src="<?php echo esc_url($thumb_src); ?>" alt=""<?php echo $thumb_src ? '' : ' style="display:none"'; ?>>
                        <input type="hidden" name="featured_image" id="oe-es-img-id" value="<?php echo (int) ($thumb ?: 0); ?>">
                        <button type="button" class="button" id="oe-es-img-pick"><?php esc_html_e('Choose image', 'october-events'); ?></button>
                        <button type="button" class="button-link" id="oe-es-img-clear"<?php echo $thumb ? '' : ' style="display:none"'; ?>><?php esc_html_e('Remove', 'october-events'); ?></button>
                    </span>
                </div>
                <label class="oe-es-f"><span><?php esc_html_e('Internal notes (never published)', 'october-events'); ?></span>
                    <textarea name="oe_event[notes]" rows="2"><?php echo esc_textarea($v('notes')); ?></textarea>
                </label>
            </div>

            <div class="oe-es-actions oe-ad-card">
                <label class="oe-es-f"><span><?php esc_html_e('Status', 'october-events'); ?></span>
                    <select name="post_status">
                        <option value="draft" <?php selected($status, 'draft'); ?>><?php esc_html_e('Draft', 'october-events'); ?></option>
                        <option value="pending" <?php selected($status, 'pending'); ?>><?php esc_html_e('Pending review', 'october-events'); ?></option>
                        <option value="publish" <?php selected($status, 'publish'); ?>><?php esc_html_e('Published', 'october-events'); ?></option>
                    </select>
                </label>
                <button type="submit" class="button button-primary button-hero"><?php esc_html_e('Save event', 'october-events'); ?></button>
                <?php if ($id > 0) : ?>
                    <a class="button" href="<?php echo esc_url(get_edit_post_link($id)); ?>"><?php esc_html_e('Advanced edit', 'october-events'); ?></a>
                <?php endif; ?>
            </div>
        </div>

        <div class="oe-es-pane oe-es-right">
            <div class="oe-es-previewbar">
                <span class="oe-section-label" style="margin:0"><?php esc_html_e('Live preview', 'october-events'); ?></span>
                <span class="oe-es-savestate" id="oe-es-savestate"></span>
            </div>
            <div class="oe-es-frame-wrap">
                <?php if ($id > 0 && $preview !== '') : ?>
                    <iframe id="oe-es-frame" src="<?php echo esc_url($preview); ?>" title="<?php esc_attr_e('Event preview', 'october-events'); ?>"></iframe>
                <?php else : ?>
                    <div class="oe-es-frame-empty" id="oe-es-frame-empty">
                        <p><strong><?php esc_html_e('Start typing to see the live preview.', 'october-events'); ?></strong></p>
                        <p class="description"><?php esc_html_e('The preview is the real event page rendered by the plugin, so it matches what visitors see. It appears once the first details are saved as a draft.', 'october-events'); ?></p>
                    </div>
                    <iframe id="oe-es-frame" title="<?php esc_attr_e('Event preview', 'october-events'); ?>" style="display:none"></iframe>
                <?php endif; ?>
            </div>
        </div>
    </form>
</div>

<script>
(function () {
    var form  = document.getElementById('oe-es-form');
    var idEl  = document.getElementById('oe-es-id');
    var frame = document.getElementById('oe-es-frame');
    var empty = document.getElementById('oe-es-frame-empty');
    var state = document.getElementById('oe-es-savestate');
    var ajaxUrl = <?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>;
    var nonce   = <?php echo wp_json_encode(wp_create_nonce('oe_event_studio_autosave')); ?>;
    var timer = null, inflight = false, pending = false;

    // Media picker (featured image).
    (function () {
        var pick = document.getElementById('oe-es-img-pick'),
            clear = document.getElementById('oe-es-img-clear'),
            wrap = document.getElementById('oe-es-img'),
            img = wrap ? wrap.querySelector('img') : null,
            hid = document.getElementById('oe-es-img-id'), fr;
        if (!pick || !window.wp || !wp.media) { return; }
        pick.addEventListener('click', function (e) {
            e.preventDefault();
            fr = fr || wp.media({ title: 'Select image', multiple: false });
            fr.off('select').on('select', function () {
                var a = fr.state().get('selection').first().toJSON();
                hid.value = a.id;
                if (img) { img.src = (a.sizes && a.sizes.medium ? a.sizes.medium.url : a.url); img.style.display = ''; }
                if (clear) { clear.style.display = ''; }
                schedule();
            });
            fr.open();
        });
        if (clear) { clear.addEventListener('click', function (e) { e.preventDefault(); hid.value = ''; if (img) { img.src = ''; img.style.display = 'none'; } clear.style.display = 'none'; schedule(); }); }
    })();

    function schedule() {
        if (state) { state.textContent = <?php echo wp_json_encode(__('Editing…', 'october-events')); ?>; }
        clearTimeout(timer);
        timer = setTimeout(save, 900);
    }

    function save() {
        if (inflight) { pending = true; return; }
        inflight = true;
        if (state) { state.textContent = <?php echo wp_json_encode(__('Saving…', 'october-events')); ?>; }
        var data = new FormData(form);
        data.set('action', 'oe_event_studio_autosave');
        data.set('nonce', nonce);
        fetch(ajaxUrl, { method: 'POST', credentials: 'same-origin', body: data })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                inflight = false;
                if (!res || !res.success) {
                    if (state) { state.textContent = (res && res.data && res.data.message) ? res.data.message : <?php echo wp_json_encode(__('Save failed', 'october-events')); ?>; }
                    return;
                }
                if (res.data.id && idEl) { idEl.value = res.data.id; }
                if (res.data.preview && frame) {
                    if (empty) { empty.style.display = 'none'; }
                    frame.style.display = '';
                    frame.src = res.data.preview + (res.data.preview.indexOf('?') === -1 ? '?' : '&') + 'oe_ts=' + Date.now();
                }
                if (state) { state.textContent = <?php echo wp_json_encode(__('Saved', 'october-events')); ?>; }
                if (pending) { pending = false; schedule(); }
            })
            .catch(function () { inflight = false; if (state) { state.textContent = <?php echo wp_json_encode(__('Save failed', 'october-events')); ?>; } });
    }

    form.querySelectorAll('[data-live]').forEach(function (el) {
        el.addEventListener('input', schedule);
        el.addEventListener('change', schedule);
    });
})();
</script>
