<?php
declare(strict_types=1);

namespace OE\Mail;

use OE\Settings;
use OE\Connectors\ClaudeConnector;
use OE\Planning\Events;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Claude email co-pilot (phase 5) — brief it in plain language and it returns a
 * fully-built campaign draft as builder blocks, grounded in live festival data
 * (confirmed events, recent stories), in the trained house voice.
 *
 * The model is told to use ONLY the supplied data for facts/links and to leave
 * a visible [TODO: confirm …] placeholder for anything it can't verify. Output
 * is strict JSON validated against the builder's block schema, so the canvas
 * only ever loads valid blocks.
 */
final class Copilot {

    public static function is_ready(): bool {
        return ClaudeConnector::is_ready();
    }

    /**
     * @param array<int,array<string,mixed>> $current_blocks
     * @param array<int,array{role:string,content:string}> $history
     * @return array{ok:bool,reply:string,subject?:string,preheader?:string,blocks?:array}
     */
    public static function draft(string $brief, array $current_blocks = [], array $history = []): array {
        if (! self::is_ready()) {
            return ['ok' => false, 'reply' => __('No Claude API key configured (OE_CLAUDE_API_KEY).', 'october-events')];
        }
        if (trim($brief) === '') {
            return ['ok' => false, 'reply' => __('Tell me what the email should say.', 'october-events')];
        }

        $system = self::system_prompt();
        $user   = self::user_prompt($brief, $current_blocks, $history);

        $raw = ClaudeConnector::message($user, 3000, $system);
        if ($raw === null) {
            return ['ok' => false, 'reply' => __('The model returned an error — check the debug log.', 'october-events')];
        }

        $parsed = self::extract_json($raw);
        if (! is_array($parsed) || ! isset($parsed['blocks']) || ! is_array($parsed['blocks'])) {
            return ['ok' => false, 'reply' => __('The model\'s draft could not be read. Try rephrasing the brief.', 'october-events')];
        }

        return [
            'ok'        => true,
            'reply'     => sanitize_text_field((string) ($parsed['reply'] ?? __('Here\'s a draft.', 'october-events'))),
            'subject'   => sanitize_text_field((string) ($parsed['subject'] ?? '')),
            'preheader' => sanitize_text_field((string) ($parsed['preheader'] ?? '')),
            'blocks'    => self::sanitize_blocks($parsed['blocks']),
        ];
    }

    /* ------------------------------------------------------------------ *
     * Prompts
     * ------------------------------------------------------------------ */

    private static function system_prompt(): string {
        $brand = (string) Settings::get('brand_name', 'October Events');
        $voice = ClaudeConnector::system_prompt(); // trained house voice + examples
        $schema = <<<TXT

# Your task now
You are drafting an HTML EMAIL CAMPAIGN for {$brand}. Reply with ONLY a single JSON object (no markdown, no commentary) of exactly this shape:
{
  "reply": "one short sentence to the user about what you drafted or changed",
  "subject": "the email subject line",
  "preheader": "the inbox preview text (<= 110 chars)",
  "blocks": [ ...ordered content blocks... ]
}

Allowed block objects (every block may also have "align":"left|center|right"):
- {"type":"heading","text":"...","level":"h1|h2|h3","align":"left"}
- {"type":"text","text":"... (plain text; use \\n for line breaks)","align":"left"}
- {"type":"image","url":"","alt":"suggested alt text","href":"","align":"center"}  // ALWAYS leave url empty — the user picks the real image from their media library
- {"type":"button","label":"...","href":"https://real-url-from-the-data","align":"left"}
- {"type":"columns","cols":[{"url":"","alt":"...","text":"...","href":""},{"url":"","alt":"...","text":"...","href":""}]}  // two side-by-side cells; leave image url empty
- {"type":"social","items":[{"label":"Instagram","url":"https://…","icon":""}]}  // follow links; leave icon empty (the user adds icons). Only use real URLs.
- {"type":"divider"}
- {"type":"spacer"}

Hard rules:
- Ground every fact (dates, prices, venues) and every link in the FESTIVAL DATA provided below. NEVER invent a date, price, venue or URL.
- If you need a fact that isn't in the data, write a visible "[TODO: confirm …]" placeholder instead of guessing.
- Button hrefs MUST be real URLs taken from the FESTIVAL DATA. If you have no real URL, use a text block with a [TODO: confirm link] note instead of a button.
- Do NOT add an unsubscribe link, footer, or physical address — the system adds those automatically.
- Keep it concise and in the house voice. Open with a heading, lead with the strongest item.
TXT;
        return $voice . "\n" . $schema;
    }

    /**
     * @param array<int,array<string,mixed>> $blocks
     * @param array<int,array{role:string,content:string}> $history
     */
    private static function user_prompt(string $brief, array $blocks, array $history): string {
        $out  = "FESTIVAL DATA (the only source of facts/links you may use):\n" . self::festival_context() . "\n\n";

        if ($history) {
            $out .= "CONVERSATION SO FAR:\n";
            foreach ($history as $turn) {
                $role = ($turn['role'] ?? '') === 'assistant' ? 'You' : 'User';
                $out .= $role . ': ' . trim((string) ($turn['content'] ?? '')) . "\n";
            }
            $out .= "\n";
        }

        if ($blocks) {
            $out .= "CURRENT DRAFT (edit this; keep what still works):\n" . wp_json_encode($blocks) . "\n\n";
        }

        $out .= "BRIEF / REQUEST:\n" . trim($brief) . "\n\nReturn the updated campaign as the JSON object described.";
        return $out;
    }

