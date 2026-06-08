<?php
/**
 * Event listeners — hooks WooCommerce + WordPress events and pushes them to the
 * platform via OctoberMI_Client.
 *
 * Every handler gracefully no-ops when the relevant plugin (WooCommerce, Yoast,
 * Rank Math, Gravity Forms, CF7) is inactive, so the plugin is safe to run on
 * any site. Nothing is back-filled: only events that fire after pairing are
 * pushed (connected_at is the cut-off).
 *
 * Builders return compact, non-PII-heavy snapshots; the platform is the system
 * of record for analytics, not a mirror of the whole store.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OctoberMI_Events {

	/** Guard so we never register twice. */
	private static $booted = false;

	public static function init() {
		if ( self::$booted ) {
			return;
		}
		self::$booted = true;

		// --- WooCommerce: orders ------------------------------------------
		if ( self::woo_active() ) {
			add_action( 'woocommerce_new_order', array( __CLASS__, 'on_order' ), 10, 1 );
			add_action( 'woocommerce_update_order', array( __CLASS__, 'on_order' ), 10, 1 );
			add_action( 'woocommerce_order_status_refunded', array( __CLASS__, 'on_order_refunded' ), 10, 1 );

			// --- WooCommerce: customers -----------------------------------
			add_action( 'woocommerce_created_customer', array( __CLASS__, 'on_customer_created' ), 10, 1 );
			add_action( 'woocommerce_update_customer', array( __CLASS__, 'on_customer_updated' ), 10, 1 );

			// --- WooCommerce: products ------------------------------------
			add_action( 'woocommerce_new_product', array( __CLASS__, 'on_product_save' ), 10, 1 );
			add_action( 'woocommerce_update_product', array( __CLASS__, 'on_product_save' ), 10, 1 );
			add_action( 'woocommerce_new_product_variation', array( __CLASS__, 'on_product_save' ), 10, 1 );
			add_action( 'woocommerce_update_product_variation', array( __CLASS__, 'on_product_save' ), 10, 1 );

			// --- WooCommerce: inventory -----------------------------------
			add_action( 'woocommerce_product_set_stock', array( __CLASS__, 'on_stock_change' ), 10, 1 );
			add_action( 'woocommerce_variation_set_stock', array( __CLASS__, 'on_stock_change' ), 10, 1 );
			add_action( 'woocommerce_product_set_stock_status', array( __CLASS__, 'on_stock_status_change' ), 10, 3 );
		}

		// --- Product deletion (works via trash/delete on the product CPT) -
		add_action( 'wp_trash_post', array( __CLASS__, 'maybe_on_product_delete' ), 10, 1 );
		add_action( 'before_delete_post', array( __CLASS__, 'maybe_on_product_delete' ), 10, 1 );

		// --- WordPress: content (posts/pages) -----------------------------
		add_action( 'save_post', array( __CLASS__, 'on_save_post' ), 20, 3 );

		// --- Form submissions ---------------------------------------------
		if ( class_exists( 'GFForms' ) || function_exists( 'gravity_form' ) ) {
			add_action( 'gform_after_submission', array( __CLASS__, 'on_gravity_submission' ), 10, 2 );
		}
		// Contact Form 7.
		add_action( 'wpcf7_mail_sent', array( __CLASS__, 'on_cf7_submission' ), 10, 1 );
	}

	// =====================================================================
	// Capability checks
	// =====================================================================

	private static function woo_active() {
		return class_exists( 'WooCommerce' );
	}

	/** Don't push events for objects created before the site was paired. */
	private static function before_cutoff( $timestamp ) {
		$connected_at = (int) OctoberMI_Settings::get( 'connected_at', 0 );
		return $connected_at > 0 && (int) $timestamp < $connected_at;
	}

	// =====================================================================
	// Orders
	// =====================================================================

	public static function on_order( $order_id ) {
		$order = self::get_order( $order_id );
		if ( ! $order ) {
			return;
		}
		OctoberMI_Client::send( 'orders', array(
			'event' => 'order.upserted',
			'order' => self::order_snapshot( $order ),
		), 'order.upserted' );
	}

	public static function on_order_refunded( $order_id ) {
		$order = self::get_order( $order_id );
		if ( ! $order ) {
			return;
		}
		OctoberMI_Client::send( 'orders', array(
			'event' => 'order.refunded',
			'order' => self::order_snapshot( $order ),
		), 'order.refunded' );
	}

	private static function get_order( $order_id ) {
		if ( ! function_exists( 'wc_get_order' ) ) {
			return null;
		}
		$order = wc_get_order( $order_id );
		return $order ? $order : null;
	}

	private static function order_snapshot( $order ) {
		$items = array();
		foreach ( $order->get_items() as $item ) {
			$items[] = array(
				'product_id' => (int) $item->get_product_id(),
				'name'       => $item->get_name(),
				'quantity'   => (int) $item->get_quantity(),
				'total'      => (float) $item->get_total(),
			);
		}

		return array(
			'id'           => $order->get_id(),
			'number'       => $order->get_order_number(),
			'status'       => $order->get_status(),
			'currency'     => $order->get_currency(),
			'total'        => (float) $order->get_total(),
			'subtotal'     => (float) $order->get_subtotal(),
			'total_tax'    => (float) $order->get_total_tax(),
			'discount'     => (float) $order->get_total_discount(),
			'customer_id'  => (int) $order->get_customer_id(),
			'email'        => $order->get_billing_email(),
			'date_created' => $order->get_date_created() ? $order->get_date_created()->getTimestamp() : null,
			'date_paid'    => $order->get_date_paid() ? $order->get_date_paid()->getTimestamp() : null,
			'payment_method' => $order->get_payment_method(),
			'items'        => $items,
		);
	}

	// =====================================================================
	// Customers
	// =====================================================================

	public static function on_customer_created( $customer_id ) {
		self::push_customer( $customer_id, 'customer.created' );
	}

	public static function on_customer_updated( $customer_id ) {
		self::push_customer( $customer_id, 'customer.updated' );
	}

	private static function push_customer( $customer_id, $event ) {
		if ( ! function_exists( 'wc_get_customer_default_location' ) || ! class_exists( 'WC_Customer' ) ) {
			return;
		}
		$customer = new WC_Customer( (int) $customer_id );
		if ( ! $customer->get_id() ) {
			return;
		}
		OctoberMI_Client::send( 'customers', array(
			'event'    => $event,
			'customer' => array(
				'id'           => $customer->get_id(),
				'email'        => $customer->get_email(),
				'first_name'   => $customer->get_first_name(),
				'last_name'    => $customer->get_last_name(),
				'username'     => $customer->get_username(),
				'date_created' => $customer->get_date_created() ? $customer->get_date_created()->getTimestamp() : null,
				'orders_count' => (int) $customer->get_order_count(),
				'total_spent'  => (float) $customer->get_total_spent(),
				'country'      => $customer->get_billing_country(),
				'city'         => $customer->get_billing_city(),
				'postcode'     => $customer->get_billing_postcode(),
			),
		), $event );
	}

	// =====================================================================
	// Products + inventory
	// =====================================================================

	public static function on_product_save( $product_id ) {
		$product = self::get_product( $product_id );
		if ( ! $product ) {
			return;
		}
		OctoberMI_Client::send( 'products', array(
			'event'   => 'product.upserted',
			'product' => self::product_snapshot( $product ),
		), 'product.upserted' );
	}

	/** Fires for any post trash/delete; only acts on WooCommerce products. */
	public static function maybe_on_product_delete( $post_id ) {
		if ( 'product' !== get_post_type( $post_id ) && 'product_variation' !== get_post_type( $post_id ) ) {
			return;
		}
		OctoberMI_Client::send( 'products', array(
			'event'   => 'product.deleted',
			'product' => array( 'id' => (int) $post_id ),
		), 'product.deleted' );
	}

	private static function get_product( $product_id ) {
		if ( ! function_exists( 'wc_get_product' ) ) {
			return null;
		}
		$product = wc_get_product( $product_id );
		return $product ? $product : null;
	}

	private static function product_snapshot( $product ) {
		return array(
			'id'             => $product->get_id(),
			'type'           => $product->get_type(),
			'name'           => $product->get_name(),
			'sku'            => $product->get_sku(),
			'status'         => $product->get_status(),
			'price'          => (float) $product->get_price(),
			'regular_price'  => (float) $product->get_regular_price(),
			'sale_price'     => '' !== $product->get_sale_price() ? (float) $product->get_sale_price() : null,
			'stock_quantity' => $product->get_stock_quantity(),
			'stock_status'   => $product->get_stock_status(),
			'categories'     => wp_get_post_terms( $product->get_id(), 'product_cat', array( 'fields' => 'names' ) ),
			'permalink'      => get_permalink( $product->get_id() ),
		);
	}

	public static function on_stock_change( $product ) {
		if ( ! is_object( $product ) || ! method_exists( $product, 'get_id' ) ) {
			return;
		}
		OctoberMI_Client::send( 'inventory', array(
			'event'     => 'inventory.changed',
			'inventory' => array(
				'product_id'     => $product->get_id(),
				'sku'            => method_exists( $product, 'get_sku' ) ? $product->get_sku() : '',
				'stock_quantity' => $product->get_stock_quantity(),
				'stock_status'   => $product->get_stock_status(),
			),
		), 'inventory.changed' );
	}

	public static function on_stock_status_change( $product_id, $stock_status, $product = null ) {
		OctoberMI_Client::send( 'inventory', array(
			'event'     => 'inventory.status_changed',
			'inventory' => array(
				'product_id'   => (int) $product_id,
				'stock_status' => $stock_status,
			),
		), 'inventory.status_changed' );
	}

	// =====================================================================
	// Content (posts / pages) + SEO
	// =====================================================================

	public static function on_save_post( $post_id, $post, $update ) {
		// Ignore autosaves, revisions, and non-public types we don't care about.
		if ( wp_is_post_autosave( $post_id ) || wp_is_post_revision( $post_id ) ) {
			return;
		}
		if ( 'auto-draft' === $post->post_status || 'trash' === $post->post_status ) {
			return;
		}

		// WooCommerce products are handled by their own hooks.
		if ( in_array( $post->post_type, array( 'product', 'product_variation' ), true ) ) {
			return;
		}

		// Only public content types: posts, pages and other public CPTs.
		$type = get_post_type_object( $post->post_type );
		if ( ! $type || empty( $type->public ) ) {
			return;
		}

		if ( 'publish' !== $post->post_status ) {
			return;
		}

		OctoberMI_Client::send( 'content', array(
			'event'   => $update ? 'content.updated' : 'content.published',
			'content' => array(
				'id'        => (int) $post_id,
				'type'      => $post->post_type,
				'title'     => get_the_title( $post_id ),
				'status'    => $post->post_status,
				'slug'      => $post->post_name,
				'permalink' => get_permalink( $post_id ),
				'author'    => (int) $post->post_author,
				'modified'  => get_post_modified_time( 'U', true, $post_id ),
				'excerpt'   => wp_trim_words( wp_strip_all_tags( $post->post_content ), 40 ),
			),
		), 'content.saved' );

		// SEO score, if a supported SEO plugin is present.
		self::maybe_push_seo( $post_id, $post );
	}

	private static function maybe_push_seo( $post_id, $post ) {
		$seo = null;

		// Yoast stores the readability/SEO score in postmeta.
		if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Meta' ) ) {
			$seo = array(
				'provider'         => 'yoast',
				'seo_score'        => get_post_meta( $post_id, '_yoast_wpseo_linkdex', true ),
				'readability'      => get_post_meta( $post_id, '_yoast_wpseo_content_score', true ),
				'focus_keyword'    => get_post_meta( $post_id, '_yoast_wpseo_focuskw', true ),
				'meta_description' => get_post_meta( $post_id, '_yoast_wpseo_metadesc', true ),
				'seo_title'        => get_post_meta( $post_id, '_yoast_wpseo_title', true ),
			);
		} elseif ( class_exists( 'RankMath' ) || defined( 'RANK_MATH_VERSION' ) ) {
			$seo = array(
				'provider'         => 'rankmath',
				'seo_score'        => get_post_meta( $post_id, 'rank_math_seo_score', true ),
				'focus_keyword'    => get_post_meta( $post_id, 'rank_math_focus_keyword', true ),
				'meta_description' => get_post_meta( $post_id, 'rank_math_description', true ),
				'seo_title'        => get_post_meta( $post_id, 'rank_math_title', true ),
			);
		}

		if ( null === $seo ) {
			return;
		}

		OctoberMI_Client::send( 'seo', array(
			'event' => 'seo.scored',
			'seo'   => array_merge( array(
				'post_id'   => (int) $post_id,
				'post_type' => $post->post_type,
				'permalink' => get_permalink( $post_id ),
			), $seo ),
		), 'seo.scored' );
	}

	// =====================================================================
	// Form submissions
	// =====================================================================

	public static function on_gravity_submission( $entry, $form ) {
		$fields = array();
		if ( is_array( $form ) && ! empty( $form['fields'] ) ) {
			foreach ( $form['fields'] as $field ) {
				$id    = isset( $field->id ) ? $field->id : null;
				$label = isset( $field->label ) ? $field->label : '';
				if ( null !== $id && isset( $entry[ $id ] ) ) {
					$fields[ $label ] = $entry[ $id ];
				}
			}
		}

		OctoberMI_Client::send( 'form-submission', array(
			'event' => 'form.submitted',
			'form'  => array(
				'provider'  => 'gravityforms',
				'form_id'   => isset( $form['id'] ) ? (int) $form['id'] : 0,
				'form_name' => isset( $form['title'] ) ? $form['title'] : '',
				'entry_id'  => isset( $entry['id'] ) ? (int) $entry['id'] : 0,
				'fields'    => $fields,
			),
		), 'form.submitted' );
	}

	public static function on_cf7_submission( $contact_form ) {
		$submission = class_exists( 'WPCF7_Submission' ) ? WPCF7_Submission::get_instance() : null;
		$data       = $submission ? $submission->get_posted_data() : array();

		OctoberMI_Client::send( 'form-submission', array(
			'event' => 'form.submitted',
			'form'  => array(
				'provider'  => 'contactform7',
				'form_id'   => is_object( $contact_form ) && method_exists( $contact_form, 'id' ) ? (int) $contact_form->id() : 0,
				'form_name' => is_object( $contact_form ) && method_exists( $contact_form, 'title' ) ? $contact_form->title() : '',
				'fields'    => is_array( $data ) ? $data : array(),
			),
		), 'form.submitted' );
	}
}
