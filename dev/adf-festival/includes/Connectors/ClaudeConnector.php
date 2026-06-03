<?php
declare(strict_types=1);

namespace ADF\Connectors;

use ADF\Settings;
use ADF\Logger;

defined('ABSPATH') || exit;

/**
 * Claude API editorial layer for the AI Stories connector (§6).
 *
 * Given source article content, returns a short ADF-voice editorial piece, or
 * the sentinel string "SKIP" when the source has no clear design relevance.
 */
final class ClaudeConnector {

    private const API_BASE = 'https://api.anthropic.com/v1/messages';
    private const API_VERSION = '2023-06-01';

    public static function is_ready(): bool {
        return Settings::has_secret('claude_api_key');
    }

    /**
     * The base editorial prompt (§6). Kept as a method so it can be filtered /
     * refined before launch without touching call sites.
     */
    public static function editorial_prompt(string $source_content): string {
        $base = <<<PROMPT
You are the editorial voice of Atlanta Design Festival — a design-culture publication covering architecture, interiors, urban design, and the creative industries. Your tone is direct, editorial, and specific. You write for a design-literate audience. You do not use marketing language.
Given the following source article, write a short editorial piece of 150–200 words in this voice. Include a suggested headline. Do not reproduce the source text — rewrite entirely in ADF's voice. Focus on why this is relevant to a design audience in Atlanta or the wider US South. If the story has no clear relevance, return only the word SKIP.
Source article:
{$source_content}
PROMPT;

        return (string) apply_filters('adf_claude_editorial_prompt', $base, $source_content);
    }

    /**
     * Run an editorial rewrite. Returns:
     *   ['skip' => true] when the model returns SKIP,
     *   ['headline' => string, 'body' => string] on success,
     *   null on error.
     */
    public static function editorialize(string $source_content): ?array {
        if (! self::is_ready()) {
            Logger::log('Claude call skipped — no API key');
            return null;
        }

        $text = self::message(self::editorial_prompt($source_content));
        if ($text === null) {
            return null;
        }

        $trimmed = trim($text);
        if (strtoupper($trimmed) === 'SKIP' || stripos($trimmed, 'SKIP') === 0 && strlen($trimmed) < 12) {
            return ['skip' => true];
        }

        return self::split_headline($trimmed);
    }

    /**
     * Low-level single-turn message call. Returns the assistant text or null.
     */
    public static function message(string $prompt, int $max_tokens = 1024): ?string {
        $response = wp_remote_post(self::API_BASE, [
            'timeout' => 60,
            'headers' => [
                'x-api-key'         => (string) Settings::get('claude_api_key', ''),
                'anthropic-version' => self::API_VERSION,
                'Content-Type'      => 'application/json',
            ],
            'body' => wp_json_encode([
                'model'      => (string) Settings::get('ai_model', 'claude-sonnet-4-20250514'),
                'max_tokens' => $max_tokens,
                'messages'   => [
                    ['role' => 'user', 'content' => $prompt],
                ],
            ]),
        ]);

        if (is_wp_error($response)) {
            Logger::log('Claude error', ['error' => $response->get_error_message()]);
            return null;
        }
        $code = wp_remote_retrieve_response_code($response);
        $data = json_decode((string) wp_remote_retrieve_body($response), true);
        if ($code < 200 || $code >= 300 || ! is_array($data)) {
            Logger::log('Claude non-2xx', ['code' => $code, 'body' => wp_remote_retrieve_body($response)]);
            return null;
        }

        // Anthropic returns content as an array of blocks.
        $text = '';
        foreach (($data['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= $block['text'];
            }
        }
        return $text !== '' ? $text : null;
    }

    /**
     * Pull a "Headline: ..." first line (or first line generally) off the body.
     *
     * @return array{headline:string,body:string}
     */
    private static function split_headline(string $text): array {
        $lines = preg_split('/\r\n|\r|\n/', $text) ?: [];
        $headline = '';
        $body_lines = $lines;

        if ($lines) {
            $first = trim($lines[0]);
            // Strip common "Headline:" / markdown heading markers.
            $first = preg_replace('/^(#+\s*|headline:\s*|suggested headline:\s*|\*\*)/i', '', $first);
            $first = trim((string) preg_replace('/\*\*$/', '', (string) $first));
            if ($first !== '' && mb_strlen($first) < 140) {
                $headline = $first;
                array_shift($body_lines);
            }
        }

        return [
            'headline' => $headline ?: __('Untitled', 'adf-festival'),
            'body'     => trim(implode("\n", $body_lines)),
        ];
    }
}
