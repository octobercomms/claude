<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Connectors\ClaudeConnector;
use OE\Ticketing\Ics;

defined('ABSPATH') || exit;

/**
 * Social captions for an event.
 *
 * The event editor gains a "Social" metabox: a list of the parties involved
 * (name + Instagram handle) and five ready-to-post captions written in the house
 * voice, each weaving in the parties' @handles and a link to book. Captions are
 * generated in the background the first time an event is published, and can be
 * regenerated or hand-edited any time.
 *
 * Phase 1 of the social suite: the image suite and native Meta/LinkedIn
 * scheduling build on the parties + captions stored here.
 */
final class Social {

    public const META_PARTIES  = '_oe_social_parties';   // [['name'=>, 'handle'=>], …]
    public const META_CAPTIONS = '_oe_social_captions';  // [string, …] up to 5

    private static ?Social $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        $events = PostTypes::slug('event');
        add_action('add_meta_boxes', [$this, 'add_box']);
        add_action('save_post_' . $events, [$this, 'save'], 10, 2);
        add_action('wp_ajax_oe_social_generate', [$this, 'ajax_generate']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue']);
        // Auto-write captions once, in the background, on first publish.
        add_action('transition_post_status', [$this, 'on_publish'], 10, 3);
        add_action('oe_social_autogen', [$this, 'run_autogen']);
    }

    /* ---- parties ---- */

    /** @return array<int,array{name:string,handle:string}> */
    public static function parties(int $post_id): array {
        $raw = get_post_meta($post_id, self::META_PARTIES, true);
        $out = [];
        foreach ((is_array($raw) ? $raw : []) as $p) {
            $name   = trim((string) ($p['name'] ?? ''));
            $handle = self::normalize_handle((string) ($p['handle'] ?? ''));
            if ($name !== '' || $handle !== '') {
                $out[] = ['name' => $name, 'handle' => $handle];
            }
        }
        return $out;
    }

    /** A bare Instagram handle (no @, no URL, no trailing slash). */
    public static function normalize_handle(string $raw): string {
        $raw = trim($raw);
        if ($raw === '') {
            return '';
        }
        // Accept a full instagram URL, an @handle, or a bare handle.
        if (preg_match('~instagram\.com/([^/?#]+)~i', $raw, $m)) {
            $raw = $m[1];
        }
        $raw = ltrim($raw, '@');
        $raw = preg_replace('/[^A-Za-z0-9._]/', '', $raw) ?? '';
        return substr($raw, 0, 30);
    }

    /** @return array<int,string> up to five stored captions. */
    public static function captions(int $post_id): array {
        $raw = get_post_meta($post_id, self::META_CAPTIONS, true);
        $out = [];
        foreach ((is_array($raw) ? $raw : []) as $c) {
            $c = trim((string) $c);
            if ($c !== '') {
                $out[] = $c;
            }
        }
        return array_slice($out, 0, 5);
    }

    /* ---- metabox ---- */

    public function enqueue(string $hook): void {
        if ($hook !== 'post.php' && $hook !== 'post-new.php') {
            return;
        }
        if (get_post_type() !== PostTypes::slug('event')) {
            return;
        }
        wp_enqueue_script('oe-social-image', OE_URL . 'assets/js/social-image.js', [], OE_VERSION, true);
    }

    public function add_box(): void {
        add_meta_box('oe_social', __('Social captions & tags', 'october-events'), [$this, 'render_box'], PostTypes::slug('event'), 'normal', 'default');
    }

    public function render_box(\WP_Post $post): void {
        wp_nonce_field('oe_social_save', 'oe_social_nonce');
        $parties  = self::parties($post->ID);
        $captions = self::captions($post->ID);
        if (! $parties) {
            $parties = [['name' => '', 'handle' => '']]; // one empty row to start
        }
        $ready = ClaudeConnector::is_ready();
        require OE_DIR . 'admin/views/social-box.php';
    }

    /* ---- save ---- */

    public function save(int $post_id, \WP_Post $post): void {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }
        if (! isset($_POST['oe_social_nonce']) || ! wp_verify_nonce((string) $_POST['oe_social_nonce'], 'oe_social_save')) {
            return;
        }
        if (! current_user_can('edit_post', $post_id)) {
            return;
        }

