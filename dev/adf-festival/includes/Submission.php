<?php
declare(strict_types=1);

namespace ADF;

use ADF\Connectors\StripeConnector;
use ADF\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Submission, payment and approval pipeline (§3).
 *
 * This is the shared engine every listing type flows through:
 *   create()  — persist a submission, take payment if a paid tier was chosen,
 *               then either auto-approve (§3.2) or queue for review (§3.1).
 *   approve() — publish, email the approved variant, queue for digest.
 *   reject()  — refund any payment, email the rejection variant.
 *
 * It works identically for the adopted external CPTs (`events`) and our own
 * `adf_*` CPTs because it only ever touches shared `_adf_` meta.
 */
final class Submission {

    /**
     * Create a listing submission.
     *
     * @param string $type     Listing-type key (directory|destination|...).
     * @param array  $data     ['title' => ..., 'content' => ..., 'meta' => [k=>v]].
     * @param int    $account_id Submitting account.
     * @param string $tier     free|featured|premium.
     * @return array{post_id:int,status:string,payment?:array} | \WP_Error
     */
    public static function create(string $type, array $data, int $account_id, string $tier = Fields::TIER_FREE) {
        $slug = PostTypes::slug($type);
        if ($slug === '' || ! in_array($type, PostTypes::listing_types(), true)) {
            return new \WP_Error('adf_invalid_type', __('Unknown listing type.', 'adf-festival'));
        }
        if (! $account_id) {
            return new \WP_Error('adf_no_account', __('A valid account is required.', 'adf-festival'));
        }

        $wp_user = (int) get_post_meta($account_id, '_adf_wp_user_id', true) ?: get_current_user_id();

        // Persist as a draft first so we never lose data if payment fails.
        $post_id = wp_insert_post([
            'post_type'    => $slug,
            'post_status'  => 'draft',
            'post_title'   => sanitize_text_field((string) ($data['title'] ?? __('Untitled submission', 'adf-festival'))),
            'post_content' => wp_kses_post((string) ($data['content'] ?? '')),
            'post_author'  => $wp_user,
        ], true);

        if (is_wp_error($post_id)) {
            return $post_id;
        }
        $post_id = (int) $post_id;

        // Type-specific meta.
        foreach ((array) ($data['meta'] ?? []) as $key => $value) {
            update_post_meta($post_id, '_adf_' . sanitize_key($key), self::sanitize_meta($value));
        }

        // Shared fields.
        Fields::set($post_id, 'submitter_account_id', $account_id);
        Fields::set($post_id, 'listing_type', $type);
        Fields::set($post_id, 'paid_tier', $tier);
        Fields::set($post_id, 'submission_date', current_time('mysql'));
        Fields::set($post_id, 'auto_approved', false);

        AuditLog::record('submission_created', $post_id, $type);

        // Payment step (§3.1.2 / §3.2.2).
        $payment = null;
        $amount  = Settings::price($type, $tier);
        if ($amount > 0) {
            if (! StripeConnector::is_ready()) {
                // Keep the draft so the user can retry once Stripe is configured.
                Fields::set($post_id, 'status', Fields::STATUS_PENDING_PAYMENT);
                return new \WP_Error('adf_stripe_unconfigured', __('Payments are not available right now.', 'adf-festival'));
            }

            $customer = StripeConnector::ensure_customer(
                $account_id,
                Account::email($account_id),
                Account::name($account_id)
            );
            $intent = StripeConnector::create_payment_intent(
                $amount,
                (string) Settings::get('currency', 'usd'),
                $customer,
                ['listing' => $post_id, 'type' => $type, 'tier' => $tier]
            );

            if (($intent['id'] ?? '') === '') {
                Fields::set($post_id, 'status', Fields::STATUS_PENDING_PAYMENT);
                return new \WP_Error('adf_payment_failed', __('Could not start payment.', 'adf-festival'));
            }

            Fields::set($post_id, 'stripe_payment_intent_id', $intent['id']);
            Fields::set($post_id, 'status', Fields::STATUS_PENDING_PAYMENT);

            // The listing only advances once the PaymentIntent succeeds — either
            // via the webhook (charge confirmed) or confirm_payment() below for
            // the synchronous client-confirmed flow.
            $payment = [
                'amount'        => $amount,
                'currency'      => (string) Settings::get('currency', 'usd'),
                'client_secret' => $intent['client_secret'],
                'intent_id'     => $intent['id'],
            ];

            return ['post_id' => $post_id, 'status' => Fields::STATUS_PENDING_PAYMENT, 'payment' => $payment];
        }

        // Free tier — move straight into routing.
        return ['post_id' => $post_id, 'status' => self::route($post_id, $type, $account_id)];
    }

