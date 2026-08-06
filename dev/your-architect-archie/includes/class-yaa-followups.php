<?php
/**
 * Notifications + partial-submission follow-ups.
 *
 * notify_submit() emails the studio a full, branded project notification (from
 * "Your Architect Submission" <noreply@…>, subject "New Project | <name>"),
 * and — when we captured an address — sends the visitor their own branded
 * summary. A daily cron chases projects that captured an email but never
 * submitted. Mail should go via an SMTP/API plugin on shared hosting.
 *
 * @package Your_Architect_Archie
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class YAA_Followups {

	const HOOK = 'yaa_followups_daily';

	// Brand palette — mirrors the Archie site / admin (navy + accent blue).
	const NAVY  = '#253E94';
	const BLUE  = '#3478DE';
	const INK   = '#1C1C1A';
	const MUTED = '#6b7488';
	const LINE  = '#e6e9f2';
	const FONT  = "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

	public static function init() {
		add_action( self::HOOK, array( __CLASS__, 'run' ) );
	}

	public static function schedule() {
		if ( ! wp_next_scheduled( self::HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK );
		}
	}
	public static function unschedule() {
		$ts = wp_next_scheduled( self::HOOK );
		if ( $ts ) {
			wp_unschedule_event( $ts, self::HOOK );
		}
	}

	/** noreply@<site-domain> — filterable. */
	private static function from_email() {
		$host = preg_replace( '/^www\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
		$from = 'noreply@' . ( $host ? $host : 'yourarchitect.uk' );
		return (string) apply_filters( 'yaa_notify_from_email', $from );
	}

	/** Studio + client emails on submit. */
	public static function notify_submit( $project_id, array $package ) {
		$row = YAA_Project::get( $project_id );
		if ( ! $row ) {
			return;
		}
		$state = YAA_Project::state( $project_id );
		$name  = trim( (string) $row->name );
		$email = (string) $row->email;
		$noreply = self::from_email();

		// ---- Studio notification ----
		$to      = YAA_Settings::get( 'notify_email', get_option( 'admin_email' ) );
		$label   = '' !== $name ? $name : ( $row->postcode ? $row->postcode : ( $row->ref ? $row->ref : 'New enquiry' ) );
		$subject = 'New Project | ' . $label;

		$headers = array(
			'Content-Type: text/html; charset=UTF-8',
			sprintf( 'From: %s <%s>', 'Your Architect Submission', $noreply ),
		);
		// Let the studio reply straight to the client.
		if ( is_email( $email ) ) {
			$headers[] = sprintf( 'Reply-To: %s <%s>', $name ? $name : $email, $email );
		}

		wp_mail( $to, $subject, self::admin_html( $row, $state, $package ), $headers );

		// ---- Visitor confirmation ----
		if ( is_email( $email ) ) {
			$client_headers = array(
				'Content-Type: text/html; charset=UTF-8',
				sprintf( 'From: %s <%s>', 'Your Architect', $noreply ),
			);
			wp_mail( $email, 'Your Architect — your project summary', self::client_html( $row, $state, $package ), $client_headers );
		}
	}

	// -------------------------------------------------------------------------
	// HTML builders
	// -------------------------------------------------------------------------

	/** Full studio notification: contact, every answer, the priced package, flags. */
	private static function admin_html( $row, array $state, array $package ) {
		$total     = YAA_Pricing::money( isset( $package['total'] ) ? (int) $package['total'] : (int) $row->total );
		$ref       = (string) $row->ref;
		$name      = trim( (string) $row->name );
		$email     = (string) $row->email;
		$submitted = $row->submitted_at ? mysql2date( 'j M Y, g:ia', $row->submitted_at ) : mysql2date( 'j M Y, g:ia', current_time( 'mysql' ) );
		$started   = $row->created ? mysql2date( 'j M Y, g:ia', $row->created ) : '';
		$link      = admin_url( 'admin.php?page=yaa-projects&project=' . (int) $row->id );

		// Headline stat + refs.
		$inner  = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
			. '<td style="vertical-align:top;">'
			. '<div style="font-size:12px;color:' . self::MUTED . ';font-weight:600;">Fixed price total</div>'
			. '<div style="font-size:30px;font-weight:800;color:' . self::NAVY . ';line-height:1.1;margin-top:2px;">' . esc_html( $total ) . '</div>'
			. '</td>'
			. '<td align="right" style="vertical-align:top;font-size:13px;color:' . self::MUTED . ';line-height:1.7;">'
			. ( $ref ? 'Ref <strong style="color:' . self::INK . ';">' . esc_html( $ref ) . '</strong><br>' : '' )
			. 'Submitted ' . esc_html( $submitted ) . '<br>'
			. ( $started ? 'Started ' . esc_html( $started ) : '' )
			. '</td></tr></table>';

		// Contact card.
		if ( is_email( $email ) ) {
			$contact = '<strong style="color:' . self::INK . ';font-size:15px;">' . ( $name ? esc_html( $name ) : esc_html__( 'No name provided', 'your-architect-archie' ) ) . '</strong>'
				. ' &middot; <a href="mailto:' . esc_attr( $email ) . '" style="color:' . self::BLUE . ';text-decoration:none;font-weight:600;">' . esc_html( $email ) . '</a>';
		} else {
			$contact = '<strong style="color:' . self::INK . ';font-size:15px;">' . ( $name ? esc_html( $name ) : esc_html__( 'Anonymous', 'your-architect-archie' ) ) . '</strong>'
				. ' &middot; <span style="color:' . self::MUTED . ';">' . esc_html__( 'no email captured', 'your-architect-archie' ) . '</span>';
		}
		$inner .= '<div style="margin-top:16px;padding:14px 16px;background:#f6f8fd;border:1px solid ' . self::LINE . ';border-radius:12px;">' . $contact . '</div>';

		// Every answer.
		$inner .= self::section( __( 'Project details', 'your-architect-archie' ) );
		$inner .= self::answers_table( $state );

		// Priced package.
		$pkg = self::package_table( $package );
		if ( '' !== $pkg ) {
			$inner .= self::section( __( 'Package', 'your-architect-archie' ) );
			$inner .= $pkg;
		}

		// Flags.
		$flags = self::flag_pills( $row );
		if ( '' !== $flags ) {
			$inner .= self::section( __( 'Flags', 'your-architect-archie' ) );
			$inner .= $flags;
		}

		$inner .= self::button( $link, __( 'Open project in admin', 'your-architect-archie' ) );

		$pre = sprintf( '%s — %s', $total, ( $name ? $name : ( $row->postcode ? $row->postcode : __( 'new enquiry', 'your-architect-archie' ) ) ) );
		return self::shell( __( 'New project', 'your-architect-archie' ), __( 'A new project has been submitted', 'your-architect-archie' ), $pre, $inner );
	}

	/** Visitor confirmation: a warm summary of what they told Archie + their fixed price. */
	private static function client_html( $row, array $state, array $package ) {
		$first = trim( (string) $row->name ) ? strtok( trim( (string) $row->name ), ' ' ) : 'there';
		$total = YAA_Pricing::money( isset( $package['total'] ) ? (int) $package['total'] : (int) $row->total );

		$inner  = '<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:' . self::INK . ';">'
			. sprintf( esc_html__( 'Hi %s,', 'your-architect-archie' ), esc_html( $first ) ) . '</p>';
		$inner .= '<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:' . self::INK . ';">'
			. esc_html__( 'Thanks for building your project with Your Architect. Here\'s a summary of everything you told Archie. Our architects will review it and email you a secure link to confirm and pay — you only pay to release the full drawings.', 'your-architect-archie' )
			. '</p>';

		if ( $row->ref ) {
			$inner .= '<p style="margin:0 0 6px;font-size:13px;color:' . self::MUTED . ';">'
				. esc_html__( 'Your reference:', 'your-architect-archie' ) . ' <strong style="color:' . self::INK . ';">' . esc_html( $row->ref ) . '</strong></p>';
		}

		$inner .= self::section( __( 'Your project', 'your-architect-archie' ) );
		$inner .= self::answers_table( $state, array( 'Name', 'Email' ) );

		$pkg = self::package_table( $package );
		if ( '' !== $pkg ) {
			$inner .= self::section( __( 'Your fixed price', 'your-architect-archie' ) );
			$inner .= $pkg;
		}

		$inner .= self::section( __( 'What happens next', 'your-architect-archie' ) );
		$inner .= '<ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;color:' . self::INK . ';">'
			. '<li>' . esc_html__( 'Our architects review your project and confirm the details.', 'your-architect-archie' ) . '</li>'
			. '<li>' . esc_html__( 'We email you a secure link to confirm and pay.', 'your-architect-archie' ) . '</li>'
			. '<li>' . esc_html__( 'We prepare your drawings and send a watermarked preview — you only pay to release the full package.', 'your-architect-archie' ) . '</li>'
			. '</ul>';

		$inner .= '<p style="margin:20px 0 0;font-size:14px;line-height:1.65;color:' . self::MUTED . ';">'
			. esc_html__( 'Questions? Just reply to this email and one of our team will help.', 'your-architect-archie' ) . '</p>';
		$inner .= '<p style="margin:14px 0 0;font-size:15px;color:' . self::INK . ';">— Your Architect</p>';

		$pre = sprintf( esc_html__( 'Your project summary and fixed price (%s).', 'your-architect-archie' ), $total );
		return self::shell( __( 'Your project', 'your-architect-archie' ), __( 'Thanks — here\'s your summary', 'your-architect-archie' ), $pre, $inner );
	}

	// -------------------------------------------------------------------------
	// Shared, email-safe HTML pieces
	// -------------------------------------------------------------------------

	/** Branded outer shell: navy header wordmark, white card, footer. */
	private static function shell( $eyebrow, $heading, $preheader, $inner ) {
		return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
			. '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
			. '<body style="margin:0;padding:0;background:#f4f6fb;">'
			. '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6fb;">' . esc_html( $preheader ) . '</div>'
			. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;">'
			. '<tr><td align="center" style="padding:24px 12px;">'
			. '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ' . self::LINE . ';border-radius:16px;overflow:hidden;font-family:' . self::FONT . ';">'
			// Header.
			. '<tr><td style="background:' . self::NAVY . ';padding:22px 28px;">'
			. '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
			. '<td style="font-size:19px;font-weight:800;color:#ffffff;letter-spacing:.2px;">Your Architect</td>'
			. '<td align="right" style="font-size:11px;font-weight:700;color:#b9c6f2;text-transform:uppercase;letter-spacing:.6px;">' . esc_html( $eyebrow ) . '</td>'
			. '</tr></table></td></tr>'
			// Heading.
			. '<tr><td style="padding:26px 28px 0;"><div style="font-size:21px;font-weight:800;color:' . self::INK . ';">' . esc_html( $heading ) . '</div></td></tr>'
			// Body.
			. '<tr><td style="padding:14px 28px 28px;">' . $inner . '</td></tr>'
			// Footer.
			. '<tr><td style="background:#f8fafe;border-top:1px solid ' . self::LINE . ';padding:18px 28px;font-size:12px;color:#8B8A85;line-height:1.6;">'
			. esc_html__( 'Your Architect — a trading name of Tiam Architects Ltd. ARB-registered, RIBA chartered.', 'your-architect-archie' )
			. '</td></tr>'
			. '</table></td></tr></table></body></html>';
	}

	private static function section( $title ) {
		return '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:' . self::BLUE . ';margin:24px 0 8px;">' . esc_html( $title ) . '</div>';
	}

	/** Every applicable question as a label / value row; unanswered shown muted. */
	private static function answers_table( array $state, array $skip = array() ) {
		$rows = YAA_Archie::answer_summary( $state );
		$html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
		foreach ( $rows as $r ) {
			if ( in_array( $r['label'], $skip, true ) ) {
				continue;
			}
			$val = $r['answered']
				? esc_html( $r['value'] )
				: '<span style="color:#b3b8c4;font-weight:500;">' . esc_html__( 'Not answered', 'your-architect-archie' ) . '</span>';
			$html .= '<tr>'
				. '<td style="padding:9px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:' . self::MUTED . ';width:46%;vertical-align:top;">' . esc_html( $r['label'] ) . '</td>'
				. '<td style="padding:9px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:' . self::INK . ';font-weight:600;text-align:right;vertical-align:top;">' . $val . '</td>'
				. '</tr>';
		}
		$html .= '</table>';
		return $html;
	}

	/** Priced package breakdown + total + delivery/revisions/validity meta. */
	private static function package_table( array $package ) {
		$nodes = isset( $package['nodes'] ) && is_array( $package['nodes'] ) ? $package['nodes'] : array();
		if ( empty( $nodes ) ) {
			return '';
		}
		$html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
		foreach ( $nodes as $n ) {
			if ( isset( $n['kind'] ) && 'info' === $n['kind'] ) {
				continue; // "London project" etc. surfaced as a flag instead.
			}
			$sub   = ! empty( $n['sub'] ) ? '<div style="font-size:12px;color:#8B8A85;margin-top:2px;">' . esc_html( $n['sub'] ) . '</div>' : '';
			$price = ( array_key_exists( 'price', $n ) && null !== $n['price'] )
				? esc_html( YAA_Pricing::money( (int) $n['price'] ) )
				: '<span style="color:#8B8A85;font-weight:600;">' . esc_html__( 'Quote to follow', 'your-architect-archie' ) . '</span>';
			$html .= '<tr>'
				. '<td style="padding:9px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:' . self::INK . ';">' . esc_html( $n['label'] ) . $sub . '</td>'
				. '<td style="padding:9px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:' . self::INK . ';font-weight:700;text-align:right;white-space:nowrap;vertical-align:top;">' . $price . '</td>'
				. '</tr>';
		}
		$total = YAA_Pricing::money( isset( $package['total'] ) ? (int) $package['total'] : 0 );
		$html .= '<tr>'
			. '<td style="padding:12px 0 0;font-size:15px;font-weight:800;color:' . self::NAVY . ';">' . esc_html__( 'Total', 'your-architect-archie' ) . '</td>'
			. '<td style="padding:12px 0 0;font-size:18px;font-weight:800;color:' . self::NAVY . ';text-align:right;">' . esc_html( $total ) . '</td>'
			. '</tr></table>';

		$meta  = isset( $package['meta'] ) && is_array( $package['meta'] ) ? $package['meta'] : array();
		$bits  = array();
		if ( ! empty( $meta['delivery'] ) ) {
			$bits[] = esc_html__( 'Delivery', 'your-architect-archie' ) . ' ' . esc_html( $meta['delivery'] );
		}
		if ( isset( $meta['revisions'] ) ) {
			$bits[] = sprintf( esc_html__( '%d revisions included', 'your-architect-archie' ), (int) $meta['revisions'] );
		}
		if ( ! empty( $meta['validityDays'] ) ) {
			$bits[] = sprintf( esc_html__( 'Quote valid %d days', 'your-architect-archie' ), (int) $meta['validityDays'] );
		}
		if ( $bits ) {
			$html .= '<div style="margin-top:10px;font-size:12px;color:' . self::MUTED . ';">' . implode( ' &nbsp;&middot;&nbsp; ', $bits ) . '</div>';
		}
		return $html;
	}

	/** London / listed / conservation as small pills. */
	private static function flag_pills( $row ) {
		$flags = array();
		if ( ! empty( $row->london ) ) {
			$flags[] = __( 'London / M25', 'your-architect-archie' );
		}
		if ( ! empty( $row->listed ) ) {
			$flags[] = __( 'Listed building', 'your-architect-archie' );
		}
		if ( ! empty( $row->conservation ) ) {
			$flags[] = __( 'Conservation area', 'your-architect-archie' );
		}
		if ( empty( $flags ) ) {
			return '';
		}
		$out = '';
		foreach ( $flags as $f ) {
			$out .= '<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 12px;background:#eaf0ff;color:' . self::NAVY . ';border:1px solid #d5e0ff;border-radius:999px;font-size:12px;font-weight:700;">' . esc_html( $f ) . '</span>';
		}
		return $out;
	}

	private static function button( $url, $label ) {
		return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr>'
			. '<td style="border-radius:10px;background:' . self::NAVY . ';">'
			. '<a href="' . esc_url( $url ) . '" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">' . esc_html( $label ) . '</a>'
			. '</td></tr></table>';
	}

	/** Daily chase of incomplete-but-emailed projects (those still in the started pool). */
	public static function run() {
		global $wpdb;
		$projects = YAA_DB::projects_table();
		$events   = YAA_DB::events_table();
		$rows     = $wpdb->get_results( // phpcs:ignore WordPress.DB
			"SELECT p.* FROM {$projects} p
			 WHERE p.status IN ('partial','quoted')
			   AND p.email IS NOT NULL AND p.email <> ''
			   AND NOT EXISTS ( SELECT 1 FROM {$events} e WHERE e.project_id = p.id AND e.type = 'followup_sent' )
			 ORDER BY p.updated ASC
			 LIMIT 50"
		);
		foreach ( (array) $rows as $p ) {
			$email = (string) $p->email;
			if ( ! is_email( $email ) ) {
				continue;
			}
			wp_mail( $email, 'Your Architect — pick up where you left off', "Your saved project is ready whenever you are — just head back and Archie will resume.\n\n— Your Architect\n", array( 'Content-Type: text/plain; charset=UTF-8' ) );
			YAA_Project::log_event( (int) $p->id, 'followup_sent' );
		}
	}
}
