<?php
/**
 * User access screen (ADMIN-BUILD AD11).
 *
 * @var array<string,string> $roles     assignable role slug => name
 * @var array<string,array>  $map       role => [sections]
 * @var array<string,string> $sections  section key => label
 * @var array<string,array>  $presets   preset key => [label, sections]
 * @var array<string,int>    $by_role   role slug => user count
 */
defined('ABSPATH') || exit;
?>
<div class="wrap oe-admin oe-access">
    <h1><?php esc_html_e('User access', 'october-events'); ?></h1>

    <?php if (isset($_GET['oe_msg']) && $_GET['oe_msg'] === 'saved') : // phpcs:ignore WordPress.Security.NonceVerification ?>
        <div class="notice notice-success is-dismissible inline"><p><?php esc_html_e('Access saved and applied to the roles.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <div class="oe-ad-card" style="margin-bottom:16px;">
        <p style="margin:0;"><?php esc_html_e('Give each WordPress role access to only the screens it needs. Administrators always see everything. A role with nothing ticked keeps whatever access WordPress already gives it; tick a box to put that role on October Events and limit it to what you tick. Enforced on the menu and on direct links.', 'october-events'); ?></p>
    </div>

    <?php if (! $roles) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No non-admin roles to configure.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Every role on this site can already manage everything. Create an editor or custom role to scope access.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_save_access">
        <?php wp_nonce_field('oe_save_access'); ?>

        <div class="oe-ad-card" style="padding:0;overflow:auto;">
            <table class="oe-ad-table oe-access-grid">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Role', 'october-events'); ?></th>
                        <?php foreach ($sections as $sk => $sl) : ?>
                            <th class="oe-access-col"><span><?php echo esc_html($sl); ?></span></th>
                        <?php endforeach; ?>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($roles as $role_slug => $role_name) :
                    $have  = (array) ($map[$role_slug] ?? []);
                    $users = (int) ($by_role[$role_slug] ?? 0);
                ?>
                    <tr data-role="<?php echo esc_attr($role_slug); ?>">
                        <td>
                            <strong><?php echo esc_html($role_name); ?></strong>
                            <br><span class="description"><?php echo esc_html(sprintf(_n('%d user', '%d users', $users, 'october-events'), $users)); ?></span>
                            <div class="oe-access-presets">
                                <?php foreach ($presets as $pk => $preset) : ?>
                                    <button type="button" class="button button-small oe-access-preset" data-sections="<?php echo esc_attr(implode(',', $preset['sections'])); ?>"><?php echo esc_html($preset['label']); ?></button>
                                <?php endforeach; ?>
                            </div>
                        </td>
                        <?php foreach ($sections as $sk => $sl) : ?>
                            <td class="oe-access-cell">
                                <input type="checkbox" name="section_access[<?php echo esc_attr($role_slug); ?>][]" value="<?php echo esc_attr($sk); ?>" data-section="<?php echo esc_attr($sk); ?>" <?php checked(in_array($sk, $have, true)); ?>>
                            </td>
                        <?php endforeach; ?>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <p style="margin-top:14px;">
            <button type="submit" class="button button-primary"><?php esc_html_e('Save access', 'october-events'); ?></button>
        </p>
    </form>
    <?php endif; ?>
</div>

<script>
(function () {
    document.querySelectorAll('.oe-access-preset').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var row = btn.closest('tr');
            if (!row) { return; }
            var want = (btn.getAttribute('data-sections') || '').split(',').filter(Boolean);
            row.querySelectorAll('input[type=checkbox][data-section]').forEach(function (cb) {
                cb.checked = want.indexOf(cb.getAttribute('data-section')) !== -1;
            });
        });
    });
})();
</script>