        // Parties: paired name[] / handle[] rows, empties dropped.
        $names   = (array) wp_unslash($_POST['oe_sp_name'] ?? []);
        $handles = (array) wp_unslash($_POST['oe_sp_handle'] ?? []);
        $parties = [];
        foreach ($names as $i => $name) {
            $name   = sanitize_text_field((string) $name);
            $handle = self::normalize_handle((string) ($handles[$i] ?? ''));
            if ($name !== '' || $handle !== '') {
                $parties[] = ['name' => $name, 'handle' => $handle];
            }
        }
        update_post_meta($post_id, self::META_PARTIES, $parties);

        // Captions: whatever is in the five boxes (hand-edited or generated),
        // sanitised as multi-line text.
        $caps = [];
        foreach ((array) wp_unslash($_POST['oe_cap'] ?? []) as $c) {
            $c = sanitize_textarea_field((string) $c);
            if (trim($c) !== '') {
                $caps[] = $c;
            }
        }
        // Don't let an all-empty submit wipe existing captions. Autogen writes
        // captions in the background after publish; a still-open editor whose
        // boxes loaded empty would otherwise clobber them on the next Update.
        // (To clear every caption, blank the boxes when captions are present and
        // the update is a real edit — but never lose freshly generated ones to a
        // stale form.)
        if (! $caps && self::captions($post_id)) {
            return;
        }
        update_post_meta($post_id, self::META_CAPTIONS, array_slice($caps, 0, 5));
    }

    /* ---- auto-generate on first publish ---- */

    public function on_publish(string $new, string $old, \WP_Post $post): void {
        if ($new !== 'publish' || $old === 'publish') {
            return;
        }
        if ($post->post_type !== PostTypes::slug('event')) {
            return;
        }
        if (self::captions($post->ID)) {
            return; // never overwrite captions that already exist
        }
        if (! ClaudeConnector::is_ready()) {
            return;
        }
        // Off the request thread — an AI call must not slow down publishing.
        // A short delay also lets the block editor's separate metabox POST persist
        // the parties first, so the auto-captions can weave in their @handles.
        if (! wp_next_scheduled('oe_social_autogen', [$post->ID])) {
            wp_schedule_single_event(time() + 30, 'oe_social_autogen', [$post->ID]);
        }
    }

    public function run_autogen(int $post_id): void {
        if (self::captions($post_id) || ! ClaudeConnector::is_ready()) {
            return;
        }
        $caps = self::generate($post_id, self::parties($post_id));
        if ($caps) {
            update_post_meta($post_id, self::META_CAPTIONS, array_slice($caps, 0, 5));
        } else {
            // Don't fail silently: an editor expecting auto-captions gets none, so
            // leave a trace. The Regenerate button is the manual fallback.
            \OE\Logger::log('Social auto-captions returned empty', ['event' => $post_id]);
        }
    }

    /* ---- AJAX: regenerate on demand ---- */

    public function ajax_generate(): void {
        check_ajax_referer('oe_social_generate', 'nonce');
        $post_id = absint($_POST['post_id'] ?? 0);
        if (! $post_id || get_post_type($post_id) !== PostTypes::slug('event')) {
            wp_send_json_error(['message' => __('Save the event first, then generate.', 'october-events')]);
        }
        // Authorise against THIS event, not "can edit posts in general" — otherwise
        // any contributor could spend Claude credits on (and read captions derived
        // from) another author's private draft event.
        if (! current_user_can('edit_post', $post_id)) {
            wp_send_json_error(['message' => 'forbidden'], 403);
        }
        if (! ClaudeConnector::is_ready()) {
            wp_send_json_error(['message' => __('Add your Claude API key under Settings → Keys & platform first.', 'october-events')]);
        }
        // Use the parties as currently typed in the form (may be unsaved).
        $names   = (array) wp_unslash($_POST['names'] ?? []);
        $handles = (array) wp_unslash($_POST['handles'] ?? []);
        $parties = [];
        foreach ($names as $i => $name) {
            $name   = sanitize_text_field((string) $name);
            $handle = self::normalize_handle((string) ($handles[$i] ?? ''));
            if ($name !== '' || $handle !== '') {
                $parties[] = ['name' => $name, 'handle' => $handle];
            }
        }
        $caps = self::generate($post_id, $parties);
        if (! $caps) {
            wp_send_json_error(['message' => __('Couldn’t generate captions just now. Try again in a moment.', 'october-events')]);
        }
        wp_send_json_success(['captions' => $caps]);
    }

    /* ---- generation ---- */

    /**
     * @param array<int,array{name:string,handle:string}> $parties
     * @return array<int,string>
     */
    public static function generate(int $post_id, array $parties): array {
        $title = get_the_title($post_id) ?: __('our event', 'october-events');
        $link  = get_permalink($post_id) ?: home_url('/');
        $ts    = Ics::start_ts($post_id);
        $when  = $ts ? wp_date('l F j, Y', $ts) : '';
        $body  = wp_strip_all_tags((string) get_post_field('post_content', $post_id));
        $body  = trim(wp_trim_words($body !== '' ? $body : (string) get_post_field('post_excerpt', $post_id), 90, ''));

        $lines = [];
        foreach ($parties as $p) {
            $lines[] = $p['handle'] !== ''
                ? trim($p['name']) . ' (@' . $p['handle'] . ')'
                : trim($p['name']);
        }
        $party_block = $lines ? implode(', ', array_filter($lines)) : __('(none listed)', 'october-events');

        $task = "Write 5 distinct social media captions promoting this event across Instagram, Facebook and LinkedIn.\n\n"
            . "Event: {$title}\n"
            . ($when !== '' ? "When: {$when}\n" : '')
            . ($body !== '' ? "Details: {$body}\n" : '')
            . "Book / more info: {$link}\n"
            . "Parties to tag (mention each one's Instagram @handle naturally): {$party_block}\n\n"
            . "Rules:\n"
            . "- Exactly 5 captions, each 1–3 short sentences, ready to post as-is.\n"
            . "- Weave in the parties' @handles where natural; don't force every handle into every caption.\n"
            . "- Include a clear call to action and the link.\n"
            . "- Vary the angle across the five: the announcement, the people/parties, the experience, one specific detail, and a last-call nudge.\n"
            . "- At most 3 relevant hashtags per caption; no hashtag spam.\n"
            . "- Match the house voice.\n"
            . "Return ONLY a JSON array of exactly 5 strings and nothing else.";

        $text = ClaudeConnector::message($task, 1400, ClaudeConnector::system_prompt());
        if ($text === null) {
            return [];
        }
        return self::parse_captions($text);
    }

    /** Pull five caption strings from the model's reply (JSON array, or lines). */
    private static function parse_captions(string $text): array {
        $text = trim($text);
        // Prefer a JSON array, even if wrapped in prose or a ```json fence.
        if (preg_match('/\[[\s\S]*\]/', $text, $m)) {
            $decoded = json_decode($m[0], true);
            if (is_array($decoded)) {
                $out = [];
                foreach ($decoded as $c) {
                    if (is_string($c) && trim($c) !== '') {
                        $out[] = trim($c);
                    }
                }
                if ($out) {
                    return array_slice($out, 0, 5);
                }
            }
        }
        // Fallback: split into non-empty blocks, stripping any leading "1." / "-".
        $blocks = preg_split('/\n\s*\n/', $text) ?: [];
        // A model that ignores the JSON rule often returns a one-per-line
        // numbered/bulleted list with no blank lines between items; blank-line
        // splitting would collapse all five into a single caption, so when we
        // see several list markers but only one block, split on the markers.
        $marker    = '(?:\d+[.)]|[-*•])';
        $list_mode = false;
        if (count(array_filter(array_map('trim', $blocks))) < 2
            && preg_match_all('/^\s*' . $marker . '\s+/m', $text) >= 2) {
            $blocks    = preg_split('/\n(?=\s*' . $marker . '\s+)/', $text) ?: [];
            $list_mode = true; // keep only marker-led items so a preamble line isn't a caption
        }
        $out = [];
        foreach ($blocks as $b) {
            if ($list_mode && ! preg_match('/^\s*' . $marker . '\s+/', $b)) {
                continue;
            }
            $b = trim(preg_replace('/^\s*' . $marker . '\s*/', '', $b) ?? $b);
            if ($b !== '') {
                $out[] = $b;
            }
        }
        return array_slice($out, 0, 5);
    }
}
