<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCF_Submissions_List {

	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'maybe_export' ) );
	}

	public static function maybe_export() {
		if ( ( $_GET['page'] ?? '' ) !== 'oc-forms-submissions' ) { return; }
		if ( ( $_GET['action'] ?? '' ) !== 'export' ) { return; }
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		check_admin_referer( 'ocf_export' );

		$form_id = absint( $_GET['form_id'] ?? 0 );
		if ( ! $form_id || ! OCF_CPT::exists( $form_id ) ) { wp_die( 'Form not found' ); }

		$schema      = OCF_Schema::get( $form_id );
		$submissions = OCF_Submission::list_for_form( $form_id, array( 'limit' => 5000 ) );

		// Build flat headers from schema (storable questions only).
		$headers = array( 'id', 'status', 'email', 'created_at', 'completed_at' );
		$qids    = array();
		foreach ( $schema['steps'] as $step ) {
			foreach ( $step['questions'] as $q ) {
				if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$headers[] = wp_strip_all_tags( $q['label'] ) ?: $q['id'];
				$qids[]    = $q['id'];
			}
		}

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="ocf-' . $form_id . '-submissions.csv"' );

		$out = fopen( 'php://output', 'w' );
		fputcsv( $out, $headers );
		foreach ( $submissions as $s ) {
			$answers = json_decode( $s['payload'], true ) ?: array();
			$row = array( $s['id'], $s['status'], $s['email'], $s['created_at'], $s['completed_at'] );
			foreach ( $qids as $qid ) {
				$v = $answers[ $qid ] ?? '';
				if ( is_array( $v ) ) { $v = wp_json_encode( $v ); }
				$row[] = $v;
			}
			fputcsv( $out, $row );
		}
		fclose( $out );
		exit;
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		$form_id = absint( $_GET['form_id'] ?? 0 );
		$forms = get_posts( array(
			'post_type'      => OCF_CPT,
			'posts_per_page' => 100,
			'post_status'    => array( 'publish', 'draft' ),
		) );

		echo '<div class="wrap"><h1>Submissions</h1>';
		echo '<form method="get" style="margin-bottom: 16px;">';
		echo '<input type="hidden" name="page" value="oc-forms-submissions">';
		echo '<select name="form_id" onchange="this.form.submit()">';
		echo '<option value="">— Choose a form —</option>';
		foreach ( $forms as $f ) {
			printf( '<option value="%d" %s>%s</option>', $f->ID, selected( $form_id, $f->ID, false ), esc_html( $f->post_title ) );
		}
		echo '</select>';
		echo '</form>';

		if ( ! $form_id ) {
			echo '<p>Select a form to view its submissions.</p></div>';
			return;
		}

		if ( ! empty( $_GET['view'] ) ) {
			self::render_single( absint( $_GET['view'] ) );
			echo '</div>';
			return;
		}

		$schema = OCF_Schema::get( $form_id );
		$rows   = OCF_Submission::list_for_form( $form_id, array( 'limit' => 100 ) );
		$export_url = wp_nonce_url( admin_url( 'admin.php?page=oc-forms-submissions&form_id=' . $form_id . '&action=export' ), 'ocf_export' );
		echo '<p><a class="button" href="' . esc_url( $export_url ) . '">Export CSV</a></p>';

		echo '<table class="wp-list-table widefat fixed striped"><thead><tr>';
		echo '<th>ID</th><th>Status</th><th>Email</th><th>Created</th><th>Completed</th><th></th>';
		echo '</tr></thead><tbody>';
		if ( empty( $rows ) ) {
			echo '<tr><td colspan="6">No submissions yet.</td></tr>';
		}
		foreach ( $rows as $r ) {
			$view = admin_url( 'admin.php?page=oc-forms-submissions&form_id=' . $form_id . '&view=' . $r['id'] );
			printf(
				'<tr><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td><a class="button" href="%s">View</a></td></tr>',
				(int) $r['id'],
				esc_html( $r['status'] ),
				esc_html( $r['email'] ),
				esc_html( $r['created_at'] ),
				esc_html( $r['completed_at'] ?: '—' ),
				esc_url( $view )
			);
		}
		echo '</tbody></table></div>';
	}

	private static function render_single( $sub_id ) {
		$sub = OCF_Submission::find( $sub_id );
		if ( ! $sub ) { echo '<p>Submission not found.</p>'; return; }
		$schema  = OCF_Schema::get( (int) $sub['form_id'] );
		$answers = json_decode( $sub['payload'], true ) ?: array();
		$uploads = OCF_Submission::uploads_for( $sub_id );

		echo '<h2>Submission #' . (int) $sub['id'] . '</h2>';
		echo '<p><strong>Email:</strong> ' . esc_html( $sub['email'] ) . ' &nbsp; <strong>Status:</strong> ' . esc_html( $sub['status'] ) . '</p>';
		echo '<p><strong>IP:</strong> ' . esc_html( $sub['ip_address'] ) . ' &nbsp; <strong>UA:</strong> ' . esc_html( $sub['user_agent'] ) . '</p>';

		echo '<table class="widefat striped"><tbody>';
		foreach ( $schema['steps'] as $step ) {
			foreach ( $step['questions'] as $q ) {
				if ( ! OCF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$v = $answers[ $q['id'] ] ?? null;
				if ( $v === null || $v === '' || $v === array() ) { continue; }
				if ( $q['type'] === 'file_upload' ) {
					$links = array();
					foreach ( $uploads as $u ) {
						if ( $u['question_id'] !== $q['id'] ) { continue; }
						$links[] = '<a href="' . esc_url( $u['url'] ) . '" target="_blank">' . esc_html( $u['original_name'] ) . '</a>';
					}
					$display = implode( '<br>', $links );
				} elseif ( is_array( $v ) ) {
					$display = esc_html( wp_json_encode( $v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
				} else {
					$display = esc_html( $v );
				}
				echo '<tr><th style="width: 30%; text-align: left;">' . esc_html( wp_strip_all_tags( $q['label'] ) ) . '</th><td>' . $display . '</td></tr>';
			}
		}
		echo '</tbody></table>';
		echo '<p><a class="button" href="' . esc_url( admin_url( 'admin.php?page=oc-forms-submissions&form_id=' . $sub['form_id'] ) ) . '">← Back to list</a></p>';
	}
}
