<?php
/**
 * Import / export screen (ADMIN-BUILD AD13).
 *
 * @var string $tab      'export' | 'import'
 * @var string $notice   flash message
 * @var string $token    uploaded-file token (import)
 * @var string $target   import target key
 * @var array  $headers  CSV headers (import)
 * @var array  $map      field => header (import)
 * @var array|null $preview dry-run result
 */
defined('ABSPATH') || exit;
use OE\Porter\Exporter;
use OE\Porter\Importer;

$page = admin_url('admin.php?page=oe-porter');
?>
<div class="wrap oe-admin oe-porter">
    <?php \OE\Admin\Admin::hub_tabs('admin', 'porter'); ?>

    <?php if ($notice !== '') : ?>
        <div class="notice notice-success is-dismissible inline"><p><?php echo esc_html($notice); ?></p></div>
    <?php endif; ?>

    <h2 class="nav-tab-wrapper">
        <a class="nav-tab <?php echo $tab === 'export' ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url($page . '&tab=export'); ?>"><?php esc_html_e('Export', 'october-events'); ?></a>
        <a class="nav-tab <?php echo $tab === 'import' ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url($page . '&tab=import'); ?>"><?php esc_html_e('Import', 'october-events'); ?></a>
    </h2>

    <?php if ($tab === 'export') : ?>
    <div class="oe-ad-card" style="margin-top:16px;">
        <p class="description"><?php esc_html_e('Download any entity as CSV (for spreadsheets) or JSON (for backups and other tools).', 'october-events'); ?></p>
        <form method="get" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-porter-export">
            <input type="hidden" name="action" value="oe_porter_export">
            <?php wp_nonce_field('oe_porter_export'); ?>
            <label class="oe-porter-field"><span><?php esc_html_e('Entity', 'october-events'); ?></span>
                <select name="entity">
                    <?php foreach (Exporter::entities() as $ek => $el) : ?>
                        <option value="<?php echo esc_attr($ek); ?>"><?php echo esc_html($el); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <label class="oe-porter-field"><span><?php esc_html_e('Format', 'october-events'); ?></span>
                <select name="format"><option value="csv">CSV</option><option value="json">JSON</option></select>
            </label>
            <button type="submit" class="button button-primary"><?php esc_html_e('Download', 'october-events'); ?></button>
        </form>
    </div>
    <?php else : // ---- Import ---- ?>

    <?php $spec = Importer::target($target); ?>
    <?php if ($token === '' || ! $spec) : ?>
        <div class="oe-ad-card" style="margin-top:16px;">
            <p class="description"><?php esc_html_e('Upload a CSV, map its columns to the fields below, preview the result, then import. Rows are matched on email: an existing record is updated, a new one is created.', 'october-events'); ?></p>
            <form method="post" action="<?php echo esc_url($page . '&tab=import'); ?>" enctype="multipart/form-data" class="oe-porter-export">
                <input type="hidden" name="oe_porter_action" value="upload">
                <?php wp_nonce_field('oe_porter_import'); ?>
                <label class="oe-porter-field"><span><?php esc_html_e('Import into', 'october-events'); ?></span>
                    <select name="target">
                        <?php foreach (Importer::targets() as $tk => $tt) : ?>
                            <option value="<?php echo esc_attr($tk); ?>"><?php echo esc_html($tt['label']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label class="oe-porter-field"><span><?php esc_html_e('CSV file', 'october-events'); ?></span>
                    <input type="file" name="oe_csv" accept=".csv" required>
                </label>
                <button type="submit" class="button button-primary"><?php esc_html_e('Upload & map', 'october-events'); ?></button>
            </form>
            <p class="oe-ad-note"><?php esc_html_e('Migrating from JetEngine? Use the dedicated migrator under the plugin tools; this importer is for spreadsheet-style data (contacts and team).', 'october-events'); ?></p>
        </div>
    <?php else : // mapping + preview + commit ?>
        <?php $templates = Importer::templates($target); ?>
        <div class="oe-ad-card" style="margin-top:16px;">
            <p><strong><?php echo esc_html(sprintf(__('Mapping to: %s', 'october-events'), $spec['label'])); ?></strong>
                <a class="button button-small" style="margin-left:10px" href="<?php echo esc_url($page . '&tab=import'); ?>"><?php esc_html_e('Start over', 'october-events'); ?></a>
            </p>

            <?php if ($templates) : ?>
            <p class="oe-porter-templates"><?php esc_html_e('Saved templates:', 'october-events'); ?>
                <?php foreach ($templates as $name => $tpl) : ?>
                    <a class="button button-small" href="<?php echo esc_url(add_query_arg(['tab' => 'import', 'target' => $target, 'token' => $token, 'use_template' => rawurlencode($name)], $page)); ?>"><?php echo esc_html($name); ?></a>
                <?php endforeach; ?>
            </p>
            <?php endif; ?>

            <form method="post" action="<?php echo esc_url($page . '&tab=import'); ?>">
                <?php wp_nonce_field('oe_porter_import'); ?>
                <input type="hidden" name="token" value="<?php echo esc_attr($token); ?>">
                <input type="hidden" name="target" value="<?php echo esc_attr($target); ?>">

                <table class="oe-ad-table oe-porter-map">
                    <thead><tr><th><?php esc_html_e('Field', 'october-events'); ?></th><th><?php esc_html_e('CSV column', 'october-events'); ?></th></tr></thead>
                    <tbody>
                    <?php foreach ($spec['fields'] as $field => $flabel) : ?>
                        <tr>
                            <td><strong><?php echo esc_html($flabel); ?></strong><?php echo $field === $spec['key'] ? ' <span class="oe-ad-pill oe-ad-pill--info">key</span>' : ''; ?></td>
                            <td>
                                <select name="map[<?php echo esc_attr($field); ?>]">
                                    <option value="">— <?php esc_html_e('ignore', 'october-events'); ?> —</option>
                                    <?php foreach ($headers as $h) : ?>
                                        <option value="<?php echo esc_attr((string) $h); ?>" <?php selected($map[$field] ?? '', (string) $h); ?>><?php echo esc_html((string) $h); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>

                <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <button type="submit" name="oe_porter_action" value="preview" class="button"><?php esc_html_e('Preview (dry run)', 'october-events'); ?></button>
                    <button type="submit" name="oe_porter_action" value="commit" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Import these rows now?', 'october-events')); ?>');"><?php esc_html_e('Import', 'october-events'); ?></button>
                    <span style="flex:1"></span>
                    <input type="text" name="template_name" placeholder="<?php esc_attr_e('Template name', 'october-events'); ?>" style="width:160px">
                    <button type="submit" name="oe_porter_action" value="save_template" class="button button-small"><?php esc_html_e('Save mapping', 'october-events'); ?></button>
                </p>
            </form>

            <?php if ($preview !== null) : ?>
                <div class="oe-porter-preview">
                    <div class="oe-ad-strip">
                        <div class="oe-ad-stat oe-ad-stat--feature"><div class="l"><?php esc_html_e('Rows', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) $preview['total'])); ?></div><div class="s"><?php esc_html_e('in the file', 'october-events'); ?></div></div>
                        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Create', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) $preview['created'])); ?></div><div class="s"><?php esc_html_e('new records', 'october-events'); ?></div></div>
                        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Update', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) $preview['updated'])); ?></div><div class="s"><?php esc_html_e('matched on email', 'october-events'); ?></div></div>
                        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Skip', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) $preview['skipped'])); ?></div><div class="s"><?php esc_html_e('no valid email', 'october-events'); ?></div></div>
                    </div>
                    <?php if (! empty($preview['sample'])) : ?>
                    <table class="oe-ad-table" style="margin-top:12px;">
                        <thead><tr><th><?php esc_html_e('Action', 'october-events'); ?></th><?php foreach (array_keys($spec['fields']) as $f) : ?><th><?php echo esc_html($f); ?></th><?php endforeach; ?></tr></thead>
                        <tbody>
                        <?php foreach ($preview['sample'] as $s) : ?>
                            <tr>
                                <td><span class="oe-ad-pill oe-ad-pill--<?php echo ($s['_action'] ?? '') === 'update' ? 'warn' : 'pos'; ?>"><?php echo esc_html((string) ($s['_action'] ?? '')); ?></span></td>
                                <?php foreach (array_keys($spec['fields']) as $f) : ?><td><?php echo esc_html((string) ($s[$f] ?? '')); ?></td><?php endforeach; ?>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    <p class="description"><?php esc_html_e('Showing the first few rows. Nothing has been written yet.', 'october-events'); ?></p>
                    <?php endif; ?>
                </div>
            <?php endif; ?>
        </div>
    <?php endif; ?>
    <?php endif; ?>
</div>
