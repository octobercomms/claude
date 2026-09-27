<?php
declare(strict_types=1);

namespace OE\Survey;

use OE\AI\Assistant;
use OE\Connectors\ClaudeConnector;
use OE\Planning\Events;
use OE\PostTypes;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Per-event survey configuration: the enable flag, the question set, the
 * incentive code, timing, plus the design rules that keep the survey short and
 * the Claude question-writer.
 *
 * The four-question cap and the research behind it live here (see advice()) so
 * they are shown in the builder, right where questions are added.
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md
 */
final class Config {

    /** Hard cap on live, cap-counting questions (§4a). */
    public const MAX_QUESTIONS = 4;

    /** Question types the builder and form understand. */
    public const TYPES = ['rating', 'choice', 'multi', 'open', 'session_rating', 'testimonial'];

    /** Types that sit outside the four-question cap (§4a). */
    public const OFFCAP_TYPES = ['session_rating', 'testimonial'];

    /**
     * The event post type the builder attaches to and the sender scans — the
     * configured location post type, falling back to the events CPT. Both the
     * metabox and the cron use this so they never target different types.
     */
    public static function post_type(): string {
        $pt = (string) Settings::get('location_post_type', '');
        return $pt !== '' ? $pt : PostTypes::slug('event');
    }

    /* ------------------------------------------------------------------ *
     * Meta accessors
     * ------------------------------------------------------------------ */

    public static function enabled(int $event_id): bool {
        return (bool) get_post_meta($event_id, '_oe_survey_enabled', true);
    }

    public static function incentive_code(int $event_id): string {
        return strtoupper(trim((string) get_post_meta($event_id, '_oe_survey_incentive_code', true)));
    }

    public static function send_days_after(int $event_id): int {
        $v = (int) get_post_meta($event_id, '_oe_survey_send_days_after', true);
        return $v > 0 ? $v : 1;
    }

    public static function window_days(int $event_id): int {
        $v = (int) get_post_meta($event_id, '_oe_survey_window_days', true);
        return $v > 0 ? $v : 14;
    }

    public static function sent_at(int $event_id): string {
        return (string) get_post_meta($event_id, '_oe_survey_sent_at', true);
    }

    public static function mark_sent(int $event_id): void {
        update_post_meta($event_id, '_oe_survey_sent_at', current_time('mysql'));
    }

    /**
     * The stored question set, normalised.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function questions(int $event_id): array {
        $raw = get_post_meta($event_id, '_oe_survey_questions', true);
        if (is_string($raw) && $raw !== '') {
            $raw = json_decode($raw, true);
        }
        return is_array($raw) ? array_values(array_filter($raw, 'is_array')) : [];
    }

    /**
     * Whether the survey is live enough to send: enabled and at least one
     * cap-counting question, the first of which is a rating.
     */
    public static function is_ready(int $event_id): bool {
        if (! self::enabled($event_id)) {
            return false;
        }
        $core = array_values(array_filter(
            self::questions($event_id),
            static fn(array $q): bool => ! in_array((string) ($q['type'] ?? ''), self::OFFCAP_TYPES, true)
        ));
        return $core !== [] && (string) ($core[0]['type'] ?? '') === 'rating';
    }

    /* ------------------------------------------------------------------ *
     * Validation (used on save and on the AI draft)
     * ------------------------------------------------------------------ */

    /**
     * Sanitise and cap a raw question set. Enforces: max four cap-counting
     * questions; the first cap-counting question is a rating; at most one
     * session_rating and one testimonial (both off-cap); options/sessions
     * present where the type needs them. Anything malformed is dropped rather
     * than saved half-formed.
     *
     * @param array<int,mixed> $raw
     * @return array<int,array<string,mixed>>
     */
    public static function sanitize_questions(array $raw): array {
        $out = [];
        $core = 0;
        $seen_offcap = [];
        foreach ($raw as $q) {
            if (! is_array($q)) {
                continue;
            }
            $type = (string) ($q['type'] ?? '');
            if (! in_array($type, self::TYPES, true)) {
                continue;
            }
            $label = sanitize_text_field((string) ($q['label'] ?? ''));
            if ($label === '' && $type !== 'session_rating') {
                continue;
            }

            $offcap = in_array($type, self::OFFCAP_TYPES, true);
            if ($offcap) {
                if (isset($seen_offcap[$type])) {
                    continue; // at most one of each off-cap type
                }
                $seen_offcap[$type] = true;
            } else {
                if ($core >= self::MAX_QUESTIONS) {
                    continue; // hard cap
                }
                $core++;
            }

            $item = ['id' => self::qid($q, $out), 'type' => $type, 'label' => $label];

            if (in_array($type, ['choice', 'multi'], true)) {
                $opts = [];
                foreach ((array) ($q['options'] ?? []) as $opt) {
                    $opt = sanitize_text_field((string) $opt);
                    if ($opt !== '') {
                        $opts[] = $opt;
                    }
                }
                $opts = array_values(array_unique($opts));
                if (count($opts) < 2) {
                    continue; // a choice with fewer than two options is not a choice
                }
                $item['options'] = $opts;
            }

            if ($type === 'session_rating') {
                $sessions = [];
                foreach ((array) ($q['sessions'] ?? []) as $s) {
                    $s = sanitize_text_field((string) $s);
                    if ($s !== '') {
                        $sessions[] = $s;
                    }
                }
                $sessions = array_values(array_unique($sessions));
                if ($sessions === []) {
                    continue; // nothing to rate
                }
                $item['sessions'] = $sessions;
                if ($item['label'] === '') {
                    $item['label'] = __('Rate each session', 'october-events');
                }
            }

            $out[] = $item;
        }

        // The first cap-counting question must be a rating; if it is not, and a
        // rating exists later, move it to the front. This mirrors the builder's
        // own rule and keeps a saved survey valid even if reordered oddly.
        $out = self::rating_first($out);
        return $out;
    }

