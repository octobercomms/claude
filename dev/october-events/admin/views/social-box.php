<?php
/**
 * Event "Social" metabox: parties (name + Instagram handle) and five captions.
 *
 * @var \WP_Post $post
 * @var array    $parties   [['name'=>, 'handle'=>], …] (at least one row)
 * @var array    $captions  up to five stored caption strings
 * @var bool     $ready     whether the Claude API key is configured
 */

defined('ABSPATH') || exit;
?>
<div class="oe-social" id="oe-social" data-post="<?php echo (int) $post->ID; ?>">

    <p style="margin:0 0 6px"><strong><?php esc_html_e('Parties & tags', 'october-events'); ?></strong>
        <span class="description"><?php esc_html_e('Everyone to credit or tag — practices, sponsors, designers, venues. The Instagram handle is woven into the captions (and used later for tagging).', 'october-events'); ?></span></p>

    <table class="oe-social-parties" style="border-collapse:collapse;margin:0 0 6px">
        <tbody id="oe-sp-rows">
            <?php foreach ($parties as $p) : ?>
                <tr class="oe-sp-row">
                    <td style="padding:2px 6px 2px 0"><input type="text" name="oe_sp_name[]" value="<?php echo esc_attr((string) ($p['name'] ?? '')); ?>" placeholder="<?php esc_attr_e('Name', 'october-events'); ?>" class="regular-text" style="width:220px"></td>
                    <td style="padding:2px 6px">
                        <span style="color:#787c82">@</span><input type="text" name="oe_sp_handle[]" value="<?php echo esc_attr((string) ($p['handle'] ?? '')); ?>" placeholder="<?php esc_attr_e('instagram_handle', 'october-events'); ?>" style="width:200px" spellcheck="false" autocapitalize="none">
                    </td>
                    <td style="padding:2px 0"><button type="button" class="button-link oe-sp-del" style="color:#b32d2e" aria-label="<?php esc_attr_e('Remove', 'october-events'); ?>">✕</button></td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
    <p style="margin:0 0 16px"><button type="button" class="button" id="oe-sp-add">+ <?php esc_html_e('Add party', 'october-events'); ?></button></p>

    <p style="margin:0 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <strong><?php esc_html_e('Captions', 'october-events'); ?></strong>
        <?php if ($ready) : ?>
            <button type="button" class="button button-secondary" id="oe-social-gen"><?php echo $captions ? esc_html__('Regenerate 5 captions', 'october-events') : esc_html__('Generate 5 captions', 'october-events'); ?></button>
            <span id="oe-social-msg" class="description" style="font-weight:600"></span>
        <?php else : ?>
            <span class="description"><?php esc_html_e('Add your Claude API key under Settings → Keys & platform to generate captions.', 'october-events'); ?></span>
        <?php endif; ?>
    </p>
    <p class="description" style="margin:0 0 8px"><?php esc_html_e('Five captions in the house voice. Generated automatically the first time you publish; edit any of them here, or regenerate. They save when you update the event.', 'october-events'); ?></p>

    <div id="oe-cap-list">
        <?php for ($i = 0; $i < 5; $i++) :
            $val = (string) ($captions[$i] ?? ''); ?>
            <div class="oe-cap" style="margin:0 0 10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 2px">
                    <label style="font-weight:600;color:#50575e"><?php echo esc_html(sprintf(__('Caption %d', 'october-events'), $i + 1)); ?></label>
                    <button type="button" class="button-link oe-cap-copy" style="text-decoration:none"><?php esc_html_e('Copy', 'october-events'); ?></button>
                </div>
                <textarea name="oe_cap[]" rows="3" class="large-text oe-cap-text" style="width:100%"><?php echo esc_textarea($val); ?></textarea>
            </div>
        <?php endfor; ?>
    </div>

    <?php
    // ---- Image suite ----------------------------------------------------
    $thumb  = get_the_post_thumbnail_url($post, 'full') ?: '';
    $ts     = \OE\Ticketing\Ics::start_ts($post->ID);
    $when   = $ts ? wp_date('j M Y', $ts) : '';
    $accent = (string) \OE\Settings::get('theme_accent', '') ?: '#E7CD41';
    $acc_on = (string) \OE\Settings::get('theme_accent_on', '') ?: '#1a1a1a';
    ?>
    <hr style="margin:18px 0">
    <p style="margin:0 0 4px"><strong><?php esc_html_e('Image suite', 'october-events'); ?></strong>
        <span class="description"><?php esc_html_e('Branded graphics for each platform, built from the event’s featured image — Instagram square, portrait and story, plus Facebook / LinkedIn.', 'october-events'); ?></span></p>
    <?php if ($thumb === '') : ?>
        <p class="description" style="margin:2px 0 0"><?php esc_html_e('Set a featured image on this event (and save) to build the suite.', 'october-events'); ?></p>
    <?php else : ?>
        <div id="oe-imgsuite"
            data-img="<?php echo esc_url($thumb); ?>"
            data-title="<?php echo esc_attr(get_the_title($post)); ?>"
            data-date="<?php echo esc_attr($when); ?>"
            data-accent="<?php echo esc_attr($accent); ?>"
            data-accent-on="<?php echo esc_attr($acc_on); ?>"
            data-site="<?php echo esc_attr(get_bloginfo('name')); ?>">
            <p style="margin:6px 0"><button type="button" class="button" id="oe-imgsuite-build"><?php esc_html_e('Build image suite', 'october-events'); ?></button>
                <span id="oe-imgsuite-msg" class="description" style="margin-left:8px;font-weight:600"></span></p>
            <div id="oe-imgsuite-out" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>
        </div>
        <style>
            #oe-imgsuite-out .oe-imgsuite-item { border:1px solid #dcdcde; border-radius:8px; padding:8px; background:#f6f7f7; text-align:center }
            #oe-imgsuite-out .oe-imgsuite-prev { width:100%; height:auto; background:#fff; border-radius:4px; display:block }
            #oe-imgsuite-out .oe-imgsuite-cap { font-size:11px; color:#50575e; margin:6px 0 6px }
            #oe-imgsuite-out .oe-imgsuite-dl { text-decoration:none }
        </style>
    <?php endif; ?>

    <?php
    // ---- Schedule to social ---------------------------------------------
    $meta_on  = \OE\Connectors\MetaConnector::is_ready();
    $meta_ig  = $meta_on && \OE\Connectors\MetaConnector::connection()['ig_user_id'] !== '';
    $li_on    = \OE\Connectors\LinkedInConnector::is_ready();
    $any_on   = $meta_on || $li_on;
    $first_cap = (string) ($captions[0] ?? '');
    ?>
    <hr style="margin:18px 0">
    <p style="margin:0 0 4px"><strong><?php esc_html_e('Schedule to social', 'october-events'); ?></strong>
        <span class="description"><?php esc_html_e('Post a caption + the featured image to Meta and LinkedIn at a set time.', 'october-events'); ?></span></p>
    <?php if (! $any_on) : ?>
        <p class="description" style="margin:2px 0 0"><?php printf(
            /* translators: %s: settings link */
            esc_html__('No network is connected yet. Connect Facebook/Instagram and LinkedIn under %s, then schedule from here.', 'october-events'),
            '<a href="' . esc_url(admin_url('admin.php?page=oe-settings#social')) . '">' . esc_html__('Settings → Social publishing', 'october-events') . '</a>'
        ); ?></p>
    <?php else : ?>
        <div id="oe-social-sched" data-post="<?php echo (int) $post->ID; ?>" data-nonce="<?php echo esc_attr(wp_create_nonce('oe_social_schedule')); ?>">
            <p style="margin:6px 0 2px">
                <?php if ($meta_ig) : ?><label style="margin-right:12px"><input type="checkbox" class="oe-net" value="instagram"> <?php esc_html_e('Instagram', 'october-events'); ?></label><?php endif; ?>
                <?php if ($meta_on) : ?><label style="margin-right:12px"><input type="checkbox" class="oe-net" value="facebook"> <?php esc_html_e('Facebook', 'october-events'); ?></label><?php endif; ?>
                <?php if ($li_on) : ?><label><input type="checkbox" class="oe-net" value="linkedin"> <?php esc_html_e('LinkedIn', 'october-events'); ?></label><?php endif; ?>
            </p>
            <p style="margin:6px 0"><textarea id="oe-social-cap" rows="3" class="large-text" placeholder="<?php esc_attr_e('Caption to post…', 'october-events'); ?>"><?php echo esc_textarea($first_cap); ?></textarea></p>
            <p style="margin:6px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <label><?php esc_html_e('When', 'october-events'); ?> <input type="datetime-local" id="oe-social-when"></label>
                <button type="button" class="button button-primary" id="oe-social-do"><?php esc_html_e('Schedule post', 'october-events'); ?></button>
                <span id="oe-social-schmsg" class="description" style="font-weight:600"></span>
            </p>
            <p class="description" style="margin:0 0 4px"><?php esc_html_e('Posts the event’s featured image. Instagram and Facebook go out together via Meta.', 'october-events'); ?></p>
            <div id="oe-social-rows"><?php echo \OE\Social\Scheduler::rows_html($post->ID); // phpcs: built with esc_* ?></div>
        </div>
    <?php endif; ?>

    <script>
    (function () {
        var box = document.getElementById('oe-social');
        if (!box) { return; }
        var NONCE = <?php echo wp_json_encode(wp_create_nonce('oe_social_generate')); ?>;
        var POST = box.getAttribute('data-post');

        // Add / remove party rows.
        var rows = document.getElementById('oe-sp-rows');
        document.getElementById('oe-sp-add').addEventListener('click', function () {
            var r = rows.querySelector('.oe-sp-row');
            var clone = r.cloneNode(true);
            clone.querySelectorAll('input').forEach(function (inp) { inp.value = ''; });
            rows.appendChild(clone);
        });
        rows.addEventListener('click', function (e) {
            if (!e.target.classList.contains('oe-sp-del')) { return; }
            if (rows.querySelectorAll('.oe-sp-row').length > 1) { e.target.closest('.oe-sp-row').remove(); }
            else { e.target.closest('.oe-sp-row').querySelectorAll('input').forEach(function (i) { i.value = ''; }); }
        });

        // Copy a caption.
        box.querySelectorAll('.oe-cap-copy').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var ta = btn.closest('.oe-cap').querySelector('.oe-cap-text');
                ta.select();
                try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); }
                var old = btn.textContent; btn.textContent = <?php echo wp_json_encode(__('Copied', 'october-events')); ?>;
                setTimeout(function () { btn.textContent = old; }, 1200);
            });
        });

        // Generate / regenerate via AJAX, filling the boxes for review.
        var gen = document.getElementById('oe-social-gen');
        if (gen) {
            gen.addEventListener('click', function () {
                var msg = document.getElementById('oe-social-msg');
                gen.disabled = true; msg.style.color = '#50575e'; msg.textContent = <?php echo wp_json_encode(__('Writing…', 'october-events')); ?>;
                var body = new URLSearchParams();
                body.append('action', 'oe_social_generate');
                body.append('nonce', NONCE);
                body.append('post_id', POST);
                rows.querySelectorAll('.oe-sp-row').forEach(function (r) {
                    body.append('names[]', r.querySelector('input[name="oe_sp_name[]"]').value);
                    body.append('handles[]', r.querySelector('input[name="oe_sp_handle[]"]').value);
                });
                fetch(ajaxurl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        gen.disabled = false;
                        if (j && j.success && j.data.captions) {
                            var texts = box.querySelectorAll('.oe-cap-text');
                            texts.forEach(function (ta, i) { ta.value = j.data.captions[i] || ''; });
                            msg.style.color = '#1a7f37'; msg.textContent = <?php echo wp_json_encode(__('Done — review, then update the event to save.', 'october-events')); ?>;
                        } else {
                            msg.style.color = '#b32d2e'; msg.textContent = (j && j.data && j.data.message) || 'Error';
                        }
                    })
                    .catch(function () { gen.disabled = false; msg.style.color = '#b32d2e'; msg.textContent = 'Error'; });
            });
        }

        // Schedule to social (AJAX; the metabox can't nest a form).
        var sched = document.getElementById('oe-social-sched');
        if (sched) {
            var SNONCE = sched.getAttribute('data-nonce');
            var SPOST = sched.getAttribute('data-post');
            var rowsBox = document.getElementById('oe-social-rows');
            var schmsg = document.getElementById('oe-social-schmsg');

            document.getElementById('oe-social-do').addEventListener('click', function () {
                var nets = Array.prototype.map.call(sched.querySelectorAll('.oe-net:checked'), function (c) { return c.value; });
                var cap = document.getElementById('oe-social-cap').value;
                var when = document.getElementById('oe-social-when').value;
                schmsg.style.color = '#50575e'; schmsg.textContent = <?php echo wp_json_encode(__('Scheduling…', 'october-events')); ?>;
                var body = new URLSearchParams();
                body.append('action', 'oe_social_schedule');
                body.append('nonce', SNONCE);
                body.append('event_id', SPOST);
                body.append('caption', cap);
                body.append('when', when);
                nets.forEach(function (n) { body.append('networks[]', n); });
                fetch(ajaxurl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                    .then(function (r) { return r.json(); })
                    .then(function (j) {
                        if (j && j.success) { rowsBox.innerHTML = j.data.rows; schmsg.style.color = '#1a7f37'; schmsg.textContent = <?php echo wp_json_encode(__('Scheduled.', 'october-events')); ?>; }
                        else { schmsg.style.color = '#b32d2e'; schmsg.textContent = (j && j.data && j.data.message) || 'Error'; }
                    })
                    .catch(function () { schmsg.style.color = '#b32d2e'; schmsg.textContent = 'Error'; });
            });

            rowsBox.addEventListener('click', function (e) {
                var btn = e.target.closest('.oe-social-cancel');
                if (!btn) { return; }
                var body = new URLSearchParams();
                body.append('action', 'oe_social_cancel');
                body.append('nonce', btn.getAttribute('data-nonce'));
                body.append('id', btn.getAttribute('data-id'));
                fetch(ajaxurl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                    .then(function (r) { return r.json(); })
                    .then(function (j) { if (j && j.success) { rowsBox.innerHTML = j.data.rows; } });
            });
        }
    })();
    </script>
</div>
