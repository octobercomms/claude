<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Settings;
use OE\Survey\Config;
use OE\Survey\Responses;

defined('ABSPATH') || exit;

/**
 * The public post-event survey form.
 *
 * Rendered as a standalone mobile page at /survey/{token} (and via the
 * [oe_survey] shortcode). One question per screen, big tap targets. Answers are
 * saved as the respondent advances — each "Next" posts that answer (progressive
 * capture), so a survey started and abandoned is still recorded; the final
 * submit marks it complete and reveals the reward code. Degrades to a single
 * save-on-submit if JavaScript is off.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md §4, §7a, §11
 */
final class Survey {

    private static ?Survey $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('oe_survey', [$this, 'shortcode']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('wp_ajax_oe_survey_save', [$this, 'ajax_save']);
        add_action('wp_ajax_nopriv_oe_survey_save', [$this, 'ajax_save']);
        add_action('wp_ajax_oe_survey_submit', [$this, 'ajax_submit']);
        add_action('wp_ajax_nopriv_oe_survey_submit', [$this, 'ajax_submit']);
        add_action('admin_post_oe_survey_form', [$this, 'handle_noscript']);
        add_action('admin_post_nopriv_oe_survey_form', [$this, 'handle_noscript']);
    }

    public function register_assets(): void {
        wp_register_style('oe-survey', OE_URL . 'assets/css/survey.css', [], OE_VERSION);
        wp_register_script('oe-survey', OE_URL . 'assets/js/survey.js', [], OE_VERSION, true);
    }

    /** [oe_survey] — reads the token from the query, renders the form inline. */
    public function shortcode(array $atts = []): string {
        $token = $this->token_from_request();
        wp_enqueue_style('oe-survey');
        [$html] = $this->build($token);
        return $html;
    }

    /** Standalone /survey/{token} (or ?oe_survey=token) page. */
    public function render_page(string $token): void {
        nocache_headers();
        $this->register_assets();
        wp_enqueue_style('oe-survey');
        [$body] = $this->build($token);
        $this->shell($body);
    }

