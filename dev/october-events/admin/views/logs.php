<?php
/**
 * Logs screen (Admin hub) — audit trail + debug log reader.
 *
 * @var string              $view          'audit' | 'error'
 * @var string              $action        active audit action filter ('' = all)
 * @var int                 $paged         current audit page (1-based)
 * @var array<int,string>   $audit_actions distinct actions for the filter
 * @var int                 $audit_total   total audit rows for the filter
 * @var int                 $audit_pages   audit page count
 * @var array<int,object>   $audit_rows    audit rows for this page
 * @var bool                $err_enabled   WP_DEBUG on?
 * @var int                 $err_size      debug log size in bytes
 * @var array<int,string>   $err_lines     tail of the debug log (file order)
 * @var string              $err_path      absolute debug log path
 * @var bool                $cleared       just cleared the debug log?
 */
defined('ABSPATH') || exit;

$base = admin_url('admin.php?page=oe-logs');
?>
<div class="wrap oe-admin oe-logs">
    <?php \OE\Admin\Admin::hub_tabs('admin', 'logs'); ?>

    <p class="oe-seg">
        <a class="oe-seg-btn<?php echo $view === 'audit' ? ' is-on' : ''; ?>" href="<?php echo esc_url($base); ?>"><?php esc_html_e('Audit trail', 'october-events'); ?></a>
        <a class="oe-seg-btn<?php echo $view === 'error' ? ' is-on' : ''; ?>" href="<?php echo esc_url(add_query_arg('view', 'error', $base)); ?>"><?php esc_html_e('Error log', 'october-events'); ?></a>
    </p>

    <?php if ($view === 'audit') : ?>

        <div class="oe-ad-card" style="margin-bottom:14px;">
            <p style="margin:0 0 10px;"><?php esc_html_e('Every approval, refund, auto-approve and connector action, newest first. The trail is append-only.', 'october-events'); ?></p>
            <form method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input type="hidden" name="page" value="oe-logs">
                <label><?php esc_html_e('Action', 'october-events'); ?>
                    <select name="act" onchange="this.form.submit()">
                        <option value="" <?php selected($action, ''); ?>><?php esc_html_e('All actions', 'october-events'); ?></option>
                        <?php foreach ($audit_actions as $a) : ?>
                            <option value="<?php echo esc_attr($a); ?>" <?php selected($action, $a); ?>><?php echo esc_html($a); ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <span class="description"><?php echo esc_html(sprintf(_n('%s entry', '%s entries', $audit_total, 'october-events'), number_format_i18n($audit_total))); ?></span>
            </form>
        </div>

        <?php if (! $audit_rows) : ?>
            <div class="oe-ad-card"><strong><?php esc_html_e('Nothing logged yet.', 'october-events'); ?></strong><br>
                <span class="description"><?php esc_html_e('Entries appear here as approvals, refunds and connector activity happen.', 'october-events'); ?></span>
            </div>
        <?php else : ?>
        <div class="oe-ad-card" style="padding:0;">
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('When', 'october-events'); ?></th>
                    <th><?php esc_html_e('Who', 'october-events'); ?></th>
                    <th><?php esc_html_e('Action', 'october-events'); ?></th>
                    <th><?php esc_html_e('Object', 'october-events'); ?></th>
                    <th><?php esc_html_e('Detail', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($audit_rows as $r) :
                    $actor = (int) ($r->actor_id ?? 0);
                    $who   = $actor ? get_userdata($actor) : null;
                    $who_s = $who ? $who->display_name : ($actor ? '#' . $actor : __('system', 'october-events'));
                    $obj   = '';
                    if (! empty($r->object_id)) {
                        $obj = ($r->object_type ? (string) $r->object_type . ' ' : '') . '#' . (int) $r->object_id;
                    }
                    $when = $r->created_at ? get_date_from_gmt((string) $r->created_at, 'Y-m-d H:i') : '';
                ?>
                    <tr>
                        <td style="white-space:nowrap;"><?php echo esc_html($when); ?></td>
                        <td><?php echo esc_html($who_s); ?></td>
                        <td><code><?php echo esc_html((string) $r->action); ?></code></td>
                        <td><span class="description"><?php echo esc_html($obj ?: '—'); ?></span></td>
                        <td><?php echo esc_html((string) ($r->detail ?? '')); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
            <?php if ($audit_pages > 1) : ?>
                <p class="oe-logs-pager" style="display:flex;gap:8px;align-items:center;margin-top:12px;">
                    <?php
                    $pager_base = add_query_arg(array_filter(['act' => $action]), $base);
                    if ($paged > 1) :
                        ?><a class="button button-small" href="<?php echo esc_url(add_query_arg('paged', $paged - 1, $pager_base)); ?>">&larr; <?php esc_html_e('Newer', 'october-events'); ?></a><?php
                    endif; ?>
                    <span class="description"><?php echo esc_html(sprintf(__('Page %1$d of %2$d', 'october-events'), $paged, $audit_pages)); ?></span>
                    <?php if ($paged < $audit_pages) : ?>
                        <a class="button button-small" href="<?php echo esc_url(add_query_arg('paged', $paged + 1, $pager_base)); ?>"><?php esc_html_e('Older', 'october-events'); ?> &rarr;</a>
                    <?php endif; ?>
                </p>
            <?php endif; ?>
        <?php endif; ?>

    <?php else : // error log ?>

        <?php if ($cleared) : ?>
            <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Debug log cleared.', 'october-events'); ?></p></div>
        <?php endif; ?>

        <div class="oe-ad-card" style="margin-bottom:14px;">
            <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
                <p style="margin:0;max-width:640px;">
                    <?php
                    echo esc_html(sprintf(
                        /* translators: %s: log file path relative to wp-content */
                        __('The plugin writes diagnostics to %s, and only while WP_DEBUG is on. Secrets and long payloads are redacted before writing.', 'october-events'),
                        'wp-content/oe-debug.log'
                    ));
                    ?>
                </p>
                <?php if ($err_size > 0) : ?>
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('<?php echo esc_js(__('Clear the debug log?', 'october-events')); ?>');">
                        <input type="hidden" name="action" value="oe_logs_clear">
                        <?php wp_nonce_field('oe_logs_clear'); ?>
                        <button type="submit" class="button button-small"><?php esc_html_e('Clear log', 'october-events'); ?></button>
                    </form>
                <?php endif; ?>
            </div>
            <?php if (! $err_enabled) : ?>
                <p class="oe-ad-note" style="margin:10px 0 0;"><?php esc_html_e('WP_DEBUG is off, so nothing new is being written. Turn it on in wp-config.php to capture diagnostics.', 'october-events'); ?></p>
            <?php endif; ?>
        </div>

        <?php if (! $err_lines) : ?>
            <div class="oe-ad-card"><strong><?php esc_html_e('The debug log is empty.', 'october-events'); ?></strong><br>
                <span class="description"><?php esc_html_e('Lines appear here when the plugin logs a diagnostic and WP_DEBUG is on.', 'october-events'); ?></span>
            </div>
        <?php else : ?>
            <div class="oe-ad-card" style="padding:0;">
                <pre class="oe-logs-pre" style="margin:0;padding:14px 16px;max-height:62vh;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;"><?php
                    echo esc_html(implode("\n", $err_lines));
                ?></pre>
            </div>
            <p class="oe-ad-note"><?php echo esc_html(sprintf(__('Showing the last %d lines.', 'october-events'), count($err_lines))); ?></p>
        <?php endif; ?>

    <?php endif; ?>
</div>
