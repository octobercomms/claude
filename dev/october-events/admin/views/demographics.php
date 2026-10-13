<?php
/**
 * Demographics dashboard (ROADMAP R2) — aggregate only.
 *
 * @var array $agg    Store::aggregate()  [profiles, fields => value => count]
 * @var array $fields Store::fields()
 */
defined('ABSPATH') || exit;
$profiles = (int) ($agg['profiles'] ?? 0);
?>
<div class="wrap oe-admin oe-demographics">
    <h1><?php esc_html_e('Demographics', 'october-events'); ?></h1>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature">
            <div class="l"><?php esc_html_e('Profiles', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n($profiles)); ?></div>
            <div class="s"><?php esc_html_e('consented', 'october-events'); ?></div>
        </div>
    </div>

    <?php if ($profiles === 0) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No demographic data yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Add the [oe_demographics] form to your account dashboard. People fill it in optionally, with consent; aggregate counts appear here.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
        <div class="oe-ad-grid2">
        <?php foreach ($fields as $field => $spec) :
            $counts = (array) ($agg['fields'][$field] ?? []);
            $max = max(1, max($counts ?: [0]));
        ?>
            <div class="oe-ad-card">
                <div class="oe-ad-card-title"><?php echo esc_html($spec['label']); ?></div>
                <div class="oe-demo-bars">
                    <?php foreach ($spec['options'] as $ov => $ol) :
                        $n = (int) ($counts[$ov] ?? 0);
                        $pct = (int) round($n / $max * 100);
                    ?>
                        <div class="oe-demo-barrow">
                            <span class="oe-demo-barlabel"><?php echo esc_html($ol); ?></span>
                            <span class="oe-demo-bartrack"><span class="oe-demo-barfill" style="width:<?php echo (int) $pct; ?>%"></span></span>
                            <span class="oe-demo-barval"><?php echo esc_html(number_format_i18n($n)); ?></span>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        <?php endforeach; ?>
        </div>
        <p class="oe-ad-note"><?php esc_html_e('Aggregate counts over profiles where the person consented. Individual demographic values are never shown here.', 'october-events'); ?></p>
    <?php endif; ?>
</div>
