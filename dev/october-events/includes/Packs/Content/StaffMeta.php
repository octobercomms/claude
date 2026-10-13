<?php
declare(strict_types=1);

namespace OE\Packs\Content;

defined('ABSPATH') || exit;

/**
 * Staff pack entry UI (FRONTEND-BUILD slice E).
 *
 * A non-shift roles repeater on the event editor, stored via Store
 * (`_oe_staff_roles`). Each role carries a description and an application email;
 * the public page shows the role with an apply-by-email form (StaffApply).
 */
final class StaffMeta extends RepeaterMetabox {

    protected static function box_id(): string {
        return 'oe-staff';
    }

    protected static function box_title(): string {
        return __('Staff / non-shift roles', 'october-events');
    }

    protected static function pack(): string {
        return 'staff';
    }

    protected static function intro(bool $enabled): string {
        return $enabled
            ? (string) __('The Staff pack is on, so these roles show on the event page with an apply-by-email form.', 'october-events')
            : (string) __('Fill this in now; it shows once the Staff pack is switched on under Capabilities.', 'october-events');
    }

    protected static function repeaters(): array {
        return [
            'roles' => [__('Roles', 'october-events'), [
                'role'        => [__('Role', 'october-events'), 'text'],
                'description' => [__('Description', 'october-events'), 'textarea'],
                'apply_email' => [__('Applications go to (email)', 'october-events'), 'text'],
            ]],
        ];
    }
}