    /**
     * @param array<int,array<string,mixed>> $questions
     * @return array<int,array<string,mixed>>
     */
    private static function rating_first(array $questions): array {
        $core_indexes = [];
        foreach ($questions as $i => $q) {
            if (! in_array((string) $q['type'], self::OFFCAP_TYPES, true)) {
                $core_indexes[] = $i;
            }
        }
        if ($core_indexes === []) {
            return $questions;
        }
        $first = $core_indexes[0];
        if ((string) $questions[$first]['type'] === 'rating') {
            return $questions;
        }
        foreach ($core_indexes as $i) {
            if ((string) $questions[$i]['type'] === 'rating') {
                $rating = $questions[$i];
                unset($questions[$i]);
                array_splice($questions, $first, 0, [$rating]);
                return array_values($questions);
            }
        }
        return $questions;
    }

    /**
     * A stable id for a question: reuse the given one if it is a clean slug and
     * not already taken, else mint a short unique one.
     *
     * @param array<string,mixed> $q
     * @param array<int,array<string,mixed>> $sofar
     */
    private static function qid(array $q, array $sofar): string {
        $taken = array_column($sofar, 'id');
        $id = sanitize_key((string) ($q['id'] ?? ''));
        if ($id !== '' && ! in_array($id, $taken, true)) {
            return $id;
        }
        do {
            $id = 'q' . substr(bin2hex(random_bytes(3)), 0, 6);
        } while (in_array($id, $taken, true));
        return $id;
    }

    /* ------------------------------------------------------------------ *
     * Timing — when the survey opens and closes
     * ------------------------------------------------------------------ */

    /**
     * The event's effective end, as a unix timestamp: the end datetime, or the
     * start if there is no separate end, or 0 when neither is set.
     */
    public static function end_ts(int $event_id): int {
        $end = (string) Events::get($event_id, 'end_datetime', '');
        if ($end === '') {
            $end = (string) Events::get($event_id, 'start_datetime', '');
        }
        return $end !== '' ? (int) (strtotime($end) ?: 0) : 0;
    }

    /** Responses are accepted from the day the event ends. */
    public static function opens_ts(int $event_id): int {
        return self::end_ts($event_id);
    }

    /**
     * The link stops accepting responses this many days after the event ends —
     * but never before the same window has elapsed from the moment invites went
     * out. Otherwise a survey configured to send well after the event (send_days
     * larger than the window) would email a link that is already closed.
     */
    public static function closes_ts(int $event_id): int {
        $end = self::end_ts($event_id);
        if ($end <= 0) {
            return 0;
        }
        $window = self::window_days($event_id) * DAY_IN_SECONDS;
        $close  = $end + $window;
        $sent   = self::sent_at($event_id);
        if ($sent !== '') {
            $sent_ts = (int) (strtotime($sent) ?: 0);
            if ($sent_ts > 0) {
                $close = max($close, $sent_ts + $window);
            }
        }
        return $close;
    }

    /**
     * Whether the survey is currently accepting responses for this event:
     * ready, past the event end, and inside the window.
     */
    public static function is_open(int $event_id): bool {
        if (! self::is_ready($event_id)) {
            return false;
        }
        $now   = current_time('timestamp');
        $open  = self::opens_ts($event_id);
        $close = self::closes_ts($event_id);
        return $open > 0 && $now >= $open && ($close === 0 || $now <= $close);
    }

    /* ------------------------------------------------------------------ *
     * Design advice (shown in the builder) — quoted, with sources
     * ------------------------------------------------------------------ */

