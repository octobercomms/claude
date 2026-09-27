<?php
declare(strict_types=1);

namespace OE\Survey;

use OE\Ticketing\Orders;

defined('ABSPATH') || exit;

/**
 * Survey response storage + validation.
 *
 * Answers are written as the respondent moves through the form (record_answer),
 * not only at the end, so a survey that is started and abandoned is still
 * captured. finish() marks the row complete and stamps submitted_at. Every
 * incoming answer is validated against the event's stored question set — no
 * arbitrary keys, open text sanitised and length-capped.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md
 */
final class Responses {

    private const OPEN_MAX = 2000; // chars per open-text / comment answer

    /**
     * Resolve a survey token (the attendee's ticket token) to its context, or
     * null if it isn't a valid ticket for an open survey.
     *
     * @return array{event_id:int,segment:string}|null
     */
    public static function context(string $token): ?array {
        $token = self::clean_token($token);
        if ($token === '') {
            return null;
        }
        $ticket = Orders::ticket_by_token($token);
        if (! $ticket || (string) $ticket->status !== 'active') {
            return null;
        }
        $event_id = (int) $ticket->event_id;
        if ($event_id <= 0 || ! Config::is_ready($event_id)) {
            return null;
        }
        return [
            'event_id' => $event_id,
            'segment'  => sanitize_text_field((string) ($ticket->ticket_type_label ?? '')),
        ];
    }

    public static function find(string $token): ?object {
        global $wpdb;
        $token = self::clean_token($token);
        if ($token === '') {
            return null;
        }
        return $wpdb->get_row($wpdb->prepare(
            'SELECT * FROM ' . Schema::table() . ' WHERE token = %s',
            self::key($token)
        )) ?: null;
    }

    /**
     * What we actually store in the `token` column: an HMAC of the ticket token,
     * not the token itself. The stored value is still stable per attendee (so
     * one-response-per-person and the segment snapshot work), but it can't be
     * reverse-joined to tickets.token to unmask who said what — the survey is
     * pseudonymous underneath and anonymous to read (spec §7a). The salt is the
     * site's own auth salt, so nothing new needs storing.
     */
    private static function key(string $token): string {
        return hash_hmac('sha256', $token, wp_salt('secure_auth'));
    }

    /**
     * Store one answer as the respondent advances. Creates the row (status
     * partial) on the first answer, merges on later ones. Returns false if the
     * token is invalid, the survey is closed, or the answer fails validation.
     */
    public static function record_answer(string $token, string $question_id, $value): bool {
        $token = self::clean_token($token);
        $ctx   = self::context($token);
        if ($ctx === null || ! Config::is_open($ctx['event_id'])) {
            return false;
        }
        $questions = Config::questions($ctx['event_id']);
        $clean     = self::validate_answer($questions, $question_id, $value);
        if ($clean === null) {
            return false;
        }

        $existing = self::find($token);
        $answers  = [];
        if ($existing && (string) $existing->status === 'complete') {
            return false; // finished surveys are not reopened for edits
        }
        if ($existing) {
            $decoded = json_decode((string) $existing->answers, true);
            $answers = is_array($decoded) ? $decoded : [];
        }
        $answers[$clean['id']] = $clean['value'];

        return self::upsert($token, $ctx, $answers, false);
    }

    /**
     * Finalise a survey: merge any answers passed in, mark complete, stamp
     * submitted_at. Returns the incentive code (or '') on success, null on
     * failure.
     *
     * @param array<string,mixed> $answers
     */
    public static function finish(string $token, array $answers = []): ?string {
        $token = self::clean_token($token);
        $ctx   = self::context($token);
        if ($ctx === null || ! Config::is_open($ctx['event_id'])) {
            return null;
        }

        $existing = self::find($token);
        $stored   = [];
        if ($existing) {
            if ((string) $existing->status === 'complete') {
                // Idempotent: a double-submit just returns the code again.
                return Config::incentive_code($ctx['event_id']);
            }
            $decoded = json_decode((string) $existing->answers, true);
            $stored  = is_array($decoded) ? $decoded : [];
        }

        $questions = Config::questions($ctx['event_id']);
        foreach ($answers as $qid => $val) {
            $clean = self::validate_answer($questions, (string) $qid, $val);
            if ($clean !== null) {
                $stored[$clean['id']] = $clean['value'];
            }
        }
        if ($stored === []) {
            return null; // nothing answered — not a completion
        }

        if (! self::upsert($token, $ctx, $stored, true)) {
            return null;
        }
        return Config::incentive_code($ctx['event_id']);
    }

    /**
     * Insert or update the response row.
     *
     * @param array{event_id:int,segment:string} $ctx
     * @param array<string,mixed> $answers
     */
    private static function upsert(string $token, array $ctx, array $answers, bool $complete): bool {
        global $wpdb;
        $now      = current_time('mysql');
        $key      = self::key($token);
        $existing = self::find($token);
        $json     = wp_json_encode($answers);
        if ($json === false) {
            return false;
        }

        if ($existing) {
            $data = ['answers' => $json, 'updated_at' => $now];
            $fmt  = ['%s', '%s'];
            if ($complete && (string) $existing->status !== 'complete') {
                $data['status']       = 'complete';
                $data['submitted_at'] = $now;
                $fmt[] = '%s';
                $fmt[] = '%s';
            }
            return false !== $wpdb->update(Schema::table(), $data, ['token' => $key], $fmt, ['%s']);
        }

        return false !== $wpdb->insert(Schema::table(), [
            'event_id'     => $ctx['event_id'],
            'token'        => $key,
            'segment'      => $ctx['segment'],
            'answers'      => $json,
            'status'       => $complete ? 'complete' : 'partial',
            'started_at'   => $now,
            'updated_at'   => $now,
            'submitted_at' => $complete ? $now : null,
        ], ['%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s']);
    }

