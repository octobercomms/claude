<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Live chat widget injection (self-hosted Chatwoot).
 *
 * Real-time chat needs websockets, which shared hosting can't run — so the chat
 * server lives elsewhere (Chatwoot on AWS) and the plugin only injects its
 * widget script site-wide. Off until a base URL + website token are set in
 * Settings, so swapping providers is a paste, not a deploy.
 */
final class Chat {

    public static function init(): void {
        add_action('wp_footer', [self::class, 'inject']);
    }

    public static function inject(): void {
        $base  = untrailingslashit((string) Settings::get('chatwoot_base_url', ''));
        $token = (string) Settings::get('chatwoot_token', '');
        if ($base === '' || $token === '') {
            return;
        }
        ?>
        <script>
          (function (d, t) {
            var BASE_URL = <?php echo wp_json_encode(esc_url_raw($base)); ?>;
            var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
            g.src = BASE_URL + "/packs/js/sdk.js";
            g.defer = true; g.async = true;
            s.parentNode.insertBefore(g, s);
            g.onload = function () {
              window.chatwootSDK.run({ websiteToken: <?php echo wp_json_encode($token); ?>, baseUrl: BASE_URL });
            };
          })(document, "script");
        </script>
        <?php
    }
}