    /** Compact, factual context: confirmed upcoming events + recent stories. */
    private static function festival_context(): string {
        $lines = [];

        $events = [];
        foreach (Events::all_event_ids(200) as $id) {
            if (Events::status($id) !== 'confirmed') {
                continue;
            }
            $rec = Events::record($id);
            $f   = $rec['fields'] ?? [];
            $events[] = '- ' . ($rec['title'] ?: ($f['name'] ?? 'Event'))
                . ' | when: ' . (string) ($f['start_datetime'] ?? '[TODO]')
                . ' | price: ' . (string) ($f['price'] ?? '[TODO]')
                . ' | location: ' . (string) ($f['location'] ?? '[TODO]')
                . ' | link: ' . get_permalink($id);
            if (count($events) >= 12) {
                break;
            }
        }
        $lines[] = "Confirmed upcoming events:\n" . ($events ? implode("\n", $events) : '(none confirmed yet)');

        $stories = get_posts([
            'post_type'      => PostTypes::slug('story'),
            'post_status'    => 'publish',
            'posts_per_page' => 5,
        ]);
        $srows = [];
        foreach ($stories as $s) {
            $srows[] = '- ' . get_the_title($s) . ' | link: ' . get_permalink($s);
        }
        $lines[] = "Recent stories:\n" . ($srows ? implode("\n", $srows) : '(none)');

        return implode("\n\n", $lines);
    }

    /* ------------------------------------------------------------------ *
     * Parsing + validation
     * ------------------------------------------------------------------ */

    /** Pull the first balanced JSON object out of the model's reply. */
    private static function extract_json(string $raw): ?array {
        $raw = trim($raw);
        // Strip ```json fences if present.
        $raw = (string) preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $raw);
        $start = strpos($raw, '{');
        if ($start === false) {
            return null;
        }
        $depth = 0; $in_str = false; $esc = false;
        for ($i = $start, $n = strlen($raw); $i < $n; $i++) {
            $ch = $raw[$i];
            if ($in_str) {
                if ($esc) { $esc = false; }
                elseif ($ch === '\\') { $esc = true; }
                elseif ($ch === '"') { $in_str = false; }
                continue;
            }
            if ($ch === '"') { $in_str = true; }
            elseif ($ch === '{') { $depth++; }
            elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    $json = substr($raw, $start, $i - $start + 1);
                    $decoded = json_decode($json, true);
                    return is_array($decoded) ? $decoded : null;
                }
            }
        }
        return null;
    }

    /**
     * @param array<int,mixed> $blocks
     * @return array<int,array<string,mixed>>
     */
    private static function sanitize_blocks(array $blocks): array {
        $align = static function ($v) {
            return in_array($v, ['left', 'center', 'right'], true) ? $v : 'left';
        };
        $out = [];
        foreach ($blocks as $b) {
            if (! is_array($b)) { continue; }
            $type = (string) ($b['type'] ?? '');
            switch ($type) {
                case 'heading':
                    $level = in_array(($b['level'] ?? ''), ['h1', 'h2', 'h3'], true) ? $b['level'] : 'h2';
                    $out[] = ['type' => 'heading', 'text' => sanitize_text_field((string) ($b['text'] ?? '')), 'level' => $level, 'align' => $align($b['align'] ?? 'left')];
                    break;
                case 'text':
                    $out[] = ['type' => 'text', 'text' => sanitize_textarea_field((string) ($b['text'] ?? '')), 'align' => $align($b['align'] ?? 'left')];
                    break;
                case 'image':
                    $out[] = ['type' => 'image', 'url' => esc_url_raw((string) ($b['url'] ?? '')), 'alt' => sanitize_text_field((string) ($b['alt'] ?? '')), 'href' => esc_url_raw((string) ($b['href'] ?? '')), 'align' => $align($b['align'] ?? 'center')];
                    break;
                case 'button':
                    $out[] = ['type' => 'button', 'label' => sanitize_text_field((string) ($b['label'] ?? 'Read more')), 'href' => esc_url_raw((string) ($b['href'] ?? '')), 'align' => $align($b['align'] ?? 'left')];
                    break;
                case 'columns':
                    $cols = [];
                    foreach (array_slice(is_array($b['cols'] ?? null) ? $b['cols'] : [], 0, 2) as $c) {
                        if (! is_array($c)) { continue; }
                        $cols[] = [
                            'url'  => esc_url_raw((string) ($c['url'] ?? '')),
                            'alt'  => sanitize_text_field((string) ($c['alt'] ?? '')),
                            'text' => sanitize_textarea_field((string) ($c['text'] ?? '')),
                            'href' => esc_url_raw((string) ($c['href'] ?? '')),
                        ];
                    }
                    if ($cols) { $out[] = ['type' => 'columns', 'cols' => $cols]; }
                    break;
                case 'social':
                    $items = [];
                    foreach (is_array($b['items'] ?? null) ? $b['items'] : [] as $s) {
                        if (! is_array($s)) { continue; }
                        $items[] = [
                            'label' => sanitize_text_field((string) ($s['label'] ?? '')),
                            'url'   => esc_url_raw((string) ($s['url'] ?? '')),
                            'icon'  => esc_url_raw((string) ($s['icon'] ?? '')),
                        ];
                    }
                    if ($items) { $out[] = ['type' => 'social', 'items' => $items]; }
                    break;
                case 'divider':
                    $out[] = ['type' => 'divider'];
                    break;
                case 'spacer':
                    $out[] = ['type' => 'spacer'];
                    break;
            }
        }
        return $out;
    }
}
