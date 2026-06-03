<?php
/** @var ?object $campaign @var array $creative_map */
defined('ABSPATH') || exit;
use ADF\Ads\Formats;
$c = $campaign;
?>
<div class="wrap adf-admin">
    <h1><?php echo $c ? esc_html__('Edit Campaign', 'adf-festival') : esc_html__('Add Campaign', 'adf-festival'); ?></h1>
    <?php if (! empty($_GET['saved'])) : ?><div class="notice notice-success is-dismissible"><p><?php esc_html_e('Saved.', 'adf-festival'); ?></p></div><?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="adf_save_campaign">
        <input type="hidden" name="id" value="<?php echo (int) ($c->id ?? 0); ?>">
        <?php wp_nonce_field('adf_save_campaign'); ?>

        <table class="form-table">
            <tr><th><?php esc_html_e('Campaign name', 'adf-festival'); ?></th><td><input type="text" name="name" class="regular-text" required value="<?php echo esc_attr($c->name ?? ''); ?>"></td></tr>
            <tr><th><?php esc_html_e('Client / advertiser', 'adf-festival'); ?></th><td><input type="text" name="client_name" class="regular-text" value="<?php echo esc_attr($c->client_name ?? ''); ?>"></td></tr>
            <tr><th><?php esc_html_e('Destination URL', 'adf-festival'); ?></th><td><input type="url" name="url" class="regular-text" required value="<?php echo esc_attr($c->url ?? ''); ?>"></td></tr>
            <tr><th><?php esc_html_e('Active', 'adf-festival'); ?></th><td><label><input type="checkbox" name="active" value="1" <?php checked(($c->status ?? 'active') === 'active'); ?>> <?php esc_html_e('Campaign is live', 'adf-festival'); ?></label></td></tr>
            <tr><th><?php esc_html_e('Schedule', 'adf-festival'); ?></th><td>
                <input type="date" name="start_date" value="<?php echo esc_attr($c->start_date ?? ''); ?>"> →
                <input type="date" name="end_date" value="<?php echo esc_attr($c->end_date ?? ''); ?>"></td></tr>
            <tr><th><?php esc_html_e('Impression cap', 'adf-festival'); ?></th><td>
                <label><input type="checkbox" name="restrict_impressions" value="1" <?php checked(! empty($c->restrict_impressions)); ?>> <?php esc_html_e('Limit', 'adf-festival'); ?></label>
                <input type="number" name="max_impressions" value="<?php echo esc_attr($c->max_impressions ?? ''); ?>" style="width:120px"></td></tr>
            <tr><th><?php esc_html_e('Click cap', 'adf-festival'); ?></th><td>
                <label><input type="checkbox" name="restrict_clicks" value="1" <?php checked(! empty($c->restrict_clicks)); ?>> <?php esc_html_e('Limit', 'adf-festival'); ?></label>
                <input type="number" name="max_clicks" value="<?php echo esc_attr($c->max_clicks ?? ''); ?>" style="width:120px"></td></tr>
        </table>

        <h2><?php esc_html_e('Creatives', 'adf-festival'); ?></h2>
        <table class="widefat" style="max-width:760px">
            <?php foreach (Formats::ALL as $key => $f) :
                $cr = $creative_map[$key] ?? null; ?>
                <tr>
                    <th style="width:160px"><?php echo esc_html($f['label']); ?><br><span class="description"><?php echo (int) $f['w']; ?>×<?php echo (int) $f['h']; ?></span></th>
                    <td>
                        <div class="adf-ad-preview"><?php if ($cr) : ?><img src="<?php echo esc_url($cr->image_url); ?>" style="max-width:200px;height:auto"><?php endif; ?></div>
                        <input type="hidden" class="adf-ad-url" name="creative[<?php echo esc_attr($key); ?>][image_url]" value="<?php echo esc_attr($cr->image_url ?? ''); ?>">
                        <button type="button" class="button adf-ad-pick"><?php esc_html_e('Choose image', 'adf-festival'); ?></button>
                        <?php if ($cr) : ?><label><input type="checkbox" name="creative[<?php echo esc_attr($key); ?>][remove]" value="1"> <?php esc_html_e('Remove', 'adf-festival'); ?></label><?php endif; ?>
                        <br><input type="text" name="creative[<?php echo esc_attr($key); ?>][alt]" placeholder="<?php esc_attr_e('Alt text', 'adf-festival'); ?>" value="<?php echo esc_attr($cr->alt_text ?? ''); ?>" class="regular-text" style="margin-top:6px">
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>

        <?php submit_button($c ? __('Update campaign', 'adf-festival') : __('Create campaign', 'adf-festival')); ?>
        <a href="<?php echo esc_url(admin_url('admin.php?page=adf-ads')); ?>" class="button"><?php esc_html_e('Back', 'adf-festival'); ?></a>
    </form>
</div>
<script>
jQuery(function($){
    $('.adf-ad-pick').on('click', function(e){
        e.preventDefault();
        var row = $(this).closest('td');
        var frame = wp.media({ title: 'Choose ad image', multiple: false, library: { type: 'image' } });
        frame.on('select', function(){
            var a = frame.state().get('selection').first().toJSON();
            row.find('.adf-ad-url').val(a.url);
            row.find('.adf-ad-preview').html('<img src="'+a.url+'" style="max-width:200px;height:auto">');
        });
        frame.open();
    });
});
</script>
