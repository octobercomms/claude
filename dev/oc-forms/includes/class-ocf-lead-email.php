<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Builds the "new lead" notification email — subject template + styled
 * HTML body with logo, bold labels, and human-friendly formatted values
 * (no more raw JSON for arrays / address objects).
 *
 * Templating placeholders on the subject:
 *   {site}   - blog name
 *   {form}   - form (post) title
 *   {email}  - the lead's email address
 */
class OCF_Lead_Email {

	const DEFAULT_SUBJECT = '[{site}] New lead — {form} — {email}';

	public static function build( $form_id, $row, $answers ) {
		$schema     = OCF_Schema::get( $form_id );
		$title      = get_the_title( $form_id );
		$site       = get_bloginfo( 'name' );
		$lead_email = self::find_email( $answers, $row );

		$subject_template = trim( (string) ( $schema['notifications']['subject'] ?? '' ) );
		if ( $subject_template === '' ) {
			$subject_template = self::DEFAULT_SUBJECT;
		}
		$subject = strtr( $subject_template, array(
			'{site}'  => $site,
			'{form}'  => $title,
			'{email}' => $lead_email !== '' ? $lead_email : '(no email)',
		) );

		$fields = self::collect_fields( $schema, $answers );
		$html   = self::render_html( $schema, $title, $site, $fields );

		return array(
			'subject'    => $subject,
			'html'       => $html,
			'lead_email' => $lead_email,
		);
	}

	private static function find_email( $answers, $row ) {
		foreach ( (array) $answers as $v ) {
			if ( is_string( $v ) && is_email( $v ) ) { return $v; }
		}
		return isset( $row['email'] ) ? (string) $row['email'] : '';
	}

