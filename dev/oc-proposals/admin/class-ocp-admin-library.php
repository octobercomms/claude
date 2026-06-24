<?php
/**
 * Generic admin for the content library. One screen drives every entity in the
 * OCP_Library registry via an `?entity=` param: list, add/edit, delete.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class OCP_Admin_Library {

	const PAGE = 'ocp-library';
	const CAP  = 'manage_options';

	public static function init() {
		add_action( 'admin_post_ocp_save_library', array( __CLASS__, 'save' ) );
		add_action( 'admin_post_ocp_delete_library', array( __CLASS__, 'delete' ) );
	}

	/** Resolve the current entity key (default: first registered). */
	private static function current_entity_key() {
		$keys = array_keys( OCP_Library::entities() );
		$key  = isset( $_GET['entity'] ) ? sanitize_key( wp_unslash( $_GET['entity'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		return ( $key && in_array( $key, $keys, true ) ) ? $key : $keys[0];
	}

	public static function render() {
		$key    = self::current_entity_key();
		$entity = OCP_Library::entity( $key );
		$action = isset( $_GET['action'] ) ? sanitize_key( wp_unslash( $_GET['action'] ) ) : 'list'; // phpcs:ignore WordPress.Security.NonceVerification

		echo '<div class="wrap ocp-wrap"><h1 class="ocp-h1">' . esc_html__( 'Library', 'oc-proposals' ) . '</h1>';

		// Entity tabs.
		echo '<h2 class="nav-tab-wrapper">';
		foreach ( OCP_Library::entities() as $k => $e ) {
			$url = add_query_arg( array( 'page' => self::PAGE, 'entity' => $k ), admin_url( 'admin.php' ) );
			printf(
				'<a href="%s" class="nav-tab %s">%s</a>',
				esc_url( $url ),
				$k === $key ? 'nav-tab-active' : '',
				esc_html( $e['plural'] )
			);
		}
		echo '</h2>';

		if ( 'edit' === $action || 'add' === $action ) {
			self::render_form( $key, $entity );
		} else {
			self::render_list( $key, $entity );
		}
		echo '</div>';
	}

	private static function render_list( $key, $entity ) {
		$rows    = OCP_Repo::all( $entity['table'], 'id DESC' );
		$add_url = add_query_arg( array( 'page' => self::PAGE, 'entity' => $key, 'action' => 'add' ), admin_url( 'admin.php' ) );

		printf(
			'<p><a class="ocp-btn" href="%s">%s</a></p>',
			esc_url( $add_url ),
			/* translators: %s singular entity */ esc_html( sprintf( __( 'Add %s', 'oc-proposals' ), strtolower( $entity['singular'] ) ) )
		);

		echo '<table class="widefat striped"><thead><tr>';
		foreach ( $entity['list'] as $col ) {
			echo '<th>' . esc_html( $entity['fields'][ $col ]['label'] ) . '</th>';
		}
		echo '<th></th></tr></thead><tbody>';

		if ( ! $rows ) {
			echo '<tr><td colspan="' . esc_attr( count( $entity['list'] ) + 1 ) . '">' . esc_html__( 'Nothing here yet.', 'oc-proposals' ) . '</td></tr>';
		}
		foreach ( (array) $rows as $row ) {
			echo '<tr>';
			foreach ( $entity['list'] as $col ) {
				echo '<td>' . esc_html( wp_trim_words( (string) $row[ $col ], 12 ) ) . '</td>';
			}
			$edit = add_query_arg( array( 'page' => self::PAGE, 'entity' => $key, 'action' => 'edit', 'id' => $row['id'] ), admin_url( 'admin.php' ) );
			$del  = wp_nonce_url( add_query_arg( array( 'action' => 'ocp_delete_library', 'entity' => $key, 'id' => $row['id'] ), admin_url( 'admin-post.php' ) ), 'ocp_delete_library_' . $row['id'] );
			printf(
				'<td><a href="%s">%s</a> &nbsp;|&nbsp; <a href="%s" onclick="return confirm(\'%s\')">%s</a></td>',
				esc_url( $edit ), esc_html__( 'Edit', 'oc-proposals' ),
				esc_url( $del ), esc_js( __( 'Delete this item?', 'oc-proposals' ) ), esc_html__( 'Delete', 'oc-proposals' )
			);
			echo '</tr>';
		}
		echo '</tbody></table>';
	}

	private static function render_form( $key, $entity ) {
		$id  = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
		$row = $id ? OCP_Repo::get( $entity['table'], $id ) : array();

		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="max-width:760px">';
		echo '<input type="hidden" name="action" value="ocp_save_library" />';
		echo '<input type="hidden" name="entity" value="' . esc_attr( $key ) . '" />';
		echo '<input type="hidden" name="id" value="' . esc_attr( $id ) . '" />';
		wp_nonce_field( 'ocp_save_library' );

		echo '<table class="form-table" role="presentation">';
		foreach ( $entity['fields'] as $name => $f ) {
			$val = isset( $row[ $name ] ) ? $row[ $name ] : '';
			echo '<tr><th scope="row"><label for="f_' . esc_attr( $name ) . '">' . esc_html( $f['label'] ) . '</label></th><td>';
			self::field_input( $name, $f, $val );
			echo '</td></tr>';
		}
		echo '</table>';

		submit_button( $id ? __( 'Update', 'oc-proposals' ) : __( 'Create', 'oc-proposals' ) );
		echo '</form>';
	}

	private static function field_input( $name, $f, $val ) {
		$id = 'f_' . $name;
		switch ( $f['type'] ) {
			case 'textarea':
				printf( '<textarea id="%s" name="%s" rows="4" class="large-text">%s</textarea>', esc_attr( $id ), esc_attr( $name ), esc_textarea( (string) $val ) );
				break;
			case 'richtext':
				wp_editor( (string) $val, $id, array( 'textarea_name' => $name, 'textarea_rows' => 8, 'media_buttons' => false ) );
				break;
			default:
				$type = ( 'url' === $f['type'] ) ? 'url' : ( ( 'number' === $f['type'] ) ? 'number' : 'text' );
				printf( '<input type="%s" id="%s" name="%s" value="%s" class="regular-text" />', esc_attr( $type ), esc_attr( $id ), esc_attr( $name ), esc_attr( (string) $val ) );
		}
	}

	public static function save() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		check_admin_referer( 'ocp_save_library' );

		$key    = isset( $_POST['entity'] ) ? sanitize_key( wp_unslash( $_POST['entity'] ) ) : '';
		$entity = OCP_Library::entity( $key );
		if ( ! $entity ) {
			wp_die( esc_html__( 'Unknown entity.', 'oc-proposals' ) );
		}
		$id   = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
		$data = array();
		foreach ( $entity['fields'] as $name => $f ) {
			if ( ! isset( $_POST[ $name ] ) ) {
				continue;
			}
			$raw = wp_unslash( $_POST[ $name ] );
			if ( 'richtext' === $f['type'] || 'textarea' === $f['type'] ) {
				$data[ $name ] = wp_kses_post( $raw );
			} elseif ( 'url' === $f['type'] ) {
				$data[ $name ] = esc_url_raw( $raw );
			} else {
				$data[ $name ] = sanitize_text_field( $raw );
			}
		}

		if ( $id ) {
			OCP_Repo::update( $entity['table'], $id, $data );
		} else {
			OCP_Repo::insert( $entity['table'], $data );
		}

		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'entity' => $key, 'saved' => 1 ), admin_url( 'admin.php' ) ) );
		exit;
	}

	public static function delete() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Not allowed.', 'oc-proposals' ) );
		}
		$id  = isset( $_GET['id'] ) ? (int) $_GET['id'] : 0;
		$key = isset( $_GET['entity'] ) ? sanitize_key( wp_unslash( $_GET['entity'] ) ) : '';
		check_admin_referer( 'ocp_delete_library_' . $id );
		$entity = OCP_Library::entity( $key );
		if ( $entity && $id ) {
			OCP_Repo::delete( $entity['table'], $id );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'entity' => $key, 'deleted' => 1 ), admin_url( 'admin.php' ) ) );
		exit;
	}
}
