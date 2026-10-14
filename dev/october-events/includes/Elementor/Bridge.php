<?php
declare(strict_types=1);

namespace OE\Elementor;

use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Elementor bridge (BUILD-PLAN M3): dynamic tags exposing plugin event data to
 * Elementor, loaded only when Elementor is active and never requiring JetEngine.
 *
 * This is the piece that lets a bespoke Elementor template — e.g. Concrete
 * Communities' — paint the page and bind fields to native plugin data: a
 * **brand-colour** data tag feeds Elementor's color controls (CC's per-event
 * page chrome), and a **field** text/URL tag feeds any text or link widget
 * (name, price, location, organiser, reference number, ticket link, …).
 *
 * The output sections themselves already work inside Elementor via its built-in
 * Shortcode widget (`[oe_event_header]` etc.), so M3 adds the data binding, not a
 * parallel set of widgets.
 *
 * The anonymous tag classes are declared inside the register callback so this
 * file never references an Elementor base class unless Elementor is loaded (the
 * `elementor/dynamic_tags/register` hook only fires then), keeping the plugin
 * safe on installs without Elementor.
 */
final class Bridge {

    private const GROUP = 'october-events';

    public static function init(): void {
        add_action('elementor/dynamic_tags/register', [self::class, 'register']);
        // Back-compat for Elementor < 3.5.
        add_action('elementor/dynamic_tags/register_tags', [self::class, 'register']);
    }

    /** The event id a tag resolves against in the current render context. */
    public static function event_id(): int {
        $id = (int) get_the_ID();
        if (! $id) {
            $id = (int) get_queried_object_id();
        }
        return $id;
    }

    /** Field key => label, for the field-tag select and sanity. */
    public static function field_options(): array {
        return [
            'name'             => __('Name', 'october-events'),
            'start_datetime'   => __('Start', 'october-events'),
            'end_datetime'     => __('End', 'october-events'),
            'price'            => __('Display price', 'october-events'),
            'location'         => __('Location', 'october-events'),
            'organiser'        => __('Organizer', 'october-events'),
            'event_number'     => __('Reference number', 'october-events'),
            'ticket_link'      => __('Ticket link', 'october-events'),
            'ticket_link_text' => __('Ticket link text', 'october-events'),
            'description'      => __('Description', 'october-events'),
        ];
    }

    /** @param object $dynamic_tags Elementor's tags manager. */
    public static function register($dynamic_tags): void {
        if (! class_exists('\\Elementor\\Core\\DynamicTags\\Tag')) {
            return;
        }
        // Register the group (ignore if the manager version lacks the method).
        if (method_exists($dynamic_tags, 'register_group')) {
            $dynamic_tags->register_group(self::GROUP, ['title' => __('October Events', 'october-events')]);
        }

        $text_cat  = \Elementor\Modules\DynamicTags\Module::TEXT_CATEGORY;
        $url_cat   = \Elementor\Modules\DynamicTags\Module::URL_CATEGORY;
        $color_cat = \Elementor\Modules\DynamicTags\Module::COLOR_CATEGORY;
        $group     = self::GROUP;

        // Field tag: text/URL from any mapped event field.
        $field_tag = new class($text_cat, $url_cat, $group) extends \Elementor\Core\DynamicTags\Tag {
            private $cats; private $grp;
            public function __construct($text, $url, $grp, $data = [], $args = null) {
                $this->cats = [$text, $url];
                $this->grp  = $grp;
                parent::__construct($data, $args);
            }
            public function get_name()       { return 'oe-field'; }
            public function get_title()      { return __('October Events field', 'october-events'); }
            public function get_group()      { return $this->grp; }
            public function get_categories() { return $this->cats; }
            protected function register_controls() {
                $this->add_control('oe_field', [
                    'label'   => __('Field', 'october-events'),
                    'type'    => \Elementor\Controls_Manager::SELECT,
                    'options' => \OE\Elementor\Bridge::field_options(),
                    'default' => 'name',
                ]);
            }
            public function render() {
                $id = \OE\Elementor\Bridge::event_id();
                if (! $id) { return; }
                $field = (string) $this->get_settings('oe_field');
                if ($field === '') { return; }
                echo wp_kses_post((string) \OE\Planning\Events::get($id, $field, ''));
            }
        };

        // Brand-colour tag: feeds Elementor color controls (CC's page chrome).
        $colour_tag = new class($color_cat, $group) extends \Elementor\Core\DynamicTags\Data_Tag {
            private $cats; private $grp;
            public function __construct($color, $grp, $data = [], $args = null) {
                $this->cats = [$color];
                $this->grp  = $grp;
                parent::__construct($data, $args);
            }
            public function get_name()       { return 'oe-brand-colour'; }
            public function get_title()      { return __('October Events brand color', 'october-events'); }
            public function get_group()      { return $this->grp; }
            public function get_categories() { return $this->cats; }
            protected function get_value(array $options = []) {
                $id = \OE\Elementor\Bridge::event_id();
                return $id ? (string) \OE\Planning\Events::get($id, 'brand_colour', '') : '';
            }
        };

        $dynamic_tags->register($field_tag);
        $dynamic_tags->register($colour_tag);
    }
}
