<?php
/**
 * Taxonomies & filters screen (ADMIN-BUILD AD12).
 *
 * The list stays on one page; creating a taxonomy and managing a
 * taxonomy's definition + terms happen in right-hand slide-ins (no page
 * load), per the admin build's slide-in-first rule.
 *
 * @var array<string,array> $taxonomies Registry::all()
 * @var array<string,string> $types     listing type key => label
 */
defined('ABSPATH') || exit;
use OE\Taxonomies\Registry;
use OE\Admin\SlideIn;

$open = isset($_GET['open']) ? sanitize_key((string) $_GET['open']) : ''; // phpcs:ignore WordPress.Security.NonceVerification
$new_open = $open === '' && isset($_GET['new']); // phpcs:ignore WordPress.Security.NonceVerification
$notices = [
    'tax_saved'    => __('Taxonomy saved.', 'october-events'),
    'tax_deleted'  => __('Taxonomy deleted.', 'october-events'),
    'term_added'   => __('Term added.', 'october-events'),
    'term_deleted' => __('Term removed.', 'october-events'),
    'error'        => __('Check the name and slug, then try again.', 'october-events'),
];
?>
<div class="wrap oe-admin oe-tax">
    <h1 class="wp-heading-inline"><?php esc_html_e('Taxonomies & filters', 'october-events'); ?></h1>
    <a class="page-title-action" href="<?php echo esc_url(admin_url('admin.php?page=oe-locations')); ?>"><?php esc_html_e('Locations & venues', 'october-events'); ?></a>
    <?php echo SlideIn::trigger('oe-tax-new', __('+ New taxonomy', 'october-events'), 'page-title-action'); ?>
    <hr class="wp-header-end">

    <?php if (isset($_GET['oe_msg'], $notices[$_GET['oe_msg']])) : // phpcs:ignore WordPress.Security.NonceVerification ?>
        <div class="notice notice-<?php echo $_GET['oe_msg'] === 'error' ? 'error' : 'success'; ?> is-dismissible inline"><p><?php echo esc_html($notices[sanitize_key((string) $_GET['oe_msg'])]); ?></p></div>
    <?php endif; ?>

    <div class="oe-ad-card" style="margin-bottom:16px;">
        <p style="margin:0;"><?php esc_html_e('Taxonomies group and filter your listing types. Attach one to a type, add terms with colours, and flag it to show as a filter — the listings archive (chips or dropdowns) picks it up. Use chips="auto" / filters="auto" on [oe_listings] to pull the flagged ones automatically.', 'october-events'); ?></p>
    </div>

    <?php if (! $taxonomies) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No taxonomies yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Create one with “+ New taxonomy” to start grouping and filtering your listings.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead>
                <tr>
                    <th><?php esc_html_e('Taxonomy', 'october-events'); ?></th>
                    <th><?php esc_html_e('Attached to', 'october-events'); ?></th>
                    <th><?php esc_html_e('Filter', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Terms', 'october-events'); ?></th>
                    <th class="oe-ad-num"></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($taxonomies as $key => $def) :
                $attached = array_map(static fn($t) => $types[$t] ?? $t, (array) ($def['types'] ?? []));
                $terms    = taxonomy_exists($key) ? get_terms(['taxonomy' => $key, 'hide_empty' => false]) : [];
                $terms    = is_wp_error($terms) ? [] : $terms;
            ?>
                <tr>
                    <td><strong><?php echo esc_html((string) $def['label']); ?></strong> <code><?php echo esc_html($key); ?></code></td>
                    <td><span class="description"><?php echo esc_html($attached ? implode(', ', $attached) : __('not attached', 'october-events')); ?></span></td>
                    <td>
                        <?php if (! empty($def['show_filter'])) : ?>
                            <span class="oe-ad-pill oe-ad-pill--pos"><?php echo esc_html((string) ($def['filter_style'] ?? 'chips')); ?></span>
                        <?php else : ?>
                            <span class="oe-ad-pill oe-ad-pill--neu"><?php esc_html_e('off', 'october-events'); ?></span>
                        <?php endif; ?>
                    </td>
                    <td class="oe-ad-num"><?php echo (int) count($terms); ?></td>
                    <td class="oe-ad-num"><?php echo SlideIn::trigger('oe-tax-' . $key, __('Manage terms', 'october-events'), 'button button-small'); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <?php endif; ?>

<?php // ---- New taxonomy slide-in ---- ?>
<?php SlideIn::open('oe-tax-new', __('New taxonomy', 'october-events'), $new_open); ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_tax_save">
        <?php wp_nonce_field('oe_tax_save'); ?>
        <div class="oe-tax-grid">
            <label><?php esc_html_e('Name (plural)', 'october-events'); ?><input type="text" name="label" required placeholder="<?php esc_attr_e('e.g. Materials', 'october-events'); ?>"></label>
            <label><?php esc_html_e('Singular', 'october-events'); ?><input type="text" name="singular" placeholder="<?php esc_attr_e('e.g. Material', 'october-events'); ?>"></label>
            <label><?php esc_html_e('Slug', 'october-events'); ?><input type="text" name="key" required pattern="[a-z0-9_\-]{1,32}" placeholder="<?php esc_attr_e('materials', 'october-events'); ?>"></label>
            <label><?php esc_html_e('Filter style', 'october-events'); ?>
                <select name="filter_style"><option value="chips"><?php esc_html_e('Chips', 'october-events'); ?></option><option value="dropdown"><?php esc_html_e('Dropdown', 'october-events'); ?></option></select>
            </label>
            <fieldset class="oe-tax-types"><legend><?php esc_html_e('Attach to', 'october-events'); ?></legend>
                <?php foreach ($types as $tk => $tl) : ?>
                    <label class="oe-tax-type"><input type="checkbox" name="types[]" value="<?php echo esc_attr($tk); ?>"> <?php echo esc_html($tl); ?></label>
                <?php endforeach; ?>
            </fieldset>
            <div class="oe-tax-flags">
                <label><input type="checkbox" name="hierarchical" value="1"> <?php esc_html_e('Hierarchical (like categories)', 'october-events'); ?></label>
                <label><input type="checkbox" name="show_filter" value="1" checked> <?php esc_html_e('Show as a filter on listings', 'october-events'); ?></label>
            </div>
        </div>
        <p style="margin-top:12px;"><button type="submit" class="button button-primary"><?php esc_html_e('Create taxonomy', 'october-events'); ?></button></p>
    </form>
<?php SlideIn::close(); ?>

<?php // ---- Per-taxonomy manage slide-ins (definition + terms) ---- ?>
<?php foreach ($taxonomies as $key => $def) :
    $terms = taxonomy_exists($key) ? get_terms(['taxonomy' => $key, 'hide_empty' => false]) : [];
    $terms = is_wp_error($terms) ? [] : $terms;
?>
<?php SlideIn::open('oe-tax-' . $key, sprintf(__('Manage: %s', 'october-events'), (string) $def['label']), $open === $key); ?>
    <?php // Edit the definition. ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-tax-edit">
        <input type="hidden" name="action" value="oe_tax_save">
        <input type="hidden" name="existing_key" value="<?php echo esc_attr($key); ?>">
        <?php wp_nonce_field('oe_tax_save'); ?>
        <div class="oe-tax-grid">
            <label><?php esc_html_e('Name (plural)', 'october-events'); ?><input type="text" name="label" value="<?php echo esc_attr((string) $def['label']); ?>" required></label>
            <label><?php esc_html_e('Singular', 'october-events'); ?><input type="text" name="singular" value="<?php echo esc_attr((string) ($def['singular'] ?? '')); ?>"></label>
            <label><?php esc_html_e('Filter style', 'october-events'); ?>
                <select name="filter_style">
                    <option value="chips" <?php selected((string) ($def['filter_style'] ?? 'chips'), 'chips'); ?>><?php esc_html_e('Chips', 'october-events'); ?></option>
                    <option value="dropdown" <?php selected((string) ($def['filter_style'] ?? 'chips'), 'dropdown'); ?>><?php esc_html_e('Dropdown', 'october-events'); ?></option>
                </select>
            </label>
            <fieldset class="oe-tax-types"><legend><?php esc_html_e('Attach to', 'october-events'); ?></legend>
                <?php foreach ($types as $tk => $tl) : ?>
                    <label class="oe-tax-type"><input type="checkbox" name="types[]" value="<?php echo esc_attr($tk); ?>" <?php checked(in_array($tk, (array) ($def['types'] ?? []), true)); ?>> <?php echo esc_html($tl); ?></label>
                <?php endforeach; ?>
            </fieldset>
            <div class="oe-tax-flags">
                <label><input type="checkbox" name="hierarchical" value="1" <?php checked(! empty($def['hierarchical'])); ?>> <?php esc_html_e('Hierarchical', 'october-events'); ?></label>
                <label><input type="checkbox" name="show_filter" value="1" <?php checked(! empty($def['show_filter'])); ?>> <?php esc_html_e('Show as a filter', 'october-events'); ?></label>
            </div>
        </div>
        <p style="margin-top:10px;display:flex;gap:8px;align-items:center;">
            <button type="submit" class="button button-primary button-small"><?php esc_html_e('Save', 'october-events'); ?></button>
            <a class="button button-small button-link-delete" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_tax_delete&key=' . rawurlencode($key)), 'oe_tax_delete_' . $key)); ?>" onclick="return confirm('<?php echo esc_js(__('Delete this taxonomy? Its term assignments are removed; the terms themselves may remain until cleaned up.', 'october-events')); ?>');"><?php esc_html_e('Delete taxonomy', 'october-events'); ?></a>
        </p>
    </form>

    <?php // Terms with colours. ?>
    <h4 class="oe-tax-terms-h"><?php esc_html_e('Terms', 'october-events'); ?></h4>
    <div class="oe-tax-terms">
        <?php if (! $terms) : ?>
            <span class="description"><?php esc_html_e('No terms yet.', 'october-events'); ?></span>
        <?php else : foreach ($terms as $term) :
            $color = Registry::term_color((int) $term->term_id);
            $del = wp_nonce_url(admin_url('admin-post.php?action=oe_term_delete&taxonomy=' . rawurlencode($key) . '&term=' . (int) $term->term_id), 'oe_term_delete_' . $key . '_' . $term->term_id);
        ?>
            <span class="oe-tax-term">
                <span class="oe-tax-swatch" style="background:<?php echo esc_attr($color ?: '#e3e2db'); ?>"></span>
                <?php echo esc_html($term->name); ?>
                <span class="description">(<?php echo (int) $term->count; ?>)</span>
                <a class="oe-tax-term-x" href="<?php echo esc_url($del); ?>" onclick="return confirm('<?php echo esc_js(__('Remove this term?', 'october-events')); ?>');">×</a>
            </span>
        <?php endforeach; endif; ?>
    </div>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-tax-addterm">
        <input type="hidden" name="action" value="oe_term_add">
        <input type="hidden" name="taxonomy" value="<?php echo esc_attr($key); ?>">
        <?php wp_nonce_field('oe_term_add_' . $key); ?>
        <input type="text" name="term_name" placeholder="<?php esc_attr_e('New term', 'october-events'); ?>" required>
        <input type="color" name="term_color" value="#dd4b14" title="<?php esc_attr_e('Term colour', 'october-events'); ?>">
        <button type="submit" class="button button-small"><?php esc_html_e('Add term', 'october-events'); ?></button>
    </form>
<?php SlideIn::close(); ?>
<?php endforeach; ?>
</div>

