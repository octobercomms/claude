<?php
/** @var array $cfg @var array $secrets */
defined('ABSPATH') || exit;
use OE\PostTypes;

$webhook_url = esc_url_raw(rest_url('oe/v1/stripe-webhook'));
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Settings', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('settings'); ?>
    <?php if (! empty($_GET['updated'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Settings saved.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_save_settings">
        <?php wp_nonce_field('oe_save_settings'); ?>

        <div class="oe-set">
        <nav class="oe-set-nav" id="oe-set-nav">
            <button type="button" class="is-active" data-tab="general"><?php esc_html_e('General', 'october-events'); ?></button>
            <button type="button" data-tab="events"><?php esc_html_e('Events', 'october-events'); ?></button>
            <button type="button" data-tab="checkout"><?php esc_html_e('Checkout', 'october-events'); ?></button>
            <button type="button" data-tab="ai"><?php esc_html_e('AI', 'october-events'); ?></button>
            <button type="button" data-tab="theme"><?php esc_html_e('Platform theme', 'october-events'); ?></button>
            <button type="button" data-tab="keys"><?php esc_html_e('Keys & platform', 'october-events'); ?></button>
            <button type="button" data-tab="emailsms"><?php esc_html_e('Email & SMS', 'october-events'); ?></button>
            <button type="button" data-tab="updates"><?php esc_html_e('Updates', 'october-events'); ?></button>
        </nav>
        <div class="oe-set-main">

        <section class="oe-set-panel is-active" data-tab="general">
        <details class="oe-acc" id="features" open><summary><?php esc_html_e('Features', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Switch off the modules this site doesn\'t use — they\'ll disappear from the menu, their public forms stop showing, and the platform drops them from its nav. Everything is on by default; nothing is deleted when you turn it off.', 'october-events'); ?></p>
        <?php foreach (\OE\Features::FEATURES as $key => $label) : ?>
            <p style="margin:6px 0"><label><input type="checkbox" name="features[<?php echo esc_attr($key); ?>]" value="1" <?php checked(\OE\Features::enabled($key)); ?>> <strong><?php echo esc_html($label); ?></strong></label></p>
        <?php endforeach; ?>
        <p class="description"><?php esc_html_e('Dashboard, Events and Settings are always available.', 'october-events'); ?></p>
        </div></details>

        <details class="oe-acc" id="brand"><summary><?php esc_html_e('Brand', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Shown as this site\'s menu name and in the UI (this plugin runs on multiple sites).', 'october-events'); ?></p>
        <p><label><?php esc_html_e('Brand / site name', 'october-events'); ?>
            <input type="text" name="brand_name" class="regular-text" value="<?php echo esc_attr((string) ($cfg['brand_name'] ?? 'October Events')); ?>"></label></p>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="events">
        <details class="oe-acc" id="field-mapping"><summary><?php esc_html_e('Event field mapping', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Optional. If your events store their data in existing (e.g. JetEngine) custom fields, enter those meta keys here so tickets, emails and reports can read the event’s date, price and location. Leave blank if unsure.', 'october-events'); ?></p>
        <?php $fmap = (array) ($cfg['event_field_map'] ?? []); ?>
        <table class="form-table" role="presentation"><tbody>
            <?php foreach (['start_datetime' => __('Dates & times', 'october-events'), 'end_datetime' => __('End date & time', 'october-events'), 'price' => __('Price', 'october-events'), 'location' => __('Location', 'october-events'), 'organiser' => __('Organiser', 'october-events'), 'description' => __('Description', 'october-events')] as $field => $label) : ?>
                <tr>
                    <th scope="row"><label><?php echo esc_html($label); ?></label></th>
                    <td><input type="text" name="event_field_map[<?php echo esc_attr($field); ?>]" value="<?php echo esc_attr((string) ($fmap[$field] ?? '')); ?>" placeholder="<?php esc_attr_e('existing meta key, e.g. event-date', 'october-events'); ?>" class="regular-text"></td>
                </tr>
            <?php endforeach; ?>
        </tbody></table>
        </div></details>

        <details class="oe-acc" id="pricing"><summary><?php esc_html_e('Tier pricing', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Amounts in your chosen currency. Leave 0 for free.', 'october-events'); ?></p>
        <table class="widefat striped" style="max-width:640px">
            <thead><tr><th><?php esc_html_e('Type', 'october-events'); ?></th><th><?php esc_html_e('Featured', 'october-events'); ?></th><th><?php esc_html_e('Premium', 'october-events'); ?></th></tr></thead>
            <tbody>
            <?php foreach (PostTypes::listing_types() as $type) :
                $featured = (int) ($cfg['pricing'][$type]['featured'] ?? 0) / 100;
                $premium  = (int) ($cfg['pricing'][$type]['premium'] ?? 0) / 100; ?>
                <tr>
                    <td><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></td>
                    <td><input type="number" step="0.01" min="0" name="pricing[<?php echo esc_attr($type); ?>][featured]" value="<?php echo esc_attr((string) $featured); ?>"></td>
                    <td><input type="number" step="0.01" min="0" name="pricing[<?php echo esc_attr($type); ?>][premium]" value="<?php echo esc_attr((string) $premium); ?>"></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p><label><?php esc_html_e('Currency', 'october-events'); ?> <input type="text" name="currency" value="<?php echo esc_attr((string) ($cfg['currency'] ?? 'usd')); ?>" size="5"></label></p>
        </div></details>

        <details class="oe-acc" id="rejection"><summary><?php esc_html_e('Rejection email copy', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Optional per-type overrides. Variables: {listing_name}, {listing_type}, {refund_amount}. Leave blank to use the default copy.', 'october-events'); ?></p>
        <?php foreach (PostTypes::listing_types() as $type) : ?>
            <p><label><strong><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></strong><br>
                <textarea name="rejection_copy[<?php echo esc_attr($type); ?>]" rows="3" class="large-text"><?php echo esc_textarea((string) ($cfg['rejection_copy'][$type] ?? '')); ?></textarea></label></p>
        <?php endforeach; ?>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="ai">
        <details class="oe-acc" id="voice"><summary><?php esc_html_e('AI Stories connector', 'october-events'); ?></summary><div class="oe-acc-body">
        <p><label><?php esc_html_e('Model', 'october-events'); ?><br><input type="text" name="ai_model" class="regular-text" value="<?php echo esc_attr((string) ($cfg['ai_model'] ?? '')); ?>"></label></p>
        <p><label><?php esc_html_e('Source URLs (one per line, RSS preferred)', 'october-events'); ?><br>
            <textarea name="ai_source_urls" rows="5" class="large-text"><?php echo esc_textarea(implode("\n", (array) ($cfg['ai_source_urls'] ?? []))); ?></textarea></label></p>

        <h3><?php esc_html_e('Tone of voice training', 'october-events'); ?></h3>
        <p class="description"><?php esc_html_e('This is how you "train" the AI. The style guide and examples below are sent to Claude with every story it writes, steering it to sound like ADF. Be specific about voice, rhythm, vocabulary, and what to avoid.', 'october-events'); ?></p>
        <p><label><strong><?php esc_html_e('House style guide', 'october-events'); ?></strong><br>
            <textarea name="ai_voice_guide" rows="8" class="large-text" placeholder="<?php esc_attr_e('e.g. Write in third person. Lead with the design idea, not the event. Favour concrete nouns over adjectives. Never use words like “stunning”, “must-see”, “game-changing”. UK/US spelling: US. Reference Atlanta neighbourhoods by name where relevant…', 'october-events'); ?>"><?php echo esc_textarea((string) ($cfg['ai_voice_guide'] ?? '')); ?></textarea></label></p>
        <p><label><strong><?php esc_html_e('Example pieces', 'october-events'); ?></strong> — <?php esc_html_e('paste 1–4 published pieces that exemplify the voice, separated by a line containing only ---', 'october-events'); ?><br>
            <textarea name="ai_examples" rows="12" class="large-text" placeholder="<?php esc_attr_e("Headline of a great ADF piece\nFull body text in the ADF voice…\n---\nAnother example headline\nIts body text…", 'october-events'); ?>"><?php echo esc_textarea(implode("\n---\n", (array) ($cfg['ai_examples'] ?? []))); ?></textarea></label></p>
        <p class="description"><?php echo esc_html(sprintf(/* translators: %d: count */ __('Currently %d example(s) saved.', 'october-events'), count((array) ($cfg['ai_examples'] ?? [])))); ?></p>
        </div></details>

        <details class="oe-acc" id="support-chat"><summary><?php esc_html_e('AI support chat (customers)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('A floating chat on your public site that answers customers’ questions about their own orders and tickets. Customers verify with a one-time code emailed to them, so they only ever see their own data. Requires a Claude API key.', 'october-events'); ?></p>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><?php esc_html_e('Enable widget', 'october-events'); ?></th>
                <td><label><input type="checkbox" name="support_chat_enabled" value="1" <?php checked((string) ($cfg['support_chat_enabled'] ?? '0'), '1'); ?>>
                    <?php esc_html_e('Show the “Need help?” chat on every front-end page', 'october-events'); ?></label>
                    <p class="description"><?php esc_html_e('You can also embed it inline anywhere with the [oe_support_chat] shortcode.', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="theme">
        <details class="oe-acc" id="branding"><summary><?php esc_html_e('Branding (platform theme)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Brand colours and logo for this site’s tickets and confirmation emails. Leave any field blank to use the built-in October defaults (Brockmann + brand yellow). The site display name comes from Brand, above.', 'october-events'); ?></p>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><label><?php esc_html_e('Accent colour', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_accent" value="<?php echo esc_attr((string) ($cfg['theme_accent'] ?? '')); ?>" placeholder="#E7CD41" class="regular-text">
                    <p class="description"><?php esc_html_e('Buttons, active nav, highlights.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Text on accent', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_accent_on" value="<?php echo esc_attr((string) ($cfg['theme_accent_on'] ?? '')); ?>" placeholder="#1a1a1a" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Sidebar colour', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_sidebar_bg" value="<?php echo esc_attr((string) ($cfg['theme_sidebar_bg'] ?? '')); ?>" placeholder="#0b0b0c" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Page background', 'october-events'); ?></label></th>
                <td><input type="text" name="theme_page_bg" value="<?php echo esc_attr((string) ($cfg['theme_page_bg'] ?? '')); ?>" placeholder="#faf9f5" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Logo — light surfaces', 'october-events'); ?></label></th>
                <td><input type="url" name="theme_logo_light" value="<?php echo esc_attr((string) ($cfg['theme_logo_light'] ?? '')); ?>" placeholder="https://…/logo-dark.png" class="regular-text">
                    <p class="description"><?php esc_html_e('Shown on the white login card. Paste a Media Library URL.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Logo — dark sidebar', 'october-events'); ?></label></th>
                <td><input type="url" name="theme_logo_dark" value="<?php echo esc_attr((string) ($cfg['theme_logo_dark'] ?? '')); ?>" placeholder="https://…/logo-light.png" class="regular-text">
                    <p class="description"><?php esc_html_e('Shown in the dark sidebar (use a light/white version).', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Custom font — family name', 'october-events'); ?></label></th>
                <td><input type="text" id="oe-font-family" name="theme_font_family" value="<?php echo esc_attr((string) ($cfg['theme_font_family'] ?? '')); ?>" placeholder="e.g. Söhne" class="regular-text">
                    <p class="description"><?php esc_html_e('The name to reference the font by. Blank = Brockmann (the October default).', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Body font file (regular)', 'october-events'); ?></label></th>
                <td>
                    <input type="url" id="oe-font-url" name="theme_font_url" value="<?php echo esc_attr((string) ($cfg['theme_font_url'] ?? '')); ?>" placeholder="https://…/font-regular.woff2" class="regular-text" style="vertical-align:middle">
                    <button type="button" class="button oe-font-pick" data-target="oe-font-url"><?php esc_html_e('Upload / choose', 'october-events'); ?></button>
                    <button type="button" class="button oe-font-clear" data-target="oe-font-url"><?php esc_html_e('Clear', 'october-events'); ?></button>
                    <p class="description"><?php esc_html_e('The regular weight, used for body text. .woff2 / .woff / .ttf / .otf — self-hosted, no Google Fonts needed.', 'october-events'); ?></p>
                </td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Heading font file (bold)', 'october-events'); ?></label></th>
                <td>
                    <input type="url" id="oe-font-url-bold" name="theme_font_url_bold" value="<?php echo esc_attr((string) ($cfg['theme_font_url_bold'] ?? '')); ?>" placeholder="https://…/font-bold.woff2" class="regular-text" style="vertical-align:middle">
                    <button type="button" class="button oe-font-pick" data-target="oe-font-url-bold"><?php esc_html_e('Upload / choose', 'october-events'); ?></button>
                    <button type="button" class="button oe-font-clear" data-target="oe-font-url-bold"><?php esc_html_e('Clear', 'october-events'); ?></button>
                    <p class="description"><?php esc_html_e('The bold weight, used for headings — easier to read. Leave blank to use the regular file for everything.', 'october-events'); ?></p>
                </td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('…or a stylesheet URL', 'october-events'); ?></label></th>
                <td><input type="url" name="theme_font_css" value="<?php echo esc_attr((string) ($cfg['theme_font_css'] ?? '')); ?>" placeholder="https://fonts.googleapis.com/css2?family=Inter…" class="regular-text">
                    <p class="description"><?php esc_html_e('Alternative to uploading: a CSS URL that already defines the font (e.g. Google Fonts, Adobe Fonts).', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>
        <script>
        jQuery(function ($) {
            var frame;
            $('.oe-font-pick').on('click', function (e) {
                e.preventDefault();
                var target = $(this).data('target');
                frame = wp.media({ title: 'Choose a font file', library: {}, multiple: false, button: { text: 'Use this font' } });
                frame.on('select', function () {
                    var a = frame.state().get('selection').first().toJSON();
                    $('#' + target).val(a.url);
                });
                frame.open();
            });
            $('.oe-font-clear').on('click', function (e) { e.preventDefault(); $('#' + $(this).data('target')).val(''); });
        });
        </script>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="keys">
        <details class="oe-acc" id="api-keys"><summary><?php esc_html_e('API keys', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Enter your keys here, or define them as constants in wp-config.php (a constant always wins and locks the field). Stored keys are encrypted in the database.', 'october-events'); ?></p>
        <?php
        $labels = [
            'stripe_publishable_key' => __('Stripe publishable key', 'october-events'),
            'stripe_secret_key'      => __('Stripe secret key', 'october-events'),
            'stripe_webhook_secret'  => __('Stripe webhook secret', 'october-events'),
            'paypal_client_secret'   => __('PayPal client secret', 'october-events'),
            'claude_api_key'         => __('Claude API key', 'october-events'),
            'google_maps_key'        => __('Google Maps key', 'october-events'),
        ];
        // Where to get each key + what to paste. The webhook hint shows this site's
        // live endpoint URL and the exact events to send.
        $hints = [
            'stripe_publishable_key' => __('Stripe → Developers → API keys → “Publishable key” (starts pk_). Safe to expose; used by the checkout form.', 'october-events'),
            'stripe_secret_key'      => __('Stripe → Developers → API keys → “Secret key” (starts sk_). Keep private; used server-side for charges & refunds.', 'october-events'),
            'stripe_webhook_secret'  => sprintf(
                /* translators: 1: endpoint URL, 2: events */
                __('Stripe → Developers → Webhooks → Add endpoint. URL: %1$s — send these events: %2$s. Then copy the endpoint’s “Signing secret” (starts whsec_) here. Without it, ticket webhooks are rejected.', 'october-events'),
                '<code>' . esc_html($webhook_url) . '</code>',
                '<code>payment_intent.succeeded</code>, <code>charge.refunded</code>'
            ),
            'paypal_client_secret'   => __('PayPal Developer dashboard → your app → “Secret”. Used server-side to capture & refund. Enable PayPal and set the Client ID / environment under the Tickets section.', 'october-events'),
            'claude_api_key'         => __('console.anthropic.com → API keys (starts sk-ant-). Powers the staff assistant, the email co-pilot and the customer support chat.', 'october-events'),
            'google_maps_key'        => __('Google Cloud Console → APIs & Services → Credentials → API key, with “Maps JavaScript API” enabled. Used by the [oe_design_map] shortcode.', 'october-events'),
        ];
        ?>
        <?php if ($key_errors = get_transient('oe_settings_key_errors')) : delete_transient('oe_settings_key_errors'); ?>
            <div class="notice notice-error" style="margin:0 0 12px"><p>
                <strong><?php esc_html_e('Some keys weren’t saved.', 'october-events'); ?></strong>
                <?php printf(
                    /* translators: %s: list of "label (must start with prefix)" */
                    esc_html__('These didn’t look right and were left unchanged: %s. A common cause is the browser autofilling your login password into a key field — re-enter the key manually.', 'october-events'),
                    esc_html(implode('; ', array_map(static function ($k, $p) use ($labels) {
                        return ($labels[$k] ?? $k) . ' (' . sprintf(__('must start with %s', 'october-events'), $p) . ')';
                    }, array_keys((array) $key_errors), (array) $key_errors)))
                ); ?>
            </p></div>
        <?php endif; ?>
        <table class="form-table" style="max-width:720px">
            <?php foreach ($secrets as $key => $const) :
                $is_const = \OE\Settings::secret_is_constant($key);
                // Never echo the secret back; just whether one is saved.
                $is_set   = ! $is_const && (string) \OE\Settings::get($key, '') !== '';
                ?>
                <tr>
                    <th scope="row"><label for="oe-sec-<?php echo esc_attr($key); ?>"><?php echo esc_html($labels[$key] ?? $key); ?></label></th>
                    <td>
                        <?php if ($is_const) : ?>
                            <input type="text" class="regular-text" value="••••••••••" disabled>
                            <p class="description"><?php printf(/* translators: %s: constant */ esc_html__('Locked — defined by the %s constant in wp-config.php.', 'october-events'), '<code>' . esc_html($const) . '</code>'); ?></p>
                        <?php else : ?>
                            <span class="oe-secret-wrap">
                                <input type="password" id="oe-sec-<?php echo esc_attr($key); ?>" class="regular-text oe-secret" name="secret_<?php echo esc_attr($key); ?>" value="" placeholder="<?php echo $is_set ? esc_attr__('•••••••• saved — leave blank to keep', 'october-events') : ''; ?>" <?php if ($is_set) : ?>data-reveal="<?php echo esc_attr($key); ?>"<?php endif; ?> autocomplete="new-password" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other">
                                <button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>" title="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button>
                            </span>
                        <?php endif; ?>
                        <?php if (! empty($hints[$key])) : ?>
                            <p class="description oe-keyhint"><?php echo wp_kses($hints[$key], ['code' => []]); ?></p>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </table>
        </div></details>

        <details class="oe-acc" id="platform"><summary><?php esc_html_e('Staff platform', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Origins allowed to call this site\'s oe/v1 REST API from the browser — i.e. the staff platform SPA. One per line, scheme + host with no trailing slash. Leave the defaults if unsure.', 'october-events'); ?></p>
        <?php $origins = (array) ($cfg['platform_origins'] ?? []); ?>
        <p><textarea name="platform_origins" rows="3" class="large-text code" placeholder="https://october-platform.pages.dev"><?php echo esc_textarea(implode("\n", $origins)); ?></textarea></p>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><label><?php esc_html_e('Platform URL', 'october-events'); ?></label></th>
                <td><input type="url" name="platform_url" value="<?php echo esc_attr((string) ($cfg['platform_url'] ?? '')); ?>" placeholder="https://platform.atlantadesignfestival.net" class="regular-text">
                    <p class="description"><?php esc_html_e('Used for the “Open the platform” button in wp-admin. Blank = the first non-pages.dev origin above.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Check-in scanner page', 'october-events'); ?></label></th>
                <td><input type="url" name="checkin_page_url" value="<?php echo esc_attr((string) ($cfg['checkin_page_url'] ?? '')); ?>" placeholder="https://your-site.com/check-in/" class="regular-text">
                    <p class="description"><?php esc_html_e('The page where you placed the [oe_checkin] shortcode. When set, a “Scan tickets” button appears on the Dashboard and Tickets screens.', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="checkout">
        <details class="oe-acc" id="checkout" open><summary><?php esc_html_e('Checkout & tickets', 'october-events'); ?></summary><div class="oe-acc-body">
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><label><?php esc_html_e('Terms & Conditions URL', 'october-events'); ?></label></th>
                <td><input type="url" name="checkout_terms_url" value="<?php echo esc_attr((string) ($cfg['checkout_terms_url'] ?? '')); ?>" placeholder="https://your-site.com/terms/" class="regular-text">
                    <p class="description"><?php esc_html_e('When set, the ticket checkout shows a required “I agree to the Terms & Conditions” checkbox linking here.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><?php esc_html_e('Pre-event reminder', 'october-events'); ?></th>
                <td>
                    <label><input type="checkbox" name="attendee_reminder_enabled" value="1" <?php checked((bool) ($cfg['attendee_reminder_enabled'] ?? true)); ?>> <?php esc_html_e('Email ticket-holders a reminder before the event', 'october-events'); ?></label>
                    <p style="margin:8px 0 0"><label><?php esc_html_e('Send', 'october-events'); ?>
                        <input type="number" name="attendee_reminder_hours" min="1" max="168" value="<?php echo esc_attr((string) ($cfg['attendee_reminder_hours'] ?? 24)); ?>" style="width:70px"> <?php esc_html_e('hours before the start time.', 'october-events'); ?></label></p>
                    <p class="description"><?php esc_html_e('Sent once per event to everyone with an active ticket, with an “add to calendar” file attached. Requires the event’s start date to be set (or mapped under Event field mapping).', 'october-events'); ?></p>
                </td>
            </tr>
            <tr>
                <th scope="row"><?php esc_html_e('PayPal', 'october-events'); ?></th>
                <td>
                    <label><input type="checkbox" name="paypal_enabled" value="1" <?php checked((bool) ($cfg['paypal_enabled'] ?? false)); ?>> <?php esc_html_e('Offer PayPal at checkout (alongside card)', 'october-events'); ?></label>
                    <p style="margin:8px 0 0"><label><?php esc_html_e('Environment', 'october-events'); ?>
                        <select name="paypal_env">
                            <option value="sandbox" <?php selected(($cfg['paypal_env'] ?? 'sandbox'), 'sandbox'); ?>><?php esc_html_e('Sandbox (testing)', 'october-events'); ?></option>
                            <option value="live" <?php selected(($cfg['paypal_env'] ?? 'sandbox'), 'live'); ?>><?php esc_html_e('Live', 'october-events'); ?></option>
                        </select></label></p>
                    <p style="margin:8px 0 0"><label><?php esc_html_e('Client ID', 'october-events'); ?><br>
                        <input type="text" name="paypal_client_id" value="<?php echo esc_attr((string) ($cfg['paypal_client_id'] ?? '')); ?>" class="regular-text code" autocomplete="off" spellcheck="false"></label></p>
                    <p class="description"><?php esc_html_e('From the PayPal Developer dashboard (matching the environment above). Add the Client secret under the API keys section. Until all three are set, PayPal stays hidden and card checkout is unaffected.', 'october-events'); ?></p>
                </td>
            </tr>
        </tbody></table>
        </div></details>

        <details class="oe-acc" id="membership"><summary><?php esc_html_e('Membership (early access)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Members are detected from your Stripe subscriptions. Paste a Stripe product ID (starts prod_…) to count everyone subscribed to that product (e.g. the Friend product covers both its monthly and yearly prices), or a specific price ID (starts price_…) to count just that one. One per line. Anyone with a live subscription matching any of these counts as an active member. Find them in Stripe → Products. Leave off until you’re ready.', 'october-events'); ?></p>
        <p><label><input type="checkbox" name="membership_enabled" value="1" <?php checked(! empty($cfg['membership_enabled'])); ?>> <strong><?php esc_html_e('Enable membership features (member detection & rates at checkout)', 'october-events'); ?></strong></label></p>
        <p><label><strong><?php esc_html_e('Membership product / price IDs', 'october-events'); ?></strong> — <span class="description"><?php esc_html_e('one per line — a prod_… covers all its prices, a price_… is that exact one', 'october-events'); ?></span><br>
            <textarea name="membership_price_ids" rows="4" class="large-text code" placeholder="prod_FriendMembership&#10;prod_PatronMembership"><?php echo esc_textarea(implode("\n", (array) ($cfg['membership_price_ids'] ?? []))); ?></textarea></label></p>

        <h4 style="margin:16px 0 6px"><?php esc_html_e('Join offer (for member-only ticket rates)', 'october-events'); ?></h4>
        <p class="description"><?php esc_html_e('When a ticket type is marked "Members" and a non-member tries to buy it, the checkout offers them the chance to join. Paste the Stripe Payment Link for the plan you want to promote (e.g. Friend monthly, $5/mo). Leave blank to hide the offer (member-only rates then simply stay locked to non-members).', 'october-events'); ?></p>
        <p><label><strong><?php esc_html_e('Membership join link', 'october-events'); ?></strong><br>
            <input type="url" name="membership_join_url" class="large-text code" value="<?php echo esc_attr((string) ($cfg['membership_join_url'] ?? '')); ?>" placeholder="https://buy.stripe.com/…"></label></p>
        <p><label><strong><?php esc_html_e('Join button label', 'october-events'); ?></strong> — <span class="description"><?php esc_html_e('shown on the offer button', 'october-events'); ?></span><br>
            <input type="text" name="membership_join_label" class="regular-text" value="<?php echo esc_attr((string) ($cfg['membership_join_label'] ?? '')); ?>" placeholder="<?php esc_attr_e('Join as a Friend — $5/mo', 'october-events'); ?>"></label></p>

        <h4 style="margin:16px 0 6px"><?php esc_html_e('Test: is this email a member?', 'october-events'); ?></h4>
        <p><?php esc_html_e('Check a known member’s email to confirm your price IDs resolve in Stripe.', 'october-events'); ?></p>
        <p><input type="email" id="oe-mem-email" class="regular-text" placeholder="member@example.com">
            <button type="button" class="button" id="oe-mem-check"><?php esc_html_e('Check membership', 'october-events'); ?></button>
            <span id="oe-mem-result" style="margin-left:10px;font-weight:600"></span></p>
        <script>
        (function(){
            var NONCE = <?php echo wp_json_encode(wp_create_nonce('oe_check_membership')); ?>;
            var btn = document.getElementById('oe-mem-check'),
                inp = document.getElementById('oe-mem-email'),
                out = document.getElementById('oe-mem-result');
            if (!btn) { return; }
            btn.addEventListener('click', function(){
                out.style.color = '#50575e'; out.textContent = '…';
                var body = new URLSearchParams({ action: 'oe_check_membership', nonce: NONCE, email: inp.value });
                fetch(ajaxurl, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body.toString() })
                    .then(function(r){ return r.json(); })
                    .then(function(j){
                        if (j && j.success) { out.style.color = j.data.active ? '#008a20' : '#b32d2e'; out.textContent = j.data.message; }
                        else { out.style.color = '#b32d2e'; out.textContent = (j && j.data && j.data.message) || 'Error'; }
                    })
                    .catch(function(){ out.style.color = '#b32d2e'; out.textContent = 'Error'; });
            });
        })();
        </script>
        </div></details>
        </section>

        <section class="oe-set-panel" data-tab="emailsms">
        <details class="oe-acc" id="email"><summary><?php esc_html_e('Email sending (Amazon SES)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Route all site email through Amazon SES (SMTP). Off by default — until enabled and fully configured, the site keeps using its current mail transport. Generate SMTP credentials in the SES console (they are not your AWS keys).', 'october-events'); ?></p>
        <?php $ses_active = \OE\Mail\Mailer::ses_active(); $mc = \OE\Mail\EmailLog::counts(); ?>
        <p style="margin:0 0 10px"><?php esc_html_e('Current transport:', 'october-events'); ?>
            <strong style="color:<?php echo $ses_active ? '#1a7f37' : '#8a6d3b'; ?>"><?php echo $ses_active ? esc_html(sprintf(__('Amazon SES (%s)', 'october-events'), \OE\Mail\Mailer::smtp_host())) : esc_html__('Site default', 'october-events'); ?></strong>
            &nbsp;·&nbsp; <?php echo esc_html(sprintf(__('%1$d sent / %2$d failed / %3$d suppressed', 'october-events'), $mc['sent'], $mc['failed'], $mc['suppressed'])); ?>
            &nbsp;·&nbsp; <a href="#email-tools"><?php esc_html_e('Email tools (test, digest, log)', 'october-events'); ?></a></p>
        <?php $ses_pw_const = \OE\Settings::secret_is_constant('ses_smtp_password'); ?>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><?php esc_html_e('Enable SES', 'october-events'); ?></th>
                <td><label><input type="checkbox" name="ses_enabled" value="1" <?php checked((bool) ($cfg['ses_enabled'] ?? false)); ?>> <?php esc_html_e('Send all site email via Amazon SES', 'october-events'); ?></label></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('AWS region', 'october-events'); ?></label></th>
                <td><input type="text" name="ses_region" value="<?php echo esc_attr((string) ($cfg['ses_region'] ?? 'us-east-1')); ?>" placeholder="us-east-1" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('SMTP username', 'october-events'); ?></label></th>
                <td><input type="text" name="ses_smtp_user" value="<?php echo esc_attr((string) ($cfg['ses_smtp_user'] ?? '')); ?>" autocomplete="off" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('SMTP password', 'october-events'); ?></label></th>
                <td><span class="oe-secret-wrap">
                    <input type="password" name="ses_smtp_password" class="regular-text oe-secret" autocomplete="off" value="" <?php echo $ses_pw_const ? 'disabled placeholder="Set via OE_SES_SMTP_PASSWORD constant"' : (trim((string) ($cfg['ses_smtp_password'] ?? '')) !== '' ? 'data-reveal="ses_smtp_password" placeholder="•••••••• saved — leave blank to keep"' : ''); ?>>
                    <?php if (! $ses_pw_const) : ?><button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
                </span></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('From address', 'october-events'); ?></label></th>
                <td><input type="email" name="mail_from_email" value="<?php echo esc_attr((string) ($cfg['mail_from_email'] ?? '')); ?>" placeholder="hello@news.atlantadesignfestival.net" class="regular-text">
                    <p class="description"><?php esc_html_e('Must be a verified SES sender/domain.', 'october-events'); ?></p></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('From name', 'october-events'); ?></label></th>
                <td><input type="text" name="mail_from_name" value="<?php echo esc_attr((string) ($cfg['mail_from_name'] ?? '')); ?>" placeholder="Atlanta Design Festival" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Footer postal address', 'october-events'); ?></label></th>
                <td><textarea name="mail_footer_address" rows="2" class="large-text" placeholder="Atlanta Design Festival, 123 Example St, Atlanta, GA 30303"><?php echo esc_textarea((string) ($cfg['mail_footer_address'] ?? '')); ?></textarea>
                    <p class="description"><?php esc_html_e('Shown in campaign footers (required by CAN-SPAM).', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>
        </div></details>

        <details class="oe-acc" id="digest"><summary><?php esc_html_e('Newsletter & reports', 'october-events'); ?></summary><div class="oe-acc-body">
        <?php if (\OE\Cron::DIGEST_ENABLED) : ?>
            <div style="border:1px solid #dba617;background:#fcf9e8;border-radius:6px;padding:12px 14px;margin:0 0 18px">
                <p style="margin:0 0 6px;font-size:14px"><strong><?php esc_html_e('Monthly newsletter digest', 'october-events'); ?></strong>
                    <span style="display:inline-block;margin-left:8px;background:#dba617;color:#1d2327;font-size:11px;font-weight:700;padding:1px 8px;border-radius:10px;vertical-align:middle"><?php esc_html_e('EMAILS ALL SUBSCRIBERS', 'october-events'); ?></span></p>
                <p class="description" style="margin:0 0 10px"><?php esc_html_e('A “what’s on” email to every subscribed contact: recent stories, events in the next 30 days, and any listings flagged “feature in email”. At most once per calendar month.', 'october-events'); ?></p>
                <p style="margin:0"><label><input type="checkbox" name="digest_enabled" value="1" <?php checked(! empty($cfg['digest_enabled'])); ?>> <strong><?php esc_html_e('Send it automatically on the first Monday of each month', 'october-events'); ?></strong></label></p>
            </div>
        <?php else : ?>
            <div style="border:1px solid #dcdcde;background:#f6f7f7;border-radius:6px;padding:12px 14px;margin:0 0 18px">
                <p style="margin:0 0 4px;font-size:14px"><strong><?php esc_html_e('Monthly newsletter digest', 'october-events'); ?></strong>
                    <span style="display:inline-block;margin-left:8px;background:#dcdcde;color:#50575e;font-size:11px;font-weight:700;padding:1px 8px;border-radius:10px;vertical-align:middle"><?php esc_html_e('COMING SOON — SWITCHED OFF', 'october-events'); ?></span></p>
                <p class="description" style="margin:0"><?php esc_html_e('The subscriber newsletter isn’t ready yet, so it’s fully disabled — it cannot send, automatically or manually. It’ll be switched on once the content, design and subject are set up.', 'october-events'); ?></p>
            </div>
        <?php endif; ?>

        <div style="border:1px solid #dcdcde;border-radius:6px;padding:12px 14px">
            <p style="margin:0 0 6px;font-size:14px"><strong><?php esc_html_e('Daily ticket sales report', 'october-events'); ?></strong>
                <span style="display:inline-block;margin-left:8px;background:#f0f0f1;color:#50575e;font-size:11px;font-weight:700;padding:1px 8px;border-radius:10px;vertical-align:middle"><?php esc_html_e('INTERNAL — TO YOU ONLY', 'october-events'); ?></span></p>
            <p class="description" style="margin:0 0 10px"><?php esc_html_e('A short summary of the day’s ticket sales, sent to one internal address — never to subscribers. Only sends on days with sales.', 'october-events'); ?></p>
            <p style="margin:0"><label><?php esc_html_e('Email the report to', 'october-events'); ?> <input type="email" name="report_email" value="<?php echo esc_attr((string) ($cfg['report_email'] ?? '')); ?>" class="regular-text" placeholder="<?php echo esc_attr(get_option('admin_email')); ?>"></label> <span class="description"><?php esc_html_e('Blank = site admin.', 'october-events'); ?></span></p>
        </div>
        </div></details>

        <?php if (\OE\Features::enabled('volunteers')) : ?>
        <details class="oe-acc" id="reminders"><summary><?php esc_html_e('Volunteer reminders', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Email reminders always send. SMS is optional (see the SMS section) and only goes to volunteers who provided a mobile and opted in.', 'october-events'); ?></p>
        <p><strong><?php esc_html_e('Send reminders:', 'october-events'); ?></strong></p>
        <?php $offsets = (array) ($cfg['reminder_offsets'] ?? []); ?>
        <p>
            <label><input type="checkbox" name="reminder_offsets[week]" value="1" <?php checked(in_array('week', $offsets, true)); ?>> <?php esc_html_e('1 week before', 'october-events'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[48h]" value="1" <?php checked(in_array('48h', $offsets, true)); ?>> <?php esc_html_e('48 hours before', 'october-events'); ?></label><br>
            <label><input type="checkbox" name="reminder_offsets[morning]" value="1" <?php checked(in_array('morning', $offsets, true)); ?>> <?php esc_html_e('Morning of (≈3h before)', 'october-events'); ?></label>
        </p>
        <p class="description"><?php esc_html_e('A confirmation always sends immediately on signup.', 'october-events'); ?></p>
        </div></details>

        <?php endif; ?>
        <details class="oe-acc" id="sms"><summary><?php esc_html_e('SMS (AWS End User Messaging)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Optional. Sends volunteer-reminder texts via AWS. Off until enabled and configured. US sending requires a registered 10DLC origination number.', 'october-events'); ?></p>
        <?php $aws_pw_const = \OE\Settings::secret_is_constant('aws_secret_access_key'); ?>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><?php esc_html_e('Enable SMS', 'october-events'); ?></th>
                <td><label><input type="checkbox" name="sms_enabled" value="1" <?php checked((bool) ($cfg['sms_enabled'] ?? false)); ?>> <?php esc_html_e('Send volunteer reminders by SMS', 'october-events'); ?></label></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('AWS region', 'october-events'); ?></label></th>
                <td><input type="text" name="sms_region" value="<?php echo esc_attr((string) ($cfg['sms_region'] ?? 'us-east-1')); ?>" placeholder="us-east-1" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('AWS access key ID', 'october-events'); ?></label></th>
                <td><input type="text" name="aws_access_key_id" value="<?php echo esc_attr((string) ($cfg['aws_access_key_id'] ?? '')); ?>" autocomplete="off" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('AWS secret access key', 'october-events'); ?></label></th>
                <td><span class="oe-secret-wrap">
                    <input type="password" name="aws_secret_access_key" class="regular-text oe-secret" autocomplete="off" value="" <?php echo $aws_pw_const ? 'disabled placeholder="Set via OE_AWS_SECRET_ACCESS_KEY constant"' : (trim((string) ($cfg['aws_secret_access_key'] ?? '')) !== '' ? 'data-reveal="aws_secret_access_key" placeholder="•••••••• saved — leave blank to keep"' : ''); ?>>
                    <?php if (! $aws_pw_const) : ?><button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
                </span></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Origination identity', 'october-events'); ?></label></th>
                <td><input type="text" name="sms_origination" value="<?php echo esc_attr((string) ($cfg['sms_origination'] ?? '')); ?>" placeholder="+18005551234 / sender ID / pool ARN" class="regular-text">
                    <p class="description"><?php esc_html_e('Your registered phone number (E.164), sender ID, or pool ARN.', 'october-events'); ?></p></td>
            </tr>
        </tbody></table>
        </div></details>

        <details class="oe-acc" id="chat"><summary><?php esc_html_e('Live chat (Chatwoot)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('Optional. Paste your self-hosted Chatwoot base URL and website token to inject the chat widget site-wide. Also used as the “Talk to a person” hand-off from the AI support chat. Leave blank for no live chat.', 'october-events'); ?></p>
        <table class="form-table" role="presentation"><tbody>
            <tr>
                <th scope="row"><label><?php esc_html_e('Chatwoot base URL', 'october-events'); ?></label></th>
                <td><input type="url" name="chatwoot_base_url" value="<?php echo esc_attr((string) ($cfg['chatwoot_base_url'] ?? '')); ?>" placeholder="https://chat.example.com" class="regular-text"></td>
            </tr>
            <tr>
                <th scope="row"><label><?php esc_html_e('Website token', 'october-events'); ?></label></th>
                <td><input type="text" name="chatwoot_token" value="<?php echo esc_attr((string) ($cfg['chatwoot_token'] ?? '')); ?>" autocomplete="off" class="regular-text"></td>
            </tr>
        </tbody></table>
        </div></details>

        </section>
        <section class="oe-set-panel" data-tab="updates">
        <details class="oe-acc" id="updates"><summary><?php esc_html_e('Updates (GitHub)', 'october-events'); ?></summary><div class="oe-acc-body">
        <p class="description"><?php esc_html_e('New versions are published as GitHub Releases tagged oe-v<version> and offered in Dashboard → Updates. Provide a fine-grained token with Contents: read (or define OE_GITHUB_TOKEN in wp-config.php).', 'october-events'); ?></p>
        <p><label><?php esc_html_e('Repository', 'october-events'); ?> <input type="text" name="github_repo" class="regular-text" value="<?php echo esc_attr((string) ($cfg['github_repo'] ?? 'octobercomms/claude')); ?>"></label></p>
        <?php $token_const = defined('OE_GITHUB_TOKEN') && OE_GITHUB_TOKEN; ?>
        <p><label><?php esc_html_e('GitHub token', 'october-events'); ?></label><br>
            <span class="oe-secret-wrap">
                <input type="password" name="github_token" class="regular-text oe-secret" autocomplete="off" value="" <?php echo $token_const ? 'disabled placeholder="Set via OE_GITHUB_TOKEN constant"' : (trim((string) ($cfg['github_token'] ?? '')) !== '' ? 'data-reveal="github_token" placeholder="•••••••• saved — leave blank to keep"' : ''); ?>>
                <?php if (! $token_const) : ?><button type="button" class="button oe-secret-toggle" aria-label="<?php esc_attr_e('Show / hide', 'october-events'); ?>"><span class="dashicons dashicons-visibility"></span></button><?php endif; ?>
            </span></p>
        </div></details>

        </section>
        </div><!-- /.oe-set-main -->
        </div><!-- /.oe-set -->

        <?php submit_button(); ?>
    </form>

    <details class="oe-acc" id="email-tools"><summary><?php esc_html_e('Email tools — test, digest & log', 'october-events'); ?></summary><div class="oe-acc-body">
        <?php $test = get_transient('oe_mail_test'); if (is_array($test)) { delete_transient('oe_mail_test'); ?>
            <div class="notice <?php echo $test['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin:0 0 12px;padding:10px 12px">
                <?php echo $test['ok']
                    ? esc_html(sprintf(__('Test email sent to %s.', 'october-events'), $test['to']))
                    : esc_html(sprintf(__('Could not send the test email to %s — check the log below and your SES config.', 'october-events'), $test['to'])); ?>
            </div>
        <?php } ?>
        <?php if (! empty($_GET['digest']) && $_GET['digest'] === 'sent') : ?>
            <div class="notice notice-success" style="margin:0 0 12px;padding:10px 12px"><?php esc_html_e('Monthly digest queued.', 'october-events'); ?></div>
        <?php elseif (! empty($_GET['digest']) && $_GET['digest'] === 'already') : ?>
            <div class="notice notice-warning" style="margin:0 0 12px;padding:10px 12px"><?php esc_html_e('The digest has already been sent this month — not sending again. (It’s locked to once per calendar month.)', 'october-events'); ?></div>
        <?php endif; ?>

        <h3><?php esc_html_e('Send a test email', 'october-events'); ?></h3>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-bottom:14px">
            <input type="hidden" name="action" value="oe_send_test_email">
            <?php wp_nonce_field('oe_send_test_email'); ?>
            <input type="email" name="oe_test_to" class="regular-text" placeholder="<?php echo esc_attr((string) get_option('admin_email')); ?>">
            <?php submit_button(__('Send test email', 'october-events'), 'secondary', 'submit', false); ?>
        </form>

<?php if (\OE\Cron::DIGEST_ENABLED) : ?>
        <h3><?php esc_html_e('Monthly digest', 'october-events'); ?></h3>
        <p><?php esc_html_e('Emails every subscribed contact. Locked to once per calendar month — a second send this month is refused. Auto-send is controlled by the toggle in the Email & SMS settings (off by default).', 'october-events'); ?></p>
        <p><a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_send_digest'), 'oe_send_digest')); ?>" onclick="return confirm('<?php echo esc_js(__('Send the monthly digest to ALL subscribed contacts now? This can only be done once per month.', 'october-events')); ?>');"><?php esc_html_e('Send digest now', 'october-events'); ?></a></p>
<?php endif; ?>

        <h3><?php esc_html_e('Recent email log', 'october-events'); ?></h3>
        <?php $log = \OE\Mail\EmailLog::recent(15); if (! $log) : ?>
            <p class="description"><?php esc_html_e('No email logged yet.', 'october-events'); ?></p>
        <?php else : ?>
            <table class="widefat striped">
                <thead><tr>
                    <th><?php esc_html_e('When', 'october-events'); ?></th>
                    <th><?php esc_html_e('To', 'october-events'); ?></th>
                    <th><?php esc_html_e('Subject', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                    <th><?php esc_html_e('Via', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($log as $row) : ?>
                    <tr>
                        <td><?php echo esc_html(get_date_from_gmt((string) $row->created_at, 'M j, H:i')); ?></td>
                        <td><?php echo esc_html((string) $row->recipients); ?></td>
                        <td><?php echo esc_html((string) $row->subject); ?></td>
                        <td><strong style="color:<?php echo $row->status === 'sent' ? '#1a7f37' : ($row->status === 'failed' ? '#b32d2e' : '#8a6d3b'); ?>"><?php echo esc_html((string) $row->status); ?></strong>
                            <?php if ($row->error) : ?><br><span class="description"><?php echo esc_html(mb_substr((string) $row->error, 0, 120)); ?></span><?php endif; ?></td>
                        <td><?php echo esc_html((string) $row->driver); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div></details>

    <div class="oe-settings-cols">
    <div class="oe-col">
    <details class="oe-acc" id="voice-test"><summary><?php esc_html_e('Test the voice', 'october-events'); ?></summary><div class="oe-acc-body">
    <p class="description"><?php esc_html_e('Paste a sample source article (or any text) and run it through the trained editorial prompt to preview how a generated story would read. Save your style guide above first.', 'october-events'); ?></p>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_test_voice">
        <?php wp_nonce_field('oe_test_voice'); ?>
        <p><textarea name="oe_voice_sample" rows="6" class="large-text" placeholder="<?php esc_attr_e('Paste a source article here…', 'october-events'); ?>"></textarea></p>
        <?php submit_button(__('Generate preview', 'october-events'), 'primary', 'submit', false); ?>
    </form>
    <?php $voice = get_transient('oe_voice_test'); if (is_array($voice)) { delete_transient('oe_voice_test'); ?>
        <div class="notice <?php echo $voice['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px;padding:12px">
            <?php if (! empty($voice['skip']) || empty($voice['headline'])) : ?>
                <p><?php echo esc_html($voice['message'] ?? ''); ?></p>
            <?php else : ?>
                <p><strong><?php echo esc_html($voice['headline']); ?></strong></p>
                <div style="white-space:pre-wrap"><?php echo esc_html($voice['body']); ?></div>
            <?php endif; ?>
        </div>
    <?php } ?>
    </div></details>
    </div>
    <div class="oe-col">
    <details class="oe-acc" id="update-test"><summary><?php esc_html_e('Test update connection', 'october-events'); ?></summary><div class="oe-acc-body">
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
        <input type="hidden" name="action" value="oe_test_updater">
        <?php wp_nonce_field('oe_test_updater'); ?>
        <?php submit_button(__('Test update connection', 'october-events'), 'secondary', 'submit', false); ?>
    </form>
    <?php $diag = get_transient('oe_updater_diag'); if (is_array($diag)) { delete_transient('oe_updater_diag'); ?>
        <div class="notice <?php echo $diag['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin-top:10px"><p><?php echo esc_html($diag['message']); ?></p></div>
    <?php } ?>
    </div></details>
    </div>
    </div>

    <style>
        .oe-secret-wrap { display: inline-flex; align-items: center; gap: 4px; }
        .oe-secret-toggle { display: inline-flex !important; align-items: center; padding: 0 6px !important; }
        .oe-secret-toggle .dashicons { width: 18px; height: 18px; font-size: 18px; }
        /* Tabbed settings: left sub-nav + one panel at a time. */
        .oe-set { display: flex; gap: 24px; align-items: flex-start; margin-top: 12px; }
        .oe-set-nav { flex: 0 0 190px; position: sticky; top: 46px; display: flex; flex-direction: column; gap: 2px; }
        .oe-set-nav button { text-align: left; background: none; border: 0; border-left: 3px solid transparent; padding: 9px 12px; font: inherit; font-weight: 600; color: #50575e; cursor: pointer; border-radius: 0 6px 6px 0; }
        .oe-set-nav button:hover { background: #f0f0f1; color: #1d2327; }
        .oe-set-nav button.is-active { background: #fff; border-left-color: #2271b1; color: #1d2327; }
        .oe-set-main { flex: 1 1 auto; min-width: 0; max-width: 760px; }
        .oe-set-panel { display: none; }
        .oe-set-panel.is-active { display: block; }
        @media (max-width: 782px) { .oe-set { flex-direction: column; } .oe-set-nav { flex-direction: row; flex-wrap: wrap; position: static; } .oe-set-nav button { border-left: 0; border-radius: 6px; } }
    </style>
    <script>
    (function () {
        var REVEAL_NONCE = <?php echo wp_json_encode(wp_create_nonce('oe_reveal_secret')); ?>;
        document.querySelectorAll('.oe-secret-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var input = btn.parentNode.querySelector('input');
                var icon = btn.querySelector('.dashicons');
                if (!input) { return; }
                // Revealing a saved-but-empty secret: fetch its value once, on demand.
                var key = input.getAttribute('data-reveal');
                if (input.type === 'password' && key && input.value === '' && !input.dataset.fetched) {
                    input.dataset.fetched = '1';
                    var body = new URLSearchParams({ action: 'oe_reveal_secret', nonce: REVEAL_NONCE, key: key });
                    fetch(ajaxurl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
                        .then(function (r) { return r.json(); })
                        .then(function (j) { if (j && j.success && j.data) { input.value = j.data.value || ''; } })
                        .catch(function () { input.dataset.fetched = ''; });
                }
                var show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                if (icon) { icon.classList.toggle('dashicons-visibility', !show); icon.classList.toggle('dashicons-hidden', show); }
            });
        });
        // Stop the browser's password manager from autofilling the WP login
        // password into these key fields (it can silently overwrite a saved API
        // key on save). Belt and braces: explicit autocomplete + manager-ignore
        // hints, plus readonly-until-focus to defeat Chrome's on-load autofill.
        document.querySelectorAll('input.oe-secret').forEach(function (input) {
            if (input.disabled) { return; }
            input.setAttribute('autocomplete', 'new-password');
            input.setAttribute('data-1p-ignore', '');
            input.setAttribute('data-lpignore', 'true');
            input.setAttribute('data-bwignore', '');
            input.setAttribute('data-form-type', 'other');
            input.setAttribute('readonly', 'readonly');
            var unlock = function () { input.removeAttribute('readonly'); };
            input.addEventListener('focus', unlock);
            input.addEventListener('pointerdown', unlock);
        });
        // Open (and scroll to) an accordion when linked via #anchor.
        function openTarget() {
            if (!location.hash) { return; }
            var el = document.querySelector(location.hash);
            if (el && el.tagName === 'DETAILS') { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        }
        window.addEventListener('hashchange', openTarget);
        openTarget();

        // Tabbed settings: show one panel at a time; remember the last tab.
        var nav = document.getElementById('oe-set-nav');
        if (nav) {
            var panels = document.querySelectorAll('.oe-set-panel');
            var showTab = function (tab) {
                if (!document.querySelector('.oe-set-panel[data-tab="' + tab + '"]')) { return; }
                nav.querySelectorAll('button').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === tab); });
                panels.forEach(function (p) { p.classList.toggle('is-active', p.dataset.tab === tab); });
                try { localStorage.setItem('oeSettingsTab', tab); } catch (e) {}
            };
            nav.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-tab]');
                if (b) { e.preventDefault(); showTab(b.dataset.tab); }
            });
            var saved;
            try { saved = localStorage.getItem('oeSettingsTab'); } catch (e) {}
            if (saved) { showTab(saved); }
        }
    })();
    </script>
</div>
