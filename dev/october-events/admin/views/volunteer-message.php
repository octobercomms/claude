<?php
/**
 * Volunteer message blast — tick opportunities, write an email or SMS with
 * [merge] tags, send to their active volunteers.
 *
 * @var array<int,array{id:int,title:string,confirmed:int,pending:int}> $compose_opps
 * @var bool                       $sms_ready
 * @var array<string,string>       $merge_tags   tag => description
 * @var array<string,mixed>|false  $sent_notice
 */
defined('ABSPATH') || exit;

$dash_url = admin_url('admin.php?page=oe-volunteers');
?>
<div class="wrap oe-admin oe-vol">
    <h1><?php esc_html_e('Message volunteers', 'october-events'); ?>
        <a href="<?php echo esc_url($dash_url); ?>" class="page-title-action"><?php esc_html_e('← Back to volunteers', 'october-events'); ?></a>
    </h1>

    <?php if (is_array($sent_notice)) : ?>
        <?php if (! empty($sent_notice['error'])) : ?>
            <div class="notice notice-error inline" style="margin:8px 0"><p><?php echo esc_html((string) $sent_notice['error']); ?></p></div>
        <?php else : ?>
            <div class="notice notice-success inline" style="margin:8px 0"><p><?php
                echo esc_html(sprintf(
                    /* translators: 1: channel, 2: sent, 3: skipped, 4: failed */
                    __('Sent %2$d %1$s message(s). Skipped %3$d (no address/number). Failed %4$d.', 'october-events'),
                    (string) $sent_notice['channel'],
                    (int) $sent_notice['sent'],
                    (int) $sent_notice['skipped'],
                    (int) $sent_notice['failed']
                ));
            ?></p></div>
        <?php endif; ?>
    <?php endif; ?>

    <?php if (! $compose_opps) : ?>
        <p><?php esc_html_e('No opportunities with shifts yet.', 'october-events'); ?></p>
        </div>
        <?php return; ?>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" id="oe-blast-form">
        <input type="hidden" name="action" value="oe_volunteer_blast">
        <?php wp_nonce_field('oe_volunteer_blast'); ?>

        <div class="oe-panel">
            <h3><?php esc_html_e('1. Channel', 'october-events'); ?></h3>
            <p>
                <label style="margin-right:18px"><input type="radio" name="channel" value="email" checked> <?php esc_html_e('Email', 'october-events'); ?></label>
                <label><input type="radio" name="channel" value="sms" <?php disabled(! $sms_ready); ?>> <?php esc_html_e('SMS', 'october-events'); ?></label>
                <?php if (! $sms_ready) : ?>
                    <span class="description" style="margin-left:8px">— <?php echo wp_kses_post(sprintf(
                        /* translators: %s settings link */
                        __('SMS isn’t set up yet. Configure it under %s to enable.', 'october-events'),
                        '<a href="' . esc_url(admin_url('admin.php?page=oe-settings#sms')) . '">' . esc_html__('Settings → Email & SMS', 'october-events') . '</a>'
                    )); ?></span>
                <?php endif; ?>
            </p>
        </div>

        <div class="oe-panel">
            <h3><?php esc_html_e('2. Who gets it', 'october-events'); ?></h3>
            <p class="description"><?php esc_html_e('Tick the opportunities to message, and which signup statuses to include.', 'october-events'); ?></p>
            <p>
                <strong><?php esc_html_e('Statuses:', 'october-events'); ?></strong>
                <label style="margin:0 14px 0 6px"><input type="checkbox" name="statuses[]" value="confirmed" checked> <?php esc_html_e('Confirmed', 'october-events'); ?></label>
                <label><input type="checkbox" name="statuses[]" value="pending" checked> <?php esc_html_e('Pending', 'october-events'); ?></label>
            </p>
            <p>
                <label><a href="#" id="oe-blast-all"><?php esc_html_e('Select all', 'october-events'); ?></a> · <a href="#" id="oe-blast-none"><?php esc_html_e('none', 'october-events'); ?></a></label>
            </p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:8px">
            <?php foreach ($compose_opps as $o) : ?>
                <label style="display:flex;gap:8px;align-items:baseline;padding:8px 10px;border:1px solid var(--oe-line,#e3e2db);border-radius:8px">
                    <input type="checkbox" class="oe-blast-opp" name="opps[]" value="<?php echo (int) $o['id']; ?>">
                    <span>
                        <strong><?php echo esc_html($o['title']); ?></strong><br>
                        <span class="description"><?php echo esc_html(sprintf(__('%1$d confirmed · %2$d pending', 'october-events'), (int) $o['confirmed'], (int) $o['pending'])); ?></span>
                    </span>
                </label>
            <?php endforeach; ?>
            </div>
        </div>

        <div class="oe-panel">
            <h3><?php esc_html_e('3. Your message', 'october-events'); ?></h3>
            <p class="oe-blast-subject"><label><strong><?php esc_html_e('Subject', 'october-events'); ?></strong><br>
                <input type="text" name="subject" class="large-text" placeholder="<?php esc_attr_e('e.g. Your Atlanta Design Festival shift', 'october-events'); ?>"></label></p>
            <p><label><strong><?php esc_html_e('Message', 'october-events'); ?></strong><br>
                <textarea name="body" rows="8" class="large-text" placeholder="<?php esc_attr_e('We are looking forward to you volunteering as [volunteer-type] at [event-location]…', 'october-events'); ?>"></textarea></label></p>
            <p class="description oe-blast-smsnote" hidden><?php esc_html_e('SMS is plain text and short — keep it brief (long texts split into several messages). No subject is used.', 'october-events'); ?></p>
            <p class="description">
                <strong><?php esc_html_e('Merge tags', 'october-events'); ?>:</strong>
                <?php $bits = [];
                foreach ($merge_tags as $tag => $desc) { $bits[] = '<code>[' . esc_html($tag) . ']</code> — ' . esc_html($desc); }
                echo wp_kses_post(implode(' &nbsp;·&nbsp; ', $bits)); ?>
            </p>
        </div>

        <p>
            <button type="submit" class="button button-primary button-hero" onclick="return confirm('<?php echo esc_js(__('Send this message to the volunteers of the selected opportunities?', 'october-events')); ?>');"><?php esc_html_e('Send blast', 'october-events'); ?></button>
        </p>
    </form>
</div>
<script>
(function(){
    var form = document.getElementById('oe-blast-form');
    if (!form) { return; }
    function onChannel(){
        var sms = form.querySelector('input[name="channel"]:checked').value === 'sms';
        form.querySelectorAll('.oe-blast-subject').forEach(function(el){ el.hidden = sms; });
        form.querySelectorAll('.oe-blast-smsnote').forEach(function(el){ el.hidden = !sms; });
    }
    form.querySelectorAll('input[name="channel"]').forEach(function(r){ r.addEventListener('change', onChannel); });
    onChannel();
    var all = document.getElementById('oe-blast-all'), none = document.getElementById('oe-blast-none');
    function setAll(v){ return function(e){ e.preventDefault(); form.querySelectorAll('.oe-blast-opp').forEach(function(c){ c.checked = v; }); }; }
    if (all) { all.addEventListener('click', setAll(true)); }
    if (none) { none.addEventListener('click', setAll(false)); }
})();
</script>
