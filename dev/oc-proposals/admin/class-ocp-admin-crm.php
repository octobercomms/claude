<?php
/**
 * CRM admin — pipeline board grouped by stage, lead add/edit, and a CSV importer
 * for the Sales Leads Tracker.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Admin_CRM {

	const PAGE = 'ocp-crm';
	const CAP  = 'manage_options';

	public static function init() {
		add_action( 'admin_post_ocp_save_lead', array( __CLASS__, 'save_lead' ) );
		add_action( 'admin_post_ocp_import_leads', array( __CLASS__, 'import_leads' ) );
	}

	public static function render() {
		$action = isset( $_GET['action'] ) ? sanitize_key( wp_unslash( $_GET['action'] ) ) : 'board'; // phpcs:ignore WordPress.Security.NonceVerification
		echo '<div class="wrap ocp-wrap"><h1 class="ocp-h1">' . esc_html__( 'Pipeline', 'oc-proposals' ) . '</h1>';

		if ( 'edit' === $action || 'add' === $action ) {
			self::render_form();
		} elseif ( 'import' === $action ) {
			self::render_import();
		} else {
			self::render_board();
		}
		echo '</div>';
	}

	private static function render_board() {
		$add    = add_query_arg( array( 'page' => self::PAGE, 'action' => 'add' ), admin_url( 'admin.php' ) );
		$import = add_query_arg( array( 'page' => self::PAGE, 'action' => 'import' ), admin_url( 'admin.php' ) );
		printf(
			'<p><a class="ocp-btn" href="%s">%s</a> &nbsp; <a class="button" href="%s">%s</a></p>',
			esc_url( $add ), esc_html__( 'Add lead', 'oc-proposals' ),
			esc_url( $import ), esc_html__( 'Import CSV', 'oc-proposals' )
		);

		echo '<div class="ocp-board">';
		foreach ( OCP_Lead::stages() as $stage => $label ) {
			$leads = OCP_Lead::by_stage( $stage );
			echo '<div class="ocp-col"><h3>' . esc_html( $label ) . ' <span class="ocp-count">' . count( (array) $leads ) . '</span></h3>';
			foreach ( (array) $leads as $lead ) {
				$edit = add_query_arg( array( 'page' => self::PAGE, 'action' => 'edit', 'id' => $lead['id'] ), admin_url( 'admin.php' ) );
				echo '<a class="ocp-lead" href="' . esc_url( $edit ) . '">';
				echo '<strong>' . esc_html( $lead['client_name'] ) . '</strong>';
				if ( $lead['project_type'] ) {
					echo '<span>' . esc_html( $lead['project_type'] ) . '</span>';
				}
				if ( 'closed_lost' === $stage && $lead['lost_reason'] ) {
					echo '<em>' . esc_html( OCP_Lead::lost_reasons()[ $lead['lost_reason'] ] ?? $lead['lost_reason'] ) . '</em>';
				}
				echo '</a>';
			}
			echo '</div>';
		}
		echo '</div>';
	}

	private static function render_form() {
		$id   = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
		$lead = $id ? OCP_Lead::get( $id ) : array();
		$g    = function ( $k ) use ( $lead ) { return isset( $lead[ $k ] ) ? $lead[ $k ] : ''; };

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="max-width:760px">';
		echo '<input type="hidden" name="action" value="ocp_save_lead" />';
		echo '<input type="hidden" name="id" value="' . esc_attr( $id ) . '" />';
		wp_nonce_field( 'ocp_save_lead' );
		echo '<table class="form-table" role="presentation">';

		self::text_row( 'client_name', __( 'Client name', 'oc-proposals' ), $g( 'client_name' ) );

		// Stage select.
		echo '<tr><th>' . esc_html__( 'Stage', 'oc-proposals' ) . '</th><td><select name="status">';
		foreach ( OCP_Lead::stages() as $k => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $k ), selected( $g( 'status' ), $k, false ), esc_html( $label ) );
		}
		echo '</select></td></tr>';

		// Lost reason.
		echo '<tr><th>' . esc_html__( 'Lost reason', 'oc-proposals' ) . '</th><td><select name="lost_reason"><option value="">—</option>';
		foreach ( OCP_Lead::lost_reasons() as $k => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $k ), selected( $g( 'lost_reason' ), $k, false ), esc_html( $label ) );
		}
		echo '</select></td></tr>';

		// Source.
		echo '<tr><th>' . esc_html__( 'Lead source', 'oc-proposals' ) . '</th><td><select name="lead_source"><option value="">—</option>';
		foreach ( OCP_Lead::sources() as $src ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $src ), selected( $g( 'lead_source' ), $src, false ), esc_html( $src ) );
		}
		echo '</select></td></tr>';

		self::text_row( 'project_type', __( 'Project type', 'oc-proposals' ), $g( 'project_type' ) );
		self::text_row( 'budget_band', __( 'Budget band', 'oc-proposals' ), $g( 'budget_band' ) );
		self::text_row( 'contact_name', __( 'Contact name', 'oc-proposals' ), $g( 'contact_name' ) );
		self::text_row( 'email', __( 'Email', 'oc-proposals' ), $g( 'email' ), 'email' );
		self::text_row( 'telephone', __( 'Telephone', 'oc-proposals' ), $g( 'telephone' ) );
		self::text_row( 'postcode', __( 'Postcode', 'oc-proposals' ), $g( 'postcode' ) );

		echo '</table>';
		submit_button( $id ? __( 'Update lead', 'oc-proposals' ) : __( 'Create lead', 'oc-proposals' ) );
		echo '</form>';
	}

	private static function text_row( $name, $label, $val, $type = 'text' ) {
		printf(
			'<tr><th scope="row"><label for="l_%1$s">%2$s</label></th><td><input type="%3$s" id="l_%1$s" name="%1$s" value="%4$s" class="regular-text" /></td></tr>',
			esc_attr( $name ), esc_html( $label ), esc_attr( $type ), esc_attr( (string) $val )
		);
	}

	private static function render_import() {
		echo '<p>' . esc_html__( 'Export the "Leads" sheet of the Sales Leads Tracker as CSV and upload it here. Statuses are mapped to the pipeline automatically.', 'oc-proposals' ) . '</p>';
		echo '<form method="post" enctype="multipart/form-data" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		echo '<input type="hidden" name="action" value="ocp_import_leads" />';
		wp_nonce_field( 'ocp_import_leads' );
		echo '<input type="file" name="csv" accept=".csv" required /> ';
		submit_button( __( 'Import leads', 'oc-proposals' ), 'primary', 'submit', false );
		echo '</form>';
	}

	public static function save_lead() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( 'ocp_save_lead' );

		$id   = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		$data = array(
			'client_name'  => sanitize_text_field( wp_unslash( $_POST['client_name'] ?? '' ) ),
			'status'       => sanitize_key( wp_unslash( $_POST['status'] ?? 'lead_in' ) ),
			'lost_reason'  => sanitize_key( wp_unslash( $_POST['lost_reason'] ?? '' ) ),
			'lead_source'  => sanitize_text_field( wp_unslash( $_POST['lead_source'] ?? '' ) ),
			'project_type' => sanitize_text_field( wp_unslash( $_POST['project_type'] ?? '' ) ),
			'budget_band'  => sanitize_text_field( wp_unslash( $_POST['budget_band'] ?? '' ) ),
			'contact_name' => sanitize_text_field( wp_unslash( $_POST['contact_name'] ?? '' ) ),
			'email'        => sanitize_email( wp_unslash( $_POST['email'] ?? '' ) ),
			'telephone'    => sanitize_text_field( wp_unslash( $_POST['telephone'] ?? '' ) ),
			'postcode'     => sanitize_text_field( wp_unslash( $_POST['postcode'] ?? '' ) ),
		);
		OCP_Lead::save( $data, $id );
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public static function import_leads() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( 'ocp_import_leads' );

		$result = array( 'imported' => 0, 'skipped' => 0 );
		if ( ! empty( $_FILES['csv']['tmp_name'] ) && is_uploaded_file( $_FILES['csv']['tmp_name'] ) ) {
			$result = OCP_Lead::import_csv( $_FILES['csv']['tmp_name'] );
		}
		wp_safe_redirect( add_query_arg(
			array( 'page' => self::PAGE, 'imported' => (int) $result['imported'] ),
			admin_url( 'admin.php' )
		) );
		exit;
	}
}
