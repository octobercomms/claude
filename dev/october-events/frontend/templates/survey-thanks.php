<?php
/**
 * Survey completion screen — thanks, and the reward code revealed on finish.
 *
 * @var string $code   incentive promo code (may be empty)
 * @var string $offer  what the reward is, e.g. "20% off tours" (may be empty)
 */
defined('ABSPATH') || exit;
$offer = isset($offer) ? (string) $offer : '';
?>
<main class="oe-survey">
    <div class="oe-survey-card oe-survey-done">
        <div class="oe-survey-tick" aria-hidden="true">✓</div>
        <h1><?php esc_html_e('Thank you', 'october-events'); ?></h1>
        <p><?php esc_html_e('That’s a real help. It shapes what we do next time.', 'october-events'); ?></p>

        <?php if ($code !== '') : ?>
            <p class="oe-survey-code-intro"><?php
                echo $offer !== ''
                    ? esc_html(sprintf(/* translators: %s: offer, e.g. "20% off" */ __('Your reward — %s:', 'october-events'), $offer))
                    : esc_html__('Here’s your thank-you code:', 'october-events');
            ?></p>
            <div class="oe-survey-code"><?php echo esc_html($code); ?></div>
            <p class="oe-survey-code-note"><?php esc_html_e('Use it at checkout next time.', 'october-events'); ?></p>
        <?php endif; ?>
    </div>
</main>
