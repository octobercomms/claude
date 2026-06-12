<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Settings;
use OE\AI\PublicAssistant;

defined('ABSPATH') || exit;

/**
 * Public customer support chat widget.
 *
 * Renders a floating "Need help?" launcher on the front end (when enabled in
 * Settings) and/or inline via the `[oe_support_chat]` shortcode. The widget
 * verifies the visitor by emailed code, then chats against the scoped
 * oe/v1/support endpoints. Only loads when a Claude key is configured.
 */
final class SupportChat {

    private static ?SupportChat $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('oe_support_chat', [$this, 'shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        if ((string) Settings::get('support_chat_enabled', '0') === '1') {
            add_action('wp_footer', [$this, 'render_floating']);
        }
    }

    public function register_assets(): void {
        wp_register_style('oe-support-chat', OE_URL . 'assets/css/support-chat.css', [], OE_VERSION);
        wp_register_script('oe-support-chat', OE_URL . 'assets/js/support-chat.js', [], OE_VERSION, true);
    }

    private function enqueue(): void {
        if (! PublicAssistant::is_ready()) {
            return;
        }
        wp_enqueue_style('oe-support-chat');
        wp_enqueue_script('oe-support-chat');
        wp_localize_script('oe-support-chat', 'OE_SUPPORT', [
            'restUrl' => esc_url_raw(rest_url('oe/v1')),
            'brand'   => (string) Settings::get('brand_name', 'October Events'),
        ]);
    }

    /** Floating launcher in the footer on every front-end page. */
    public function render_floating(): void {
        if (is_admin() || ! PublicAssistant::is_ready()) {
            return;
        }
        $this->enqueue();
        echo '<div id="oe-support-chat" data-mode="floating"></div>';
    }

    /** Inline embed via shortcode. */
    public function shortcode(array $atts = []): string {
        if (! PublicAssistant::is_ready()) {
            return '';
        }
        $this->enqueue();
        return '<div class="oe-support-inline" data-mode="inline"></div>';
    }
}