    /**
     * Preview the form for an event (managers only, nothing recorded). Reachable
     * from the builder's "Preview the survey" link at ?oe_survey_preview=<id>.
     */
    public function render_preview(int $event_id): void {
        if (! current_user_can('edit_post', $event_id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        nocache_headers();
        $this->register_assets();
        wp_enqueue_style('oe-survey');
        // Previewing is for checking the flow *before* turning the survey on, so
        // it deliberately does not require the enable flag (unlike is_ready): all
        // it needs is a question set whose first cap-counting question is a rating.
        $core = array_values(array_filter(
            Config::questions($event_id),
            static fn(array $q): bool => ! in_array((string) ($q['type'] ?? ''), Config::OFFCAP_TYPES, true)
        ));
        if ($core === [] || (string) ($core[0]['type'] ?? '') !== 'rating') {
            $this->shell($this->notice(__('Nothing to preview yet', 'october-events'), __('Add a first rating question (and save), then preview.', 'october-events')));
            return;
        }
        $this->shell($this->form_html('', $event_id, true));
    }

    /** Print the standalone page shell around a body fragment. */
    private function shell(string $body): void {
        $brand  = (string) Settings::get('brand_name', get_bloginfo('name'));
        $fav    = function_exists('get_site_icon_url') ? get_site_icon_url(32) : '';
        $accent = sanitize_hex_color((string) Settings::get('theme_accent', '')) ?: '#E7CD41';
        $ink    = sanitize_hex_color((string) Settings::get('theme_accent_on', '')) ?: '#1a1a1a';
        ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php echo esc_attr(get_bloginfo('charset')); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?php echo esc_html($brand . ' — ' . __('Survey', 'october-events')); ?></title>
<meta name="theme-color" content="#ffffff">
<?php if ($fav) : ?><link rel="icon" href="<?php echo esc_url($fav); ?>"><?php endif; ?>
<?php wp_print_styles(); ?>
<style>.oe-survey-route{--oe-accent:<?php echo esc_html($accent); ?>;--oe-accent-on:<?php echo esc_html($ink); ?>}</style>
</head>
<body class="oe-survey-route">
<?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped values in build()/form_html() ?>
<?php wp_print_footer_scripts(); ?>
</body>
</html><?php
    }

    /**
     * Build the survey UI for a token. Returns [html]. Handles the closed /
     * not-yet-open / already-done / invalid states, else the form.
     *
     * @return array{0:string}
     */
    private function build(string $token): array {
        $token = $this->clean_token($token);
        $ctx   = $token !== '' ? Responses::context($token) : null;

        if ($ctx === null) {
            return [$this->notice(__('Survey closed', 'october-events'), __('This survey link isn’t valid or has closed.', 'october-events'))];
        }
        $event_id = $ctx['event_id'];
        $now      = current_time('timestamp');

        if ($now < Config::opens_ts($event_id)) {
            return [$this->notice(__('Not open yet', 'october-events'), __('This survey opens after the event. Please come back then — the link stays the same.', 'october-events'))];
        }
        if (! Config::is_open($event_id)) {
            return [$this->notice(__('Survey closed', 'october-events'), __('Thanks for your interest — this survey has now closed.', 'october-events'))];
        }

        $existing = Responses::find($token);
        if ($existing && (string) $existing->status === 'complete') {
            return [$this->thanks_html(Config::incentive_code($event_id))];
        }

        return [$this->form_html($token, $event_id)];
    }

    private function form_html(string $token, int $event_id, bool $preview = false): string {
        $questions = Config::questions($event_id);
        $event     = get_the_title($event_id);

        // Data the front-end script drives the one-per-screen flow with. In
        // preview mode nothing is saved: the script skips the autosave/submit
        // calls and shows the thank-you (with the configured code) locally.
        wp_enqueue_script('oe-survey');
        wp_localize_script('oe-survey', 'OE_SURVEY_FORM', [
            'ajax'      => admin_url('admin-ajax.php'),
            'nonce'     => wp_create_nonce('oe_survey_public'),
            'token'     => $token,
            'questions' => $questions,
            'preview'   => $preview,
            'code'      => $preview ? Config::incentive_code($event_id) : '',
            'i18n'      => [
                'next'    => __('Next', 'october-events'),
                'back'    => __('Back', 'october-events'),
                'finish'  => __('Finish', 'october-events'),
                'skip'    => __('Skip', 'october-events'),
                'saving'  => __('Saving…', 'october-events'),
                'thanks'  => __('Thank you', 'october-events'),
                'pvThanks'=> __('Preview — nothing was saved.', 'october-events'),
            ],
        ]);

        ob_start();
        require OE_DIR . 'frontend/templates/survey-form.php';
        return (string) ob_get_clean();
    }

    private function thanks_html(string $code): string {
        ob_start();
        require OE_DIR . 'frontend/templates/survey-thanks.php';
        return (string) ob_get_clean();
    }

    private function notice(string $title, string $body): string {
        return '<main class="oe-survey"><div class="oe-survey-card oe-survey-notice">'
            . '<h1>' . esc_html($title) . '</h1><p>' . esc_html($body) . '</p></div></main>';
    }

    /* ------------------------------------------------------------------ *
     * AJAX — progressive capture
     * ------------------------------------------------------------------ */

    public function ajax_save(): void {
        check_ajax_referer('oe_survey_public', 'nonce');
        $token = $this->clean_token(isset($_POST['token']) ? (string) wp_unslash($_POST['token']) : '');
        $qid   = isset($_POST['question']) ? sanitize_key((string) wp_unslash($_POST['question'])) : '';
        if ($token === '' || $qid === '') {
            wp_send_json_error([], 400);
        }
        $value = $this->json_field('value');
        $ok = Responses::record_answer($token, $qid, $value);
        $ok ? wp_send_json_success() : wp_send_json_error([], 422);
    }

    public function ajax_submit(): void {
        check_ajax_referer('oe_survey_public', 'nonce');
        $token = $this->clean_token(isset($_POST['token']) ? (string) wp_unslash($_POST['token']) : '');
        if ($token === '') {
            wp_send_json_error([], 400);
        }
        $answers = $this->json_field('answers');
        $code = Responses::finish($token, is_array($answers) ? $answers : []);
        if ($code === null) {
            wp_send_json_error(['message' => __('Could not save your answers.', 'october-events')], 422);
        }
        wp_send_json_success(['html' => $this->thanks_html($code)]);
    }

    /**
     * Decode a JSON-encoded POST field (the front-end sends structured answers as
     * JSON). Falls back to the raw string. Values are validated/sanitised in
     * Responses, so this only needs to return the shape.
     *
     * @return mixed
     */
    private function json_field(string $key) {
        if (! isset($_POST[$key])) {
            return '';
        }
        $raw = (string) wp_unslash($_POST[$key]);
        $decoded = json_decode($raw, true);
        return json_last_error() === JSON_ERROR_NONE ? $decoded : $raw;
    }

    /** No-JS fallback: the whole form posts here at once. */
    public function handle_noscript(): void {
        check_admin_referer('oe_survey_public_form');
        $token = $this->clean_token(isset($_POST['oe_token']) ? (string) wp_unslash($_POST['oe_token']) : '');
        $ctx   = $token !== '' ? Responses::context($token) : null;
        $back  = $token !== '' ? \OE\Survey\Sender::link($token) : home_url('/');
        if ($ctx === null) {
            wp_safe_redirect($back);
            exit;
        }
        $answers = $this->parse_noscript($ctx['event_id']);
        Responses::finish($token, $answers);
        // Redirect back to the survey link. build() reflects the true state: a
        // successful finish now renders the thank-you + code; a failed one (closed,
        // or nothing valid answered) shows the form or the closed notice.
        wp_safe_redirect($back);
        exit;
    }

    /**
     * Map a plain (no-JS) form post into the answers structure.
     *
     * @return array<string,mixed>
     */
    private function parse_noscript(int $event_id): array {
        $q = isset($_POST['q']) && is_array($_POST['q']) ? $this->unslash_value($_POST['q']) : [];
        $s = isset($_POST['s']) && is_array($_POST['s']) ? $this->unslash_value($_POST['s']) : [];
        $t = isset($_POST['t']) && is_array($_POST['t']) ? $this->unslash_value($_POST['t']) : [];
        $answers = [];
        foreach ($q as $id => $val) {
            $answers[sanitize_key((string) $id)] = $val; // validated in Responses
        }
        foreach ($t as $id => $val) {
            $answers[sanitize_key((string) $id)] = is_array($val) ? $val : ['text' => $val];
        }
        // Session ratings arrive indexed; map indexes back to session names.
        foreach ($s as $id => $rows) {
            $id = sanitize_key((string) $id);
            $sessions = $this->sessions_for($event_id, $id);
            if ($sessions === []) {
                continue;
            }
            $mapped = [];
            foreach ((array) $rows as $idx => $entry) {
                if ($idx === 'comment') {
                    $mapped['_comment'] = $entry;
                    continue;
                }
                if (! is_numeric($idx)) {
                    continue;
                }
                $name = $sessions[(int) $idx] ?? '';
                if ($name === '') {
                    continue;
                }
                $mapped[$name] = is_array($entry) ? ($entry['rating'] ?? '') : $entry;
            }
            if ($mapped !== []) {
                $answers[$id] = $mapped;
            }
        }
        return $answers;
    }

    /** @return string[] */
    private function sessions_for(int $event_id, string $qid): array {
        foreach (Config::questions($event_id) as $q) {
            if ((string) ($q['id'] ?? '') === $qid && (string) ($q['type'] ?? '') === 'session_rating') {
                return array_map('strval', (array) ($q['sessions'] ?? []));
            }
        }
        return [];
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    private function token_from_request(): string {
        $t = get_query_var('oe_survey');
        if (! $t && isset($_GET['oe_survey'])) {
            $t = (string) wp_unslash($_GET['oe_survey']);
        }
        if (! $t && isset($_GET['token'])) {
            $t = (string) wp_unslash($_GET['token']);
        }
        return $this->clean_token((string) $t);
    }

    private function clean_token(string $token): string {
        $token = preg_replace('/[^a-f0-9]/i', '', $token) ?? '';
        return strlen($token) === 64 ? strtolower($token) : '';
    }

    /** Recursively wp_unslash + keep types loose (values are validated downstream). */
    private function unslash_value($value) {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $k => $v) {
                $out[is_string($k) ? sanitize_text_field(wp_unslash($k)) : $k] = $this->unslash_value($v);
            }
            return $out;
        }
        return wp_unslash($value);
    }
}
