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
use OE\Packs\Registry;
use OE\Packs\SectionReference;
use OE\Packs\Content\TourMeta;
use OE\Admin\SlideIn;

$packs_state = Registry::all_for($id);
$site_name   = (string) get_bloginfo('name');

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
// Normalize a stored date value (bare "Y-m-d H:i", a "T" variant, or a unix
// timestamp) into the <input type="datetime-local"> format.
$dtl = static function (string $val): string {
    $val = trim($val);
    if ($val === '') {
        return '';
    }
    if (preg_match('/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/', $val, $m)) {
        return $m[1] . 'T' . $m[2];
    }
    if (ctype_digit($val)) {
        return wp_date('Y-m-d\TH:i', (int) $val);
    }
    $ts = strtotime($val);
    return $ts ? gmdate('Y-m-d\TH:i', $ts) : '';
};
$tl = static function (string $val): string {
    $val = trim($val);
    if ($val === '') {
        return '';
    }
    if (preg_match('/^\d{1,2}:\d{2}$/', $val)) {
        return substr('0' . $val, -5);
    }
    $ts = strtotime($val);
    return $ts ? gmdate('H:i', $ts) : '';
};
$reg_mode = $v('ticket_required') !== '1' ? 'none' : ($v('ticket_link') !== '' ? 'external' : 'native');
?>
<div class="wrap oe-admin oe-es">
    <h1 class="oe-es-h1">
        <span><?php echo $id > 0 ? esc_html__('Edit event', 'october-events') : esc_html__('New event', 'october-events'); ?></span>
        <span class="oe-es-h1-actions">
            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-events')); ?>">&larr; <?php esc_html_e('All events', 'october-events'); ?></a>
            <button type="submit" form="oe-es-form" class="button button-primary"><?php esc_html_e('Save event', 'october-events'); ?></button>
        </span>
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
                $field('organiser', __('Organizer', 'october-events'), $v('organiser'), 'text', $site_name !== '' ? sprintf(__('e.g. %s', 'october-events'), $site_name) : __('e.g. Acme Design Studio', 'october-events'));
                ?>
                <label class="oe-es-f"><span><?php esc_html_e('Description', 'october-events'); ?></span></label>
                <div class="oe-es-wysiwyg">
                    <?php
                    wp_editor($v('description'), 'oe_event_description', [
                        'textarea_name' => 'oe_event[description]',
                        'media_buttons' => false,
                        'textarea_rows' => 8,
                        'teeny'         => false,
                        'quicktags'     => true,
                    ]);
                    ?>
                </div>
                <div class="oe-es-row">
                    <label class="oe-es-f"><span><?php esc_html_e('Start', 'october-events'); ?></span><input type="datetime-local" name="oe_event[start_datetime]" value="<?php echo esc_attr($dtl($v('start_datetime'))); ?>" data-live></label>
                    <label class="oe-es-f"><span><?php esc_html_e('End', 'october-events'); ?></span><input type="datetime-local" name="oe_event[end_datetime]" value="<?php echo esc_attr($dtl($v('end_datetime'))); ?>" data-live></label>
                </div>
                <div class="oe-es-row">
                    <label class="oe-es-f"><span><?php esc_html_e('Daily start (optional)', 'october-events'); ?></span><input type="time" name="oe_event[start_time]" value="<?php echo esc_attr($tl($v('start_time'))); ?>" data-live></label>
                    <label class="oe-es-f"><span><?php esc_html_e('Daily end (optional)', 'october-events'); ?></span><input type="time" name="oe_event[end_time]" value="<?php echo esc_attr($tl($v('end_time'))); ?>" data-live></label>
                </div>
                <div class="oe-es-row">
                    <?php
                    $field('location', __('Location', 'october-events'), $v('location'), 'text', 'e.g. Pullman Yards, Atlanta GA');
                    $field('price', __('Display price', 'october-events'), $v('price'), 'text', 'e.g. Free, $45, From $10');
                    ?>
                </div>

                <div class="oe-section-label" style="margin-top:14px"><?php esc_html_e('Availability & status', 'october-events'); ?></div>
                <div class="oe-es-row">
                    <label class="oe-es-f"><span><?php esc_html_e('Availability', 'october-events'); ?></span>
                        <select name="oe_event[availability]" data-live>
                            <option value=""><?php esc_html_e('Not specified', 'october-events'); ?></option>
                            <?php foreach (Events::AVAILABILITY as $k => $lbl) : ?>
                                <option value="<?php echo esc_attr($k); ?>" <?php selected($v('availability'), $k); ?>><?php echo esc_html($lbl); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                    <label class="oe-es-f"><span><?php esc_html_e('Status badge (exceptions only)', 'october-events'); ?></span>
                        <select name="oe_event[status_preset]" id="oe-es-statuspreset" data-live>
                            <option value=""><?php esc_html_e('None (routine)', 'october-events'); ?></option>
                            <?php foreach (Events::STATUS_PRESETS as $k => $preset) : ?>
                                <option value="<?php echo esc_attr($k); ?>" <?php selected($v('status_preset'), $k); ?>><?php echo esc_html($preset[0]); ?></option>
                            <?php endforeach; ?>
                        </select>
                    </label>
                </div>
                <p class="oe-es-statusbtns">
                    <button type="button" class="button button-small" data-set-preset="rescheduled"><?php esc_html_e('Reschedule…', 'october-events'); ?></button>
                    <button type="button" class="button button-small" data-set-preset="cancelled"><?php esc_html_e('Cancel event…', 'october-events'); ?></button>
                </p>
            </div>

            <div class="oe-ad-card">
                <div class="oe-section-label"><?php esc_html_e('Registration', 'october-events'); ?></div>
                <input type="hidden" name="oe_event[ticket_required]" id="oe-es-ticketreq" value="<?php echo $v('ticket_required') === '1' ? '1' : ''; ?>">
                <div class="oe-es-seg" role="radiogroup">
                    <label><input type="radio" name="oe_reg_mode" value="none" data-reg-mode <?php checked($reg_mode, 'none'); ?>> <?php esc_html_e('Free / no ticket', 'october-events'); ?></label>
                    <label><input type="radio" name="oe_reg_mode" value="native" data-reg-mode <?php checked($reg_mode, 'native'); ?>> <?php esc_html_e('Sell on this site', 'october-events'); ?></label>
                    <label><input type="radio" name="oe_reg_mode" value="external" data-reg-mode <?php checked($reg_mode, 'external'); ?>> <?php esc_html_e('External ticket link', 'october-events'); ?></label>
                </div>
                <div class="oe-es-regpane" id="oe-es-reg-native"<?php echo $reg_mode === 'native' ? '' : ' hidden'; ?>>
                    <p class="description" style="margin:10px 0 0"><?php esc_html_e('Attendees buy on this site. Ticket types, prices and capacity are set in the Tickets section (the Tickets capability is switched on for you).', 'october-events'); ?></p>
                </div>
                <div class="oe-es-regpane" id="oe-es-reg-external"<?php echo $reg_mode === 'external' ? '' : ' hidden'; ?>>
                    <div class="oe-es-row" style="margin-top:10px">
                        <label class="oe-es-f"><span><?php esc_html_e('External ticket link', 'october-events'); ?></span><input type="url" name="oe_event[ticket_link]" id="oe-es-ticketlink" value="<?php echo esc_attr($v('ticket_link')); ?>" placeholder="https://…" data-live></label>
                        <label class="oe-es-f"><span><?php esc_html_e('Button text', 'october-events'); ?></span><input type="text" name="oe_event[ticket_link_text]" id="oe-es-ticketlinktext" value="<?php echo esc_attr($v('ticket_link_text')); ?>" placeholder="<?php esc_attr_e('e.g. Book tickets', 'october-events'); ?>" data-live></label>
                    </div>
                </div>
            </div>

            <div class="oe-ad-card">
                <div class="oe-section-label"><?php esc_html_e('Capabilities', 'october-events'); ?></div>
                <p class="description" style="margin:0 0 10px"><?php esc_html_e('Switch on what this event needs. Each one reveals its own fields and its sections on the page.', 'october-events'); ?></p>
                <?php wp_nonce_field('oe_packs_save', 'oe_packs_save'); ?>
                <?php foreach (Registry::PACKS as $pack_id => $pack) : ?>
                    <label class="oe-es-cap">
                        <input type="checkbox" name="oe_packs[<?php echo esc_attr($pack_id); ?>]" value="1" data-live data-pack="<?php echo esc_attr($pack_id); ?>" <?php checked(! empty($packs_state[$pack_id])); ?>>
                        <span class="oe-es-cap-t"><?php echo esc_html($pack['icon']); ?> <strong><?php echo esc_html($pack['label']); ?></strong></span>
                        <span class="oe-es-cap-d description"><?php echo esc_html($pack['desc']); ?></span>
                    </label>
                <?php endforeach; ?>
                <?php if ($id > 0) : ?>
                    <p style="margin:12px 0 0"><?php echo SlideIn::trigger('oe-es-tour', __('Edit locations', 'october-events'), 'button button-small'); ?> <span class="description"><?php esc_html_e('Stops, images and design credits for a multi-location event.', 'october-events'); ?></span></p>
                <?php else : ?>
                    <p class="description" style="margin:12px 0 0"><?php esc_html_e('Locations become editable once the event is saved as a draft.', 'october-events'); ?></p>
                <?php endif; ?>
            </div>

            <details class="oe-ad-card oe-es-secref-acc">
                <summary class="oe-section-label" style="cursor:pointer;margin:0"><?php esc_html_e('Page sections & shortcodes', 'october-events'); ?></summary>
                <div style="margin-top:12px">
                    <?php echo SectionReference::card($id, 'oe-es-secref'); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                </div>
            </details>

            <details class="oe-ad-card oe-es-adv-acc">
                <summary class="oe-section-label" style="cursor:pointer;margin:0"><?php esc_html_e('Media & advanced', 'october-events'); ?></summary>
                <div style="margin-top:12px">
                    <div class="oe-es-media">
                        <span class="oe-es-f-label"><?php esc_html_e('Featured image', 'october-events'); ?></span>
                        <span class="oe-es-img" id="oe-es-img">
                            <img src="<?php echo esc_url($thumb_src); ?>" alt=""<?php echo $thumb_src ? '' : ' style="display:none"'; ?>>
                            <input type="hidden" name="featured_image" id="oe-es-img-id" value="<?php echo (int) ($thumb ?: 0); ?>">
                            <button type="button" class="button" id="oe-es-img-pick"><?php esc_html_e('Choose image', 'october-events'); ?></button>
                            <button type="button" class="button-link" id="oe-es-img-clear"<?php echo $thumb ? '' : ' style="display:none"'; ?>><?php esc_html_e('Remove', 'october-events'); ?></button>
                        </span>
                    </div>
                    <div class="oe-es-row">
                        <?php
                        $field('event_number', __('Reference number', 'october-events'), $v('event_number'), 'text', 'e.g. 013');
                        $field('brand_colour', __('Brand color', 'october-events'), $v('brand_colour'), 'text', '#000000');
                        ?>
                    </div>
                    <p class="description" style="margin:0 0 10px"><?php esc_html_e('Reference number and brand color are optional; a page builder template can display them. The brand color is exposed to Elementor/Gutenberg as a per-event value.', 'october-events'); ?></p>
                    <label class="oe-es-f"><span><?php esc_html_e('Internal notes (never published)', 'october-events'); ?></span>
                        <textarea name="oe_event[notes]" rows="2"><?php echo esc_textarea($v('notes')); ?></textarea>
                    </label>
                </div>
            </details>

            <?php if ($id > 0 && $post instanceof WP_Post) : ?>
                <?php SlideIn::open('oe-es-tour', __('Locations', 'october-events'), false, 'oe-slide-xwide'); ?>
                    <?php TourMeta::render($post); ?>
                <?php SlideIn::close(); ?>
            <?php endif; ?>

            <div class="oe-es-actions oe-ad-card">
                <label class="oe-es-f"><span><?php esc_html_e('Status', 'october-events'); ?></span>
                    <select name="post_status">
                        <option value="draft" <?php selected($status, 'draft'); ?>><?php esc_html_e('Draft', 'october-events'); ?></option>
                        <option value="pending" <?php selected($status, 'pending'); ?>><?php esc_html_e('Pending review', 'october-events'); ?></option>
                        <option value="publish" <?php selected($status, 'publish'); ?>><?php esc_html_e('Published', 'october-events'); ?></option>
                    </select>
                </label>
                <button type="submit" class="button button-primary button-hero"><?php esc_html_e('Save event', 'october-events'); ?></button>
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
        if (window.tinymce) { try { window.tinymce.triggerSave(); } catch (e) {} }
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

    // WYSIWYG description → autosave on edit, and sync into the textarea.
    (function () {
        var tries = 0;
        var iv = setInterval(function () {
            if (window.tinymce) {
                var ed = window.tinymce.get('oe_event_description');
                if (ed) { clearInterval(iv); ed.on('keyup change', schedule); return; }
            }
            if (++tries > 40) { clearInterval(iv); }
        }, 250);
        var ta = document.getElementById('oe_event_description');
        if (ta) { ta.addEventListener('input', schedule); }
    })();

    // Status preset shortcut buttons.
    form.querySelectorAll('[data-set-preset]').forEach(function (b) {
        b.addEventListener('click', function () {
            var sel = document.getElementById('oe-es-statuspreset');
            if (sel) { sel.value = b.getAttribute('data-set-preset'); sel.dispatchEvent(new Event('change', { bubbles: true })); }
        });
    });

    // Registration mode switch.
    (function () {
        var req = document.getElementById('oe-es-ticketreq');
        var npane = document.getElementById('oe-es-reg-native');
        var xpane = document.getElementById('oe-es-reg-external');
        var link = document.getElementById('oe-es-ticketlink');
        var linkText = document.getElementById('oe-es-ticketlinktext');
        function apply(mode, fire) {
            if (req) { req.value = (mode === 'none') ? '' : '1'; }
            if (npane) { npane.hidden = mode !== 'native'; }
            if (xpane) { xpane.hidden = mode !== 'external'; }
            if (mode !== 'external') {
                if (link) { link.value = ''; }
                if (linkText) { linkText.value = ''; }
            }
            if (mode === 'native') {
                var tix = form.querySelector('input[type=checkbox][data-pack="tickets"]');
                if (tix && !tix.checked) { tix.checked = true; tix.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            if (fire) { schedule(); }
        }
        form.querySelectorAll('[data-reg-mode]').forEach(function (r) {
            r.addEventListener('change', function () { if (r.checked) { apply(r.value, true); } });
        });
    })();

    // Live-reflect capability toggles in the section reference card.
    var ON = <?php echo wp_json_encode(__('on', 'october-events')); ?>,
        OFF = <?php echo wp_json_encode(__('off', 'october-events')); ?>;
    function syncSections() {
        form.querySelectorAll('input[type=checkbox][data-pack]').forEach(function (cb) {
            var on = cb.checked;
            form.querySelectorAll('.oe-secref tr[data-pack="' + cb.getAttribute('data-pack') + '"]').forEach(function (tr) {
                tr.classList.toggle('off', !on);
                tr.classList.toggle('onrow', on);
                var st = tr.querySelector('.oe-secref-state .st');
                if (st) { st.className = 'st ' + (on ? 'on' : 'off'); st.textContent = on ? ON : OFF; }
            });
        });
    }
    form.querySelectorAll('input[type=checkbox][data-pack]').forEach(function (cb) {
        cb.addEventListener('change', syncSections);
    });
})();
</script>
