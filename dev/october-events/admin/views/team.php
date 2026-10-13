<?php
/**
 * Planning-team / crew admin screen (ADMIN-BUILD AD7).
 *
 * @var array<string,int>            $stats    Crew::stats()
 * @var array<string,array<int,object>> $grouped Crew::by_tier()
 * @var object|null                  $editing  the row being edited, if any
 */
defined('ABSPATH') || exit;
use OE\Crew\Crew;

$action_url = admin_url('admin-post.php');
$notices = [
    'added'         => [__('Team member added.', 'october-events'), 'success'],
    'saved'         => [__('Saved.', 'october-events'), 'success'],
    'deleted'       => [__('Removed.', 'october-events'), 'success'],
    'agreement_sent'=> [__('Role agreement emailed.', 'october-events'), 'success'],
    'provisioned'   => [__('Login provisioned and the set-password email sent.', 'october-events'), 'success'],
    'activated'     => [__('Marked active.', 'october-events'), 'success'],
    'renewal_sent'  => [__('Renewal prompt emailed.', 'october-events'), 'success'],
    'offboarded'    => [__('Offboarded. Access revoked and the role reopened.', 'october-events'), 'success'],
    'error'         => [__('Something went wrong — check the details and try again.', 'october-events'), 'error'],
];

/** Build a nonce-protected action link. */
$act = static function (int $id, string $do) {
    return wp_nonce_url(
        add_query_arg(['action' => 'oe_crew_action', 'id' => $id, 'do' => $do], admin_url('admin-post.php')),
        'oe_crew_action_' . $id
    );
};
?>
<div class="wrap oe-admin oe-team-admin">
    <?php \OE\Admin\Admin::people_header('team', \OE\Admin\SlideIn::trigger('oe-team-add', __('+ Add to the team', 'october-events'), 'button button-primary')); ?>
    <?php \OE\Admin\Admin::bento('team'); ?>

    <?php
    if (isset($_GET['oe_msg'])) : // phpcs:ignore WordPress.Security.NonceVerification -- read-only notice
        $k = sanitize_key((string) $_GET['oe_msg']);
        if (isset($notices[$k])) :
            [$text, $kind] = $notices[$k]; ?>
            <div class="notice notice-<?php echo esc_attr($kind === 'error' ? 'error' : 'success'); ?> is-dismissible inline"><p><?php echo esc_html($text); ?></p></div>
        <?php endif;
    endif; ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature">
            <div class="l"><?php esc_html_e('Planning team', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) $stats['planning'])); ?></div>
            <div class="s"><?php echo esc_html(sprintf(__('%d active', 'october-events'), (int) $stats['active'])); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Agreements out', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) $stats['agreements_out'])); ?></div>
            <div class="s"><?php esc_html_e('invited, not yet accepted', 'october-events'); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Renewals due', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) $stats['renewals_due'])); ?></div>
            <div class="s"><?php esc_html_e('term ends within 60 days', 'october-events'); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Council &amp; board', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) $stats['council'] + (int) $stats['board'])); ?></div>
            <div class="s"><?php esc_html_e('governance, directory only', 'october-events'); ?></div>
        </div>
    </div>

    <?php
    // ---- Add / edit form (shared slide-in panel, open when editing) ------
    $e = $editing;
    $is_edit = (bool) $e;
    \OE\Admin\SlideIn::open('oe-team-add', $is_edit ? __('Edit team member', 'october-events') : __('Add to the team', 'october-events'), $is_edit);
    ?>
        <form method="post" action="<?php echo esc_url($action_url); ?>" class="oe-team-fields">
            <input type="hidden" name="action" value="oe_crew_save">
            <input type="hidden" name="id" value="<?php echo (int) ($e->id ?? 0); ?>">
            <?php wp_nonce_field('oe_crew_save'); ?>
            <div class="oe-team-grid">
                <label><?php esc_html_e('Tier', 'october-events'); ?>
                    <select name="tier">
                        <?php foreach (Crew::tiers() as $tk => $tl) : ?>
                            <option value="<?php echo esc_attr($tk); ?>" <?php selected((string) ($e->tier ?? Crew::TIER_PLANNING), $tk); ?>><?php echo esc_html($tl); ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label><?php esc_html_e('Status', 'october-events'); ?>
                    <select name="status">
                        <option value=""><?php esc_html_e('— default —', 'october-events'); ?></option>
                        <?php foreach (Crew::statuses() as $sk => $sl) : ?>
                            <option value="<?php echo esc_attr($sk); ?>" <?php selected((string) ($e->status ?? ''), $sk); ?>><?php echo esc_html($sl); ?></option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <label><?php esc_html_e('Role title', 'october-events'); ?>
                    <input type="text" name="role_title" value="<?php echo esc_attr((string) ($e->role_title ?? '')); ?>" placeholder="<?php esc_attr_e('e.g. Email Coordinator', 'october-events'); ?>">
                </label>
                <label><?php esc_html_e('Name', 'october-events'); ?>
                    <input type="text" name="name" value="<?php echo esc_attr((string) ($e->name ?? '')); ?>">
                </label>
                <label><?php esc_html_e('Email', 'october-events'); ?>
                    <input type="email" name="email" value="<?php echo esc_attr((string) ($e->email ?? '')); ?>">
                </label>
                <label><?php esc_html_e('Phone', 'october-events'); ?>
                    <input type="tel" name="phone" value="<?php echo esc_attr((string) ($e->phone ?? '')); ?>">
                </label>
                <label><?php esc_html_e('Role email (alias)', 'october-events'); ?>
                    <input type="email" name="role_email" value="<?php echo esc_attr((string) ($e->role_email ?? '')); ?>" placeholder="<?php esc_attr_e('program@festival.org', 'october-events'); ?>">
                </label>
                <label><?php esc_html_e('Hours / month', 'october-events'); ?>
                    <input type="text" name="hours_month" value="<?php echo esc_attr((string) ($e->hours_month ?? '')); ?>" placeholder="<?php esc_attr_e('e.g. 8–10', 'october-events'); ?>">
                </label>
                <label><?php esc_html_e('Term start', 'october-events'); ?>
                    <input type="date" name="term_start" value="<?php echo esc_attr((string) ($e->term_start ?? '')); ?>">
                </label>
                <label><?php esc_html_e('Term end', 'october-events'); ?>
                    <input type="date" name="term_end" value="<?php echo esc_attr((string) ($e->term_end ?? '')); ?>">
                </label>
                <label class="oe-team-wide"><?php esc_html_e('What the role owns', 'october-events'); ?>
                    <input type="text" name="role_owns" value="<?php echo esc_attr((string) ($e->role_owns ?? '')); ?>">
                </label>
                <label class="oe-team-wide"><?php esc_html_e('Public bio (for the team page)', 'october-events'); ?>
                    <textarea name="bio" rows="2"><?php echo esc_textarea((string) ($e->bio ?? '')); ?></textarea>
                </label>
                <label class="oe-team-wide"><?php esc_html_e('Internal note', 'october-events'); ?>
                    <textarea name="note" rows="2"><?php echo esc_textarea((string) ($e->note ?? '')); ?></textarea>
                </label>
                <div class="oe-team-photo-field">
                    <span class="oe-team-photo-label"><?php esc_html_e('Photo', 'october-events'); ?></span>
                    <input type="hidden" name="photo_id" id="oe-team-photo-id" value="<?php echo (int) ($e->photo_id ?? 0); ?>">
                    <span id="oe-team-photo-preview"><?php
                        $pid = (int) ($e->photo_id ?? 0);
                        if ($pid) { echo wp_get_attachment_image($pid, [64, 64]); }
                    ?></span>
                    <button type="button" class="button" id="oe-team-photo-pick"><?php esc_html_e('Choose', 'october-events'); ?></button>
                    <button type="button" class="button-link" id="oe-team-photo-clear"><?php esc_html_e('Clear', 'october-events'); ?></button>
                </div>
            </div>
            <p style="margin-top:12px;">
                <button type="submit" class="button button-primary"><?php echo $is_edit ? esc_html__('Save changes', 'october-events') : esc_html__('Add', 'october-events'); ?></button>
                <?php if ($is_edit) : ?>
                    <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-team')); ?>"><?php esc_html_e('Cancel', 'october-events'); ?></a>
                <?php else : ?>
                    <button type="button" class="button" data-oe-slide-close><?php esc_html_e('Cancel', 'october-events'); ?></button>
                <?php endif; ?>
            </p>
        </form>
    <?php \OE\Admin\SlideIn::close(); ?>

    <?php
    // ---- Lifecycle tables, grouped by tier --------------------------------
    foreach (Crew::tiers() as $tier_key => $tier_label) :
        $rows = $grouped[$tier_key] ?? [];
        if (! $rows && $tier_key === Crew::TIER_VOLUNTEER) {
            continue; // volunteers live on their own screen; show here only if used
        }
        $managed = Crew::is_managed_tier($tier_key);
    ?>
        <h2 class="oe-team-tier-h"><?php echo esc_html($tier_label); ?> <span class="oe-team-count"><?php echo (int) count($rows); ?></span></h2>
        <?php if (! $rows) : ?>
            <div class="oe-ad-card"><span class="description"><?php esc_html_e('No one here yet.', 'october-events'); ?></span></div>
        <?php else : ?>
        <div class="oe-ad-card" style="padding:0;">
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Person / role', 'october-events'); ?></th>
                    <th><?php esc_html_e('Contact', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                    <?php if ($managed) : ?><th><?php esc_html_e('Term', 'october-events'); ?></th><?php endif; ?>
                    <th class="oe-ad-num"><?php esc_html_e('Actions', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($rows as $r) :
                    $status = (string) $r->status;
                    $pill   = Crew::status_pill($status);
                    $edit   = admin_url('admin.php?page=oe-team&edit=' . (int) $r->id);
                ?>
                    <tr>
                        <td>
                            <strong><?php echo esc_html((string) $r->name ?: __('(vacant)', 'october-events')); ?></strong>
                            <?php if ((string) $r->role_title !== '') : ?><br><span class="description"><?php echo esc_html((string) $r->role_title); ?></span><?php endif; ?>
                        </td>
                        <td>
                            <?php if ((string) $r->email !== '') : ?><?php echo esc_html((string) $r->email); ?><?php endif; ?>
                            <?php if ((string) $r->role_email !== '') : ?><br><span class="description"><?php echo esc_html((string) $r->role_email); ?></span><?php endif; ?>
                        </td>
                        <td><span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($pill); ?>"><?php echo esc_html(Crew::status_label($status)); ?></span></td>
                        <?php if ($managed) : ?>
                        <td><?php
                            if ($r->term_end) {
                                echo esc_html(date_i18n(get_option('date_format'), strtotime((string) $r->term_end)));
                            } else {
                                echo '<span class="description">—</span>';
                            }
                        ?></td>
                        <?php endif; ?>
                        <td class="oe-ad-num">
                            <a class="button button-small" href="<?php echo esc_url($edit); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a>
                            <?php if ($managed) : ?>
                                <?php if ($status === Crew::STATUS_INVITED) : ?>
                                    <a class="button button-small button-primary" href="<?php echo esc_url($act((int) $r->id, 'agreement')); ?>"><?php esc_html_e('Send agreement', 'october-events'); ?></a>
                                <?php elseif ($status === Crew::STATUS_AGREED) : ?>
                                    <a class="button button-small button-primary" href="<?php echo esc_url($act((int) $r->id, 'provision')); ?>" onclick="return confirm('<?php echo esc_js(__('Create a role-scoped login and email a set-password link?', 'october-events')); ?>');"><?php esc_html_e('Provision login', 'october-events'); ?></a>
                                    <a class="button button-small" href="<?php echo esc_url($act((int) $r->id, 'activate')); ?>"><?php esc_html_e('Mark active', 'october-events'); ?></a>
                                <?php elseif ($status === Crew::STATUS_ACTIVE) : ?>
                                    <a class="button button-small" href="<?php echo esc_url($act((int) $r->id, 'renewal')); ?>"><?php esc_html_e('Send renewal', 'october-events'); ?></a>
                                <?php endif; ?>
                                <?php if (in_array($status, [Crew::STATUS_AGREED, Crew::STATUS_ACTIVE, Crew::STATUS_RENEWING], true)) : ?>
                                    <a class="button button-small" href="<?php echo esc_url($act((int) $r->id, 'offboard')); ?>" onclick="return confirm('<?php echo esc_js(__('Offboard this person? Their login access is revoked and the role reopens.', 'october-events')); ?>');"><?php esc_html_e('Offboard', 'october-events'); ?></a>
                                <?php endif; ?>
                            <?php endif; ?>
                            <a class="button button-small button-link-delete" href="<?php echo esc_url($act((int) $r->id, 'delete')); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently delete this record?', 'october-events')); ?>');"><?php esc_html_e('Delete', 'october-events'); ?></a>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <?php endif; ?>
    <?php endforeach; ?>

    <p class="oe-ad-note"><?php esc_html_e('Planning-team roles carry a lifecycle: invite, agreement, login, then an automatic renewal 60 and 30 days before the term ends. Council and board are directory records with no automation. Logins never receive a password, only a set-your-own link; offboarding revokes access and reopens the role.', 'october-events'); ?></p>
</div>

<script>
(function () {
    var pick = document.getElementById('oe-team-photo-pick'),
        clear = document.getElementById('oe-team-photo-clear'),
        idField = document.getElementById('oe-team-photo-id'),
        preview = document.getElementById('oe-team-photo-preview'),
        frame;
    if (pick && window.wp && wp.media) {
        pick.addEventListener('click', function () {
            if (frame) { frame.open(); return; }
            frame = wp.media({ title: '<?php echo esc_js(__('Choose a photo', 'october-events')); ?>', multiple: false });
            frame.on('select', function () {
                var a = frame.state().get('selection').first().toJSON();
                idField.value = a.id;
                var src = (a.sizes && a.sizes.thumbnail) ? a.sizes.thumbnail.url : a.url;
                preview.innerHTML = '<img src="' + src + '" width="64" height="64" style="object-fit:cover;border-radius:6px">';
            });
            frame.open();
        });
    }
    if (clear) {
        clear.addEventListener('click', function () { idField.value = ''; preview.innerHTML = ''; });
    }
})();
</script>