	private static function collect_fields( $schema, $answers ) {
		$fields = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$v = $answers[ $q['id'] ?? '' ] ?? null;
				if ( $v === null || $v === '' || $v === array() ) { continue; }
				$fields[] = array(
					'label' => wp_strip_all_tags( $q['label'] ?? '' ) !== '' ? wp_strip_all_tags( $q['label'] ) : $q['id'],
					'value' => self::format_value( $q, $v ),
				);
			}
		}
		return $fields;
	}

	/**
	 * Turn a stored answer into a human-friendly string:
	 *   - address dicts → "Line 1, Line 2, City, State, ZIP, Country"
	 *   - choice / image_card / dropdown values → their labels from q.options
	 *   - multi-value arrays → labels joined with ", "
	 *   - file_upload arrays → each file's display name joined with ", "
	 *   - anything else falls back to a scalar string / joined array.
	 */
	public static function format_value( $q, $v ) {
		if ( $q['type'] === 'address' && is_array( $v ) ) {
			$parts = array_values( array_filter( array_map( 'trim', array(
				(string) ( $v['line1']   ?? '' ),
				(string) ( $v['line2']   ?? '' ),
				(string) ( $v['city']    ?? '' ),
				(string) ( $v['state']   ?? '' ),
				(string) ( $v['zip']     ?? '' ),
				(string) ( $v['country'] ?? '' ),
			) ), 'strlen' ) );
			return implode( ', ', $parts );
		}

		if ( in_array( $q['type'], array( 'choice', 'multi_choice', 'image_cards', 'image_cards_multi', 'dropdown' ), true ) ) {
			$labels = array();
			foreach ( (array) ( $q['options'] ?? array() ) as $opt ) {
				if ( ! isset( $opt['value'] ) ) { continue; }
				$labels[ (string) $opt['value'] ] = (string) ( $opt['label'] ?? $opt['value'] );
			}
			if ( is_array( $v ) ) {
				$out = array();
				foreach ( $v as $val ) { $out[] = $labels[ (string) $val ] ?? (string) $val; }
				return implode( ', ', $out );
			}
			return $labels[ (string) $v ] ?? (string) $v;
		}

		if ( $q['type'] === 'file_upload' && is_array( $v ) ) {
			$names = array();
			foreach ( $v as $f ) {
				if ( is_array( $f ) ) {
					$names[] = isset( $f['name'] ) ? (string) $f['name'] : ( isset( $f['url'] ) ? basename( (string) $f['url'] ) : '' );
				}
			}
			$names = array_values( array_filter( $names, 'strlen' ) );
			return $names ? implode( ', ', $names ) : count( $v ) . ' file(s) uploaded';
		}

		if ( is_array( $v ) ) {
			return implode( ', ', array_map( 'strval', $v ) );
		}

		return (string) $v;
	}

	private static function render_html( $schema, $title, $site, $fields ) {
		$logo    = trim( (string) ( $schema['theme']['logo'] ?? '' ) );
		$primary = self::safe_color( $schema['theme']['primary'] ?? '#111111', '#111111' );
		$accent  = self::safe_color( $schema['theme']['accent']  ?? '#f59e0b', '#f59e0b' );
		$font    = self::safe_font( $schema['theme']['font'] ?? '' );

		ob_start();
		?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title><?php echo esc_html( $title ); ?></title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:<?php echo esc_attr( $font ); ?>;color:#111;line-height:1.5;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:32px 12px;">
	<tr><td align="center">
		<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
			<?php if ( $logo ) : ?>
			<tr><td align="center" style="padding:32px 40px 0;">
				<img src="<?php echo esc_url( $logo ); ?>" alt="<?php echo esc_attr( $site ); ?>" style="max-height:56px;max-width:280px;height:auto;display:inline-block;">
			</td></tr>
			<?php endif; ?>
			<tr><td style="padding:<?php echo $logo ? '24px' : '36px'; ?> 40px 4px;">
				<div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">New lead</div>
				<h1 style="margin:6px 0 0;font-size:24px;font-weight:600;color:<?php echo esc_attr( $primary ); ?>;line-height:1.25;"><?php echo esc_html( $title ); ?></h1>
				<div style="height:3px;width:44px;background:<?php echo esc_attr( $accent ); ?>;margin-top:14px;border-radius:2px;"></div>
			</td></tr>
			<tr><td style="padding:24px 40px 8px;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
					<?php foreach ( $fields as $i => $f ) : ?>
					<tr>
						<td style="padding:16px 0;<?php echo $i > 0 ? 'border-top:1px solid #eef0f3;' : ''; ?>">
							<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;margin-bottom:6px;"><?php echo esc_html( $f['label'] ); ?></div>
							<div style="font-size:17px;color:#111;font-weight:500;line-height:1.45;"><?php echo nl2br( esc_html( $f['value'] ) ); ?></div>
						</td>
					</tr>
					<?php endforeach; ?>
					<?php if ( empty( $fields ) ) : ?>
					<tr><td style="padding:16px 0;color:#6b7280;font-style:italic;">(No answers captured)</td></tr>
					<?php endif; ?>
				</table>
			</td></tr>
			<tr><td style="padding:24px 40px 32px;background:#fafafa;border-top:1px solid #eef0f3;">
				<div style="font-size:12px;color:#6b7280;text-align:center;">
					Sent by October Forms via <strong style="color:#111;"><?php echo esc_html( $site ); ?></strong>.
				</div>
			</td></tr>
		</table>
	</td></tr>
</table>
</body>
</html><?php
		return ob_get_clean();
	}

	private static function safe_color( $c, $fallback ) {
		$c = trim( (string) $c );
		return preg_match( '/^#([0-9a-f]{3}|[0-9a-f]{6})$/i', $c ) ? $c : $fallback;
	}

	private static function safe_font( $font ) {
		$font = trim( (string) $font );
		$fallback = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
		if ( $font === '' ) { return $fallback; }
		$clean = preg_replace( '/[^A-Za-z0-9 _-]/', '', $font );
		if ( $clean === '' ) { return $fallback; }
		return sprintf( '"%s", %s', $clean, $fallback );
	}

	/**
	 * Build a fake submission using the first option of each choice-style
	 * question and short placeholders for text fields. Used for the "Send
	 * sample lead email" button in the Notifications tab.
	 */
	public static function build_sample( $form_id ) {
		$schema  = OCF_Schema::get( $form_id );
		$answers = array();
		foreach ( (array) ( $schema['steps'] ?? array() ) as $step ) {
			foreach ( (array) ( $step['questions'] ?? array() ) as $q ) {
				if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$qid = $q['id'] ?? '';
				if ( ! $qid ) { continue; }
				switch ( $q['type'] ) {
					case 'email':      $answers[ $qid ] = 'sample.lead@example.com'; break;
					case 'phone':      $answers[ $qid ] = '+44 20 7946 0000'; break;
					case 'url':        $answers[ $qid ] = 'https://drive.google.com/example'; break;
					case 'number':     $answers[ $qid ] = 42; break;
					case 'short_text': $answers[ $qid ] = 'Sample Lead'; break;
					case 'long_text':  $answers[ $qid ] = "This is a sample answer. Two-storey side extension with open-plan kitchen. Grade II listed. Looking for architectural design and planning support."; break;
					case 'address':
						$answers[ $qid ] = array(
							'line1'   => '12 Sample Street',
							'line2'   => '',
							'city'    => 'London',
							'state'   => '',
							'zip'     => 'NW1 1AA',
							'country' => 'UK',
						); break;
					case 'date':       $answers[ $qid ] = gmdate( 'Y-m-d' ); break;
					case 'choice':
					case 'image_cards':
					case 'dropdown':
						$opts = $q['options'] ?? array();
						if ( ! empty( $opts[0]['value'] ) ) { $answers[ $qid ] = $opts[0]['value']; }
						break;
					case 'multi_choice':
					case 'image_cards_multi':
						$opts = $q['options'] ?? array();
						if ( ! empty( $opts[0]['value'] ) ) { $answers[ $qid ] = array( $opts[0]['value'] ); }
						break;
					case 'file_upload':
						$answers[ $qid ] = array( array( 'name' => 'sample-plans.pdf', 'url' => 'https://example.com/plans.pdf' ) ); break;
					default:
						$answers[ $qid ] = 'Sample';
				}
			}
		}
		return self::build( $form_id, array( 'email' => 'sample.lead@example.com' ), $answers );
	}
}
