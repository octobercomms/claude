<?php
/**
 * Post-event survey form (one question per screen; JS-driven, no-JS fallback).
 *
 * @var string $token      the attendee's ticket token
 * @var int    $event_id   the event
 * @var string $event      event title
 * @var array<int,array<string,mixed>> $questions
 * @var bool   $preview    true when previewing from the builder (nothing saved)
 */
defined('ABSPATH') || exit;
$preview = isset($preview) ? (bool) $preview : false;

$rate_row = static function (string $name): void {
    echo '<div class="oe-survey-rate" role="radiogroup">';
    for ($i = 1; $i <= 5; $i++) {
        echo '<label class="oe-survey-rate-btn"><input type="radio" name="' . esc_attr($name) . '" value="' . $i . '"><span>' . $i . '</span></label>';
    }
    echo '</div>';
};
?>
<main class="oe-survey">
    <?php if ($preview) : ?>
        <div class="oe-survey-pvbar"><?php esc_html_e('Preview — this is how attendees see it. Nothing you enter here is saved.', 'october-events'); ?></div>
    <?php endif; ?>
    <form class="oe-survey-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" data-token="<?php echo esc_attr($token); ?>">
        <input type="hidden" name="action" value="oe_survey_form">
        <input type="hidden" name="oe_token" value="<?php echo esc_attr($token); ?>">
        <?php wp_nonce_field('oe_survey_public_form'); ?>

        <div class="oe-survey-head">
            <div class="oe-survey-progress" aria-hidden="true"></div>
            <p class="oe-survey-intro"><?php echo esc_html(sprintf(
                /* translators: %s: event name */
                __('A minute on %s. Your answers are anonymous.', 'october-events'),
                $event
            )); ?></p>
        </div>

        <?php foreach ($questions as $n => $q) :
            $qid  = (string) $q['id'];
            $type = (string) $q['type'];
            ?>
            <fieldset class="oe-survey-step" data-qid="<?php echo esc_attr($qid); ?>" data-type="<?php echo esc_attr($type); ?>">
                <legend class="oe-survey-qlabel"><?php echo esc_html((string) $q['label']); ?></legend>

                <?php if ($type === 'rating') : ?>
                    <?php $rate_row('q[' . $qid . ']'); ?>
                    <div class="oe-survey-scale"><span><?php esc_html_e('Poor', 'october-events'); ?></span><span><?php esc_html_e('Excellent', 'october-events'); ?></span></div>

                <?php elseif ($type === 'choice' || $type === 'multi') : ?>
                    <div class="oe-survey-opts">
                        <?php foreach ((array) ($q['options'] ?? []) as $opt) :
                            $opt = (string) $opt; ?>
                            <label class="oe-survey-opt">
                                <input type="<?php echo $type === 'multi' ? 'checkbox' : 'radio'; ?>" name="q[<?php echo esc_attr($qid); ?>]<?php echo $type === 'multi' ? '[]' : ''; ?>" value="<?php echo esc_attr($opt); ?>">
                                <span><?php echo esc_html($opt); ?></span>
                            </label>
                        <?php endforeach; ?>
                    </div>

                <?php elseif ($type === 'open') : ?>
                    <textarea class="oe-survey-text" name="q[<?php echo esc_attr($qid); ?>]" rows="4" maxlength="2000" placeholder="<?php esc_attr_e('Optional', 'october-events'); ?>"></textarea>

                <?php elseif ($type === 'session_rating') : ?>
                    <div class="oe-survey-sessions">
                        <?php foreach ((array) ($q['sessions'] ?? []) as $idx => $sess) : ?>
                            <div class="oe-survey-session">
                                <div class="oe-survey-sname"><?php echo esc_html((string) $sess); ?></div>
                                <?php $rate_row('s[' . $qid . '][' . (int) $idx . '][rating]'); ?>
                            </div>
                        <?php endforeach; ?>
                        <textarea class="oe-survey-text" name="s[<?php echo esc_attr($qid); ?>][comment]" rows="3" maxlength="2000" placeholder="<?php esc_attr_e('Any comment on the sessions? (optional)', 'october-events'); ?>"></textarea>
                    </div>

                <?php elseif ($type === 'testimonial') : ?>
                    <textarea class="oe-survey-text" name="t[<?php echo esc_attr($qid); ?>][text]" rows="4" maxlength="2000" placeholder="<?php esc_attr_e('Optional', 'october-events'); ?>"></textarea>
                    <div class="oe-survey-consent">
                        <p><?php esc_html_e('May we use this?', 'october-events'); ?></p>
                        <label class="oe-survey-opt"><input type="radio" name="t[<?php echo esc_attr($qid); ?>][consent]" value="named"><span><?php esc_html_e('Yes, with my name', 'october-events'); ?></span></label>
                        <label class="oe-survey-opt"><input type="radio" name="t[<?php echo esc_attr($qid); ?>][consent]" value="anon"><span><?php esc_html_e('Yes, anonymously', 'october-events'); ?></span></label>
                        <label class="oe-survey-opt"><input type="radio" name="t[<?php echo esc_attr($qid); ?>][consent]" value="no" checked><span><?php esc_html_e('No, keep it private', 'october-events'); ?></span></label>
                    </div>
                <?php endif; ?>
            </fieldset>
        <?php endforeach; ?>

        <div class="oe-survey-nav">
            <button type="button" class="oe-survey-btn oe-survey-back" hidden><?php esc_html_e('Back', 'october-events'); ?></button>
            <button type="submit" class="oe-survey-btn oe-survey-next"><?php esc_html_e('Next', 'october-events'); ?></button>
        </div>
    </form>
</main>
