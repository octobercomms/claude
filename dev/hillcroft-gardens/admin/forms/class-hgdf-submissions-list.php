<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class HGDF_Submissions_List {

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ), 11 );
		add_action( 'admin_init', array( __CLASS__, 'maybe_export' ) );
		add_action( 'admin_post_hgd_form_bulk_delete_submissions', array( __CLASS__, 'handle_bulk_delete' ) );
		add_action( 'admin_post_hgd_form_delete_submission', array( __CLASS__, 'handle_single_delete' ) );
	}

	public static function menu() {
		add_submenu_page(
			'hgd-dashboard',
			'Form Submissions',
			'Form Submissions',
			'manage_options',
			'hgd-forms-submissions',
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * admin-post handler: bulk-delete submissions. Self-contained — verifies
	 * capability + nonce and redirects inline.
	 */
	public static function handle_bulk_delete() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden' );
		}
		check_admin_referer( 'hgd_form_bulk_delete_submissions' );

		$form_id = absint( $_POST['form_id'] ?? 0 );
		$ids     = array_map( 'absint', (array) ( $_POST['submission_ids'] ?? array() ) );
		$ids     = array_values( array_filter( $ids ) );

		$deleted = 0;
		foreach ( $ids as $id ) {
			if ( HGDF_Submission::delete( $id ) ) { $deleted++; }
		}

		wp_safe_redirect( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id . '&deleted=' . $deleted ) );
		exit;
	}

	/**
	 * admin-post handler: delete a single submission. Self-contained — verifies
	 * capability + nonce and redirects inline.
	 */
	public static function handle_single_delete() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden' );
		}
		$id = absint( $_REQUEST['id'] ?? 0 );
		check_admin_referer( 'hgd_form_delete_submission_' . $id );

		$row     = HGDF_Submission::find( $id );
		$form_id = $row ? (int) $row['form_id'] : 0;
		$deleted = HGDF_Submission::delete( $id ) ? 1 : 0;

		wp_safe_redirect( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id . '&deleted=' . $deleted ) );
		exit;
	}

	public static function maybe_export() {
		if ( ( $_GET['page'] ?? '' ) !== 'hgd-forms-submissions' ) { return; }
		if ( ( $_GET['action'] ?? '' ) !== 'export' ) { return; }
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		check_admin_referer( 'hgd_form_export' );

		$form_id = absint( $_GET['form_id'] ?? 0 );
		if ( ! $form_id || ! HGDF_CPT::exists( $form_id ) ) { wp_die( 'Form not found' ); }

		$schema      = HGDF_Schema::get( $form_id );
		$submissions = HGDF_Submission::list_for_form( $form_id, array( 'limit' => 5000 ) );

		// Build flat headers from schema (storable questions only).
		$headers = array( 'id', 'status', 'email', 'created_at', 'completed_at' );
		$qids    = array();
		foreach ( $schema['steps'] as $step ) {
			foreach ( $step['questions'] as $q ) {
				if ( ! HGDF_Schema::type_is_storable( $q['type'] ) ) { continue; }
				$headers[] = wp_strip_all_tags( $q['label'] ) ?: $q['id'];
				$qids[]    = $q['id'];
			}
		}

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="hgd-form-' . $form_id . '-submissions.csv"' );

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
			'post_type'      => HGDF_CPT,
			'posts_per_page' => 100,
			'post_status'    => array( 'publish', 'draft' ),
		) );

		echo '<div class="wrap"><h1>Submissions</h1>';
		echo '<form method="get" style="margin-bottom: 16px;">';
		echo '<input type="hidden" name="page" value="hgd-forms-submissions">';
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

		$schema     = HGDF_Schema::get( $form_id );
		$rows       = HGDF_Submission::list_for_form( $form_id, array( 'limit' => 100 ) );
		$export_url = wp_nonce_url( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id . '&action=export' ), 'hgd_form_export' );

		$deleted = isset( $_GET['deleted'] ) ? absint( $_GET['deleted'] ) : 0;
		if ( $deleted > 0 ) {
			echo '<div class="notice notice-success is-dismissible"><p>' . sprintf( _n( '%d submission deleted.', '%d submissions deleted.', $deleted ), $deleted ) . '</p></div>';
		}

		echo '<p><a class="button" href="' . esc_url( $export_url ) . '">Export CSV</a></p>';

		// POSTs to admin-post.php; handled by HGDF_Submissions_List::handle_bulk_delete().
		$action_url = admin_url( 'admin-post.php' );
		echo '<form method="post" action="' . esc_url( $action_url ) . '" onsubmit="return ocfConfirmBulk(this);">';
		echo '<input type="hidden" name="action" value="hgd_form_bulk_delete_submissions">';
		echo '<input type="hidden" name="form_id" value="' . (int) $form_id . '">';
		wp_nonce_field( 'hgd_form_bulk_delete_submissions' );

		echo '<div class="tablenav top">';
		echo '<div class="alignleft actions bulkactions">';
		echo '<select name="bulk_action"><option value="">Bulk actions</option><option value="delete">Delete</option></select> ';
		echo '<button type="submit" class="button action">Apply</button>';
		echo '</div></div>';

		echo '<table class="wp-list-table widefat fixed striped"><thead><tr>';
		echo '<td class="manage-column column-cb check-column"><label class="screen-reader-text" for="hgd-form-cb-select-all">Select all</label><input id="hgd-form-cb-select-all" type="checkbox"></td>';
		echo '<th>ID</th><th>Status</th><th>Email</th><th>Step</th><th>Time</th><th>Created</th><th>Completed</th><th></th>';
		echo '</tr></thead><tbody>';
		if ( empty( $rows ) ) {
			echo '<tr><td colspan="9">No submissions yet.</td></tr>';
		}
		foreach ( $rows as $r ) {
			$view        = admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $form_id . '&view=' . $r['id'] );
			$delete_url  = wp_nonce_url(
				admin_url( 'admin-post.php?action=hgd_form_delete_submission&id=' . (int) $r['id'] ),
				'hgd_form_delete_submission_' . (int) $r['id']
			);
			$secs = (int) ( $r['seconds_active'] ?? 0 );
			$time = $secs >= 60 ? floor( $secs / 60 ) . 'm ' . ( $secs % 60 ) . 's' : $secs . 's';
			printf(
				'<tr>'
				. '<th scope="row" class="check-column"><input type="checkbox" name="submission_ids[]" value="%1$d"></th>'
				. '<td>%1$d</td><td>%2$s</td><td>%3$s</td><td>%4$d</td><td>%5$s</td><td>%6$s</td><td>%7$s</td>'
				. '<td><a class="button" href="%8$s">View</a> <a class="button button-link-delete" href="%9$s" onclick="return confirm(\'Delete submission #%1$d?\');" style="color:#d63638;">Delete</a></td>'
				. '</tr>',
				(int) $r['id'],
				esc_html( $r['status'] ),
				esc_html( $r['email'] ),
				(int) ( $r['step_reached'] ?? 0 ),
				esc_html( $time ),
				esc_html( $r['created_at'] ),
				esc_html( $r['completed_at'] ?: '—' ),
				esc_url( $view ),
				esc_url( $delete_url )
			);
		}
		echo '</tbody></table>';
		echo '</form>';

		// Minimal JS: select-all + confirm bulk delete.
		echo '<script>
			(function () {
				var all = document.getElementById("hgd-form-cb-select-all");
				if (all) {
					all.addEventListener("change", function () {
						document.querySelectorAll("input[name=\'submission_ids[]\']").forEach(function (cb) { cb.checked = all.checked; });
					});
				}
				window.ocfConfirmBulk = function (form) {
					var act = form.bulk_action && form.bulk_action.value;
					if (act !== "delete") { alert("Pick a bulk action."); return false; }
					var checked = form.querySelectorAll("input[name=\'submission_ids[]\']:checked").length;
					if (!checked) { alert("Select at least one submission."); return false; }
					return confirm("Delete " + checked + " submission(s)? This also removes uploaded files.");
				};
			})();
		</script>';
		echo '</div>';
	}

	private static function render_single( $sub_id ) {
		$sub = HGDF_Submission::find( $sub_id );
		if ( ! $sub ) { echo '<p>Submission not found.</p>'; return; }
		$schema  = HGDF_Schema::get( (int) $sub['form_id'] );
		$answers = json_decode( $sub['payload'], true ) ?: array();
		$uploads = HGDF_Submission::uploads_for( $sub_id );

		echo '<h2>Submission #' . (int) $sub['id'] . '</h2>';
		echo '<p><strong>Email:</strong> ' . esc_html( $sub['email'] ) . ' &nbsp; <strong>Status:</strong> ' . esc_html( $sub['status'] ) . '</p>';
		echo '<p><strong>IP:</strong> ' . esc_html( $sub['ip_address'] ) . ' &nbsp; <strong>UA:</strong> ' . esc_html( $sub['user_agent'] ) . '</p>';

		echo '<table class="widefat striped"><tbody>';
		foreach ( $schema['steps'] as $step ) {
			foreach ( $step['questions'] as $q ) {
				if ( ! HGDF_Schema::type_is_storable( $q['type'] ) ) { continue; }
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
		$delete_url = wp_nonce_url(
			admin_url( 'admin-post.php?action=hgd_form_delete_submission&id=' . (int) $sub['id'] ),
			'hgd_form_delete_submission_' . (int) $sub['id']
		);
		echo '<p>';
		echo '<a class="button" href="' . esc_url( admin_url( 'admin.php?page=hgd-forms-submissions&form_id=' . $sub['form_id'] ) ) . '">← Back to list</a> ';
		echo '<a class="button" href="' . esc_url( $delete_url ) . '" onclick="return confirm(\'Delete this submission and its uploaded files?\');" style="color:#d63638;">Delete</a>';
		echo '</p>';
	}
}