    /**
     * Called once payment is confirmed (webhook or client confirm) to advance a
     * pending_payment listing into the approval routing.
     */
    public static function confirm_payment(string $payment_intent_id): void {
        $post_id = self::find_by_intent($payment_intent_id);
        if (! $post_id) {
            return;
        }
        if (Fields::status($post_id) !== Fields::STATUS_PENDING_PAYMENT) {
            return; // Already processed.
        }

        $type       = (string) Fields::get($post_id, 'listing_type');
        $account_id = (int) Fields::get($post_id, 'submitter_account_id');

        AuditLog::record('payment_confirmed', $post_id, $type, $payment_intent_id);
        Invoice::create($post_id, $payment_intent_id);

        BrevoConnector::send('payment_confirmed', [
            'email' => Account::email($account_id),
            'name'  => Account::name($account_id),
        ], ['listing_name' => get_the_title($post_id)]);

        self::route($post_id, $type, $account_id);
    }

    /**
     * Decide auto-approve vs pending review (§3.1/§3.2). Returns the new status.
     */
    private static function route(int $post_id, string $type, int $account_id): string {
        if (Account::auto_approves($account_id, $type)) {
            self::approve($post_id, true);
            return Fields::STATUS_APPROVED;
        }

        Fields::set($post_id, 'status', Fields::STATUS_PENDING_REVIEW);
        AuditLog::record('queued_for_review', $post_id, $type);

        BrevoConnector::send('submission_received', [
            'email' => Account::email($account_id),
            'name'  => Account::name($account_id),
        ], [
            'listing_name' => get_the_title($post_id),
            'listing_type' => $type,
        ]);

        return Fields::STATUS_PENDING_REVIEW;
    }

    /**
     * Approve a listing (§3.1.6 / §3.2). Publishes it, emails the approved
     * variant and flags it for the digest if requested.
     */
    public static function approve(int $post_id, bool $auto = false): void {
        $type       = (string) Fields::get($post_id, 'listing_type');
        $account_id = (int) Fields::get($post_id, 'submitter_account_id');

        wp_update_post(['ID' => $post_id, 'post_status' => 'publish']);
        Fields::set($post_id, 'status', Fields::STATUS_APPROVED);
        Fields::set($post_id, 'approval_date', current_time('mysql'));
        Fields::set($post_id, 'auto_approved', $auto);

        AuditLog::record($auto ? 'auto_approved_account_flag' : 'approved', $post_id, $type);

        // Subscribe the account to the relevant Brevo segment (§5 lists).
        self::sync_list_membership($type, $account_id, $post_id);

        BrevoConnector::send('submission_approved', [
            'email' => Account::email($account_id),
            'name'  => Account::name($account_id),
        ], [
            'listing_name' => get_the_title($post_id),
            'listing_type' => $type,
            'listing_url'  => get_permalink($post_id),
        ]);
    }