    /**
     * Validate one answer against the stored questions. Returns the normalised
     * {id, value} pair, or null if the question id is unknown or the value is
     * invalid for its type.
     *
     * @param array<int,array<string,mixed>> $questions
     * @return array{id:string,value:mixed}|null
     */
    private static function validate_answer(array $questions, string $question_id, $value): ?array {
        $question_id = sanitize_key($question_id);
        $q = null;
        foreach ($questions as $item) {
            if ((string) ($item['id'] ?? '') === $question_id) {
                $q = $item;
                break;
            }
        }
        if ($q === null) {
            return null;
        }
        $type = (string) $q['type'];

        switch ($type) {
            case 'rating':
                $n = (int) $value;
                return ($n >= 1 && $n <= 5) ? ['id' => $question_id, 'value' => $n] : null;

            case 'choice':
                $opts = (array) ($q['options'] ?? []);
                $v = sanitize_text_field((string) $value);
                return in_array($v, $opts, true) ? ['id' => $question_id, 'value' => $v] : null;

            case 'multi':
                $opts = (array) ($q['options'] ?? []);
                $picked = [];
                foreach ((array) $value as $v) {
                    $v = sanitize_text_field((string) $v);
                    if (in_array($v, $opts, true) && ! in_array($v, $picked, true)) {
                        $picked[] = $v;
                    }
                }
                return $picked !== [] ? ['id' => $question_id, 'value' => $picked] : null;

            case 'open':
                $v = self::clean_text($value);
                return $v !== '' ? ['id' => $question_id, 'value' => $v] : null;

            case 'session_rating':
                $sessions = (array) ($q['sessions'] ?? []);
                $out = [];
                $rated = 0;
                foreach ((array) $value as $key => $entry) {
                    if ($key === '_comment') {
                        $comment = self::clean_text($entry);
                        if ($comment !== '') {
                            $out['_comment'] = $comment;
                        }
                        continue;
                    }
                    $name = sanitize_text_field((string) $key);
                    if (! in_array($name, $sessions, true)) {
                        continue;
                    }
                    $rating = (int) (is_array($entry) ? ($entry['rating'] ?? 0) : $entry);
                    if ($rating < 1 || $rating > 5) {
                        continue;
                    }
                    $out[$name] = $rating;
                    $rated++;
                }
                return $rated > 0 ? ['id' => $question_id, 'value' => $out] : null;

            case 'testimonial':
                $text = self::clean_text(is_array($value) ? ($value['text'] ?? '') : $value);
                if ($text === '') {
                    return null;
                }
                $consent = is_array($value) ? sanitize_key((string) ($value['consent'] ?? 'no')) : 'no';
                if (! in_array($consent, ['named', 'anon', 'no'], true)) {
                    $consent = 'no';
                }
                return ['id' => $question_id, 'value' => ['text' => $text, 'consent' => $consent]];
        }
        return null;
    }

    /* ------------------------------------------------------------------ *
     * Reporting
     * ------------------------------------------------------------------ */

    /**
     * All responses for an event, answers decoded.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function for_event(int $event_id, bool $completed_only = false): array {
        global $wpdb;
        $sql = 'SELECT * FROM ' . Schema::table() . ' WHERE event_id = %d';
        if ($completed_only) {
            $sql .= " AND status = 'complete'";
        }
        $sql .= ' ORDER BY id ASC';
        $rows = $wpdb->get_results($wpdb->prepare($sql, $event_id)) ?: [];
        $out = [];
        foreach ($rows as $r) {
            $decoded = json_decode((string) $r->answers, true);
            $out[] = [
                'id'           => (int) $r->id,
                'segment'      => (string) $r->segment,
                'status'       => (string) $r->status,
                'answers'      => is_array($decoded) ? $decoded : [],
                'submitted_at' => (string) $r->submitted_at,
                'updated_at'   => (string) $r->updated_at,
            ];
        }
        return $out;
    }

    /** @return array{complete:int,partial:int,total:int} */
    public static function stats(int $event_id): array {
        global $wpdb;
        $t = Schema::table();
        $complete = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'complete'", $event_id));
        $partial  = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'partial'", $event_id));
        return ['complete' => $complete, 'partial' => $partial, 'total' => $complete + $partial];
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    private static function clean_token(string $token): string {
        $token = preg_replace('/[^a-f0-9]/i', '', $token) ?? '';
        return strlen($token) === 64 ? strtolower($token) : '';
    }

    /** @param mixed $value */
    private static function clean_text($value): string {
        $v = sanitize_textarea_field((string) $value);
        if (function_exists('mb_substr')) {
            return mb_substr($v, 0, self::OPEN_MAX);
        }
        return substr($v, 0, self::OPEN_MAX);
    }
}