    /**
     * Evidence-based guidance rendered beside the question builder. Each item is
     * a short principle plus a quoted finding and the source it came from, so the
     * person writing the survey sees why the rules exist.
     *
     * @return array<int,array{principle:string,quote:string,source:string,url:string}>
     */
    public static function advice(): array {
        return [
            [
                'principle' => __('Keep it to four questions. Every extra one loses people.', 'october-events'),
                'quote'     => __('A 10 question survey has an 89% completion rate on average… 30 question surveys at 85%. When a survey has 40 questions, the completion rate is 79%. Nearly half of respondents (48%) are willing to spend only 1–5 minutes on a survey.', 'october-events'),
                'source'    => 'SurveyMonkey — Survey response rate benchmarks',
                'url'       => 'https://www.surveymonkey.com/learn/survey-best-practices/survey-response-rate-benchmarks/',
            ],
            [
                'principle' => __('Open with a tap, not a text box. Keep open-ended questions to one, last.', 'october-events'),
                'quote'     => __('Surveys that opened with a simple, multiple-choice question had an 89% completion rate on average, while surveys that began with an open-ended question had a significantly lower completion rate at 83%. Surveys with 10 open-ended questions have a mean completion rate more than 10 points lower than those with 1 (78% vs. 88%).', 'october-events'),
                'source'    => 'SurveyMonkey — Get your first question right',
                'url'       => 'https://www.surveymonkey.com/curiosity/want-higher-completion-rates-get-your-first-question-right/',
            ],
            [
                'principle' => __('Ask one thing at a time, in plain, neutral words.', 'october-events'),
                'quote'     => __('Ask only one question at a time. Questions that ask respondents to evaluate more than one concept (double-barreled questions) are difficult to answer and often lead to responses that are difficult to interpret. Questions that use simple and concrete language are more easily understood.', 'october-events'),
                'source'    => 'Pew Research Center — Writing survey questions',
                'url'       => 'https://www.pewresearch.org/writing-survey-questions/',
            ],
        ];
    }

    /* ------------------------------------------------------------------ *
     * Claude question-writer (§6)
     * ------------------------------------------------------------------ */

    public static function ai_ready(): bool {
        return Assistant::is_ready();
    }

    /**
     * Ask Claude to draft a survey for this event, obeying the four-question
     * rules. Returns a sanitised, cap-enforced question set (possibly empty on
     * failure — the caller shows a message, nothing is saved automatically).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function suggest_questions(int $event_id): array {
        if (! self::ai_ready()) {
            return [];
        }
        $name = get_the_title($event_id) ?: __('this event', 'october-events');
        $when = (string) Events::get($event_id, 'start_datetime', '');

        $system = 'You are designing a post-event survey. Return ONLY strict JSON: '
            . 'an array of at most four objects, each {"type","label","options"?}. '
            . 'Rules: the first question is a single 1-5 rating of the overall experience (type "rating"). '
            . 'Include at most one open-ended question (type "open"), placed last, phrased as a specific '
            . 'decision such as "What one thing would you change?". Every other question is a single-select '
            . '(type "choice") or multi-select (type "multi") whose answer would change a real decision the '
            . 'organiser makes. For choice/multi include an "options" array of 2-6 short options. '
            . 'One idea per question (no double-barrelled questions), neutral wording, no demographic '
            . 'questions unless they change programming, no filler. Labels under 90 characters. No prose, JSON only.';

        $user = 'Event name: ' . $name . '. '
            . ($when !== '' ? ('Held: ' . $when . '. ') : '')
            . 'Design the four highest-signal questions for attendees to answer on their phone the day after.';

        // Use the one-shot completion (with our own system prompt and no tools),
        // not Assistant::ask() — that entry point forces the operations-assistant
        // system prompt and attaches the ops tool loop, which would derail a
        // structured JSON draft.
        $reply = ClaudeConnector::message($user, 1024, $system);
        if ($reply === null) {
            return [];
        }

        $json = self::extract_json($reply);
        if ($json === null) {
            return [];
        }
        return self::sanitize_questions($json);
    }

    /**
     * Pull the first JSON array out of a model reply (it may wrap it in prose or
     * a code fence despite instructions).
     *
     * @return array<int,mixed>|null
     */
    private static function extract_json(string $reply): ?array {
        $reply = trim($reply);
        if ($reply === '') {
            return null;
        }
        $start = strpos($reply, '[');
        $end   = strrpos($reply, ']');
        if ($start === false || $end === false || $end <= $start) {
            return null;
        }
        $slice = substr($reply, $start, $end - $start + 1);
        $data  = json_decode($slice, true);
        return is_array($data) ? $data : null;
    }

    /**
     * A sensible starter set, used when the builder is first opened on an event
     * with no questions and the admin clicks "Use a starter survey".
     *
     * @return array<int,array<string,mixed>>
     */
    public static function starter_questions(): array {
        return self::sanitize_questions([
            ['type' => 'rating', 'label' => __('Overall, how was the event?', 'october-events')],
            ['type' => 'choice', 'label' => __('Why did you come?', 'october-events'), 'options' => [
                __('To learn', 'october-events'),
                __('To network', 'october-events'),
                __('For business', 'october-events'),
                __('For inspiration', 'october-events'),
                __('A specific speaker or session', 'october-events'),
            ]],
            ['type' => 'open', 'label' => __('What one thing should we change next time?', 'october-events')],
        ]);
    }
}