    /**
     * Reject a listing (§3.1.7). Issues a full Stripe refund when a payment was
     * taken, then sends the matching rejection email variant.
     */
    public static function reject(int $post_id): void {
        $type       = (string) Fields::get($post_id, 'listing_type');
        $account_id = (int) Fields::get($post_id, 'submitter_account_id');
        $intent_id  = (string) Fields::get($post_id, 'stripe_payment_intent_id');

        wp_update_post(['ID' => $post_id, 'post_status' => 'draft']);
        Fields::set($post_id, 'status', Fields::STATUS_REJECTED);
        Fields::set($post_id, 'rejection_date', current_time('mysql'));

        $refund_amount = '';
        $with_refund   = false;
        if ($intent_id !== '') {
            $refund_id = StripeConnector::refund($intent_id);
            if ($refund_id !== '') {
                Fields::set($post_id, 'stripe_refund_id', $refund_id);
                $with_refund = true;
                $tier   = Fields::tier($post_id);
                $cents  = Settings::price($type, $tier);
                $refund_amount = self::format_money($cents, (string) Settings::get('currency', 'usd'));
                AuditLog::record('refund_issued', $post_id, $type, $refund_id);
                Invoice::mark_refunded($post_id);
            }
        }

        AuditLog::record('rejected', $post_id, $type);

        $params = [
            'listing_name'  => get_the_title($post_id),
            'listing_type'  => self::type_label($type),
            'refund_amount' => $refund_amount,
            'copy'          => self::rejection_copy($type, get_the_title($post_id), $refund_amount),
        ];
        BrevoConnector::send(
            $with_refund ? 'submission_rejected_refund' : 'submission_rejected_free',
            ['email' => Account::email($account_id), 'name' => Account::name($account_id)],
            $params
        );
    }

    /**
     * Build the rejection email body from the fixed template (§3.3), honouring
     * any admin-overridden copy per listing type.
     */
    public static function rejection_copy(string $type, string $listing_name, string $refund_amount): string {
        $overrides = (array) Settings::get('rejection_copy', []);
        if (! empty($overrides[$type])) {
            $template = (string) $overrides[$type];
        } else {
            $template = __(
                'Thank you for submitting {listing_name} to Atlanta Design Festival. On this occasion our curation panel has decided not to approve this {listing_type}. We look for submissions that reflect the design and architecture culture of Atlanta and its wider creative community — things that would genuinely interest a design-aware visitor or local audience. You are very welcome to submit again. If you have any questions about what we look for, please get in touch.',
                'adf-festival'
            );
            if ($refund_amount !== '') {
                $template .= "\n\n" . sprintf(
                    /* translators: %s: refund amount */
                    __('A full refund of %s has been processed to your original payment method and should appear within 3–5 business days.', 'adf-festival'),
                    '{refund_amount}'
                );
            }
        }

        return strtr($template, [
            '{listing_name}'  => $listing_name,
            '{listing_type}'  => self::type_label($type),
            '{refund_amount}' => $refund_amount,
        ]);
    }

    /* ----------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------- */

    private static function sync_list_membership(string $type, int $account_id, int $post_id): void {
        $lists = (array) Settings::get('brevo_lists', []);
        $email = Account::email($account_id);
        if ($email === '') {
            return;
        }
        $target = [];
        if ($type === 'directory' && isset($lists['adf_directory_listed'])) {
            $target[] = (int) $lists['adf_directory_listed'];
        }
        if (Fields::is_paid($post_id) && isset($lists['adf_partners'])) {
            $target[] = (int) $lists['adf_partners'];
        }
        if ($target) {
            BrevoConnector::upsert_contact($email, [], $target);
        }
    }

    public static function find_by_intent(string $intent_id): int {
        $found = get_posts([
            'post_type'      => PostTypes::listing_slugs(),
            'post_status'    => 'any',
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_key'       => Fields::key('stripe_payment_intent_id'),
            'meta_value'     => $intent_id,
            'no_found_rows'  => true,
        ]);
        return $found ? (int) $found[0] : 0;
    }

    public static function type_label(string $type): string {
        return strtolower(PostTypes::TYPES[$type]['label'] ?? $type);
    }

    public static function format_money(int $cents, string $currency): string {
        $symbol = strtoupper($currency) === 'USD' ? '$' : '';
        return $symbol . number_format($cents / 100, 2);
    }

    private static function sanitize_meta($value) {
        if (is_array($value)) {
            return array_map([self::class, 'sanitize_meta'], $value);
        }
        return is_string($value) ? sanitize_text_field($value) : $value;
    }
}
