<?php
declare(strict_types=1);

namespace OE\Membership;

use OE\Connectors\StripeConnector;
use OE\Mail\Transactional;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Membership lifecycle email (BUILD-PLAN M6 — messaging completeness).
 *
 * Turns the Stripe subscription events the plugin already receives into the
 * member-facing emails that were missing: a welcome on the first paid invoice,
 * a renewal confirmation on each billing cycle, a dunning notice when a payment
 * fails, and a cancellation notice when the subscription ends. Tenant-generic —
 * every line interpolates the brand name, nothing references a festival.
 *
 * Only acts on subscriptions billed on a configured membership price (Settings
 * → Membership) and only while membership is enabled, so a site that sells
 * other subscriptions is untouched. Idempotent: each (member, cycle) send is
 * marked for a week so Stripe's webhook retries never double-send.
 *
 * All sends route through the normal transactional mailer; this class never
 * talks to the mail transport directly.
 */
final class Lifecycle {

    /**
     * Route a Stripe webhook event to the matching membership email. Returns
     * true when an email was sent (or deliberately skipped as a duplicate),
     * false when the event is not a membership event this handler owns.
     *
     * @param array<string,mixed> $object the event's data.object
     */
    public static function handle_event(string $type, array $object): bool {
        if (empty(Settings::get('membership_enabled', false))) {
            return false;
        }
        switch ($type) {
            case 'invoice.paid':
            case 'invoice.payment_succeeded':
                return self::on_invoice_paid($object);
            case 'invoice.payment_failed':
                return self::on_payment_failed($object);
            case 'customer.subscription.deleted':
                return self::on_cancelled($object);
        }
        return false;
    }

    /** A paid invoice: welcome on the first one, renewal on each cycle after. */
    private static function on_invoice_paid(array $invoice): bool {
        if (! self::invoice_is_membership($invoice)) {
            return false;
        }
        [$email, $name] = self::recipient($invoice);
        if ($email === '') {
            return false;
        }
        $reason = (string) ($invoice['billing_reason'] ?? '');
        $trigger = ($reason === 'subscription_create') ? 'membership_welcome' : 'membership_renewed';
        // Guard per subscription period so a retry of the same invoice never
        // re-sends, but a genuine new cycle does.
        $period = (string) ($invoice['period_end'] ?? $invoice['id'] ?? '');
        if (! self::claim($trigger . ':' . (string) ($invoice['subscription'] ?? $email) . ':' . $period)) {
            return true; // already handled
        }
        return Transactional::send($trigger, ['email' => $email, 'name' => $name], [
            'contact_name' => $name,
            'renews_on'    => self::period_date($invoice),
        ]);
    }

    /** A failed membership payment: the dunning notice with an update link. */
    private static function on_payment_failed(array $invoice): bool {
        if (! self::invoice_is_membership($invoice)) {
            return false;
        }
        [$email, $name] = self::recipient($invoice);
        if ($email === '') {
            return false;
        }
        $attempt = (string) ($invoice['attempt_count'] ?? $invoice['id'] ?? '');
        if (! self::claim('membership_payment_failed:' . (string) ($invoice['subscription'] ?? $email) . ':' . $attempt)) {
            return true;
        }
        return Transactional::send('membership_payment_failed', ['email' => $email, 'name' => $name], [
            'contact_name' => $name,
            'update_url'   => (string) Settings::get('membership_manage_url', ''),
        ]);
    }

    /** A canceled / ended subscription: the goodbye notice. */
    private static function on_cancelled(array $subscription): bool {
        if (! self::subscription_is_membership($subscription)) {
            return false;
        }
        $cid = (string) ($subscription['customer'] ?? '');
        [$email, $name] = self::customer_recipient($cid);
        if ($email === '') {
            return false;
        }
        if (! self::claim('membership_cancelled:' . (string) ($subscription['id'] ?? $email))) {
            return true;
        }
        return Transactional::send('membership_cancelled', ['email' => $email, 'name' => $name], [
            'contact_name' => $name,
            'rejoin_url'   => (string) Settings::get('membership_join_url', ''),
        ]);
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    /** True when any line on the invoice is billed on a membership price. */
    private static function invoice_is_membership(array $invoice): bool {
        foreach ((array) ($invoice['lines']['data'] ?? []) as $line) {
            $price = (array) ($line['price'] ?? []);
            $pid   = (string) ($price['id'] ?? '');
            $prod  = is_string($price['product'] ?? null) ? (string) $price['product'] : '';
            if (StripeConnector::is_membership_price($pid, $prod)) {
                return true;
            }
        }
        return false;
    }

    /** True when the subscription carries a membership price on any item. */
    private static function subscription_is_membership(array $subscription): bool {
        foreach ((array) ($subscription['items']['data'] ?? []) as $item) {
            $price = (array) ($item['price'] ?? []);
            $pid   = (string) ($price['id'] ?? '');
            $prod  = is_string($price['product'] ?? null) ? (string) $price['product'] : '';
            if (StripeConnector::is_membership_price($pid, $prod)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Recipient email + name from an invoice object (Stripe puts both on it),
     * falling back to the customer record when the invoice omits them.
     *
     * @return array{0:string,1:string}
     */
    private static function recipient(array $invoice): array {
        $email = trim((string) ($invoice['customer_email'] ?? ''));
        $name  = trim((string) ($invoice['customer_name'] ?? ''));
        if ($email !== '') {
            return [is_email($email) ? $email : '', $name];
        }
        return self::customer_recipient((string) ($invoice['customer'] ?? ''));
    }

    /**
     * Recipient email + name from a customer id (one Stripe fetch).
     *
     * @return array{0:string,1:string}
     */
    private static function customer_recipient(string $customer_id): array {
        if ($customer_id === '') {
            return ['', ''];
        }
        $c = StripeConnector::retrieve_customer($customer_id);
        $email = trim((string) ($c['email'] ?? ''));
        return [is_email($email) ? $email : '', trim((string) ($c['name'] ?? ''))];
    }

    /** A human renewal date from the invoice's period end, or '' when unknown. */
    private static function period_date(array $invoice): string {
        $ts = (int) ($invoice['period_end'] ?? $invoice['lines']['data'][0]['period']['end'] ?? 0);
        return $ts > 0 ? date_i18n((string) get_option('date_format', 'F j, Y'), $ts) : '';
    }

    /**
     * Claim a one-shot send: returns true the first time a key is seen, false
     * afterwards (for a week), so webhook retries of the same event never
     * re-send. A short transient, not a growing option.
     */
    private static function claim(string $key): bool {
        $t = 'oe_mbr_' . md5($key);
        if (get_transient($t)) {
            return false;
        }
        set_transient($t, 1, WEEK_IN_SECONDS);
        return true;
    }
}
