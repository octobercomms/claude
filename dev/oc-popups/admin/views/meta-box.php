<?php
/**
 * Popup Settings meta box UI.
 *
 * @var array $s Merged settings (defaults + saved), provided by render_box().
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$trigger_labels = OCPOP_CPT_Registrar::trigger_labels();
?>
<div class="ocpop-meta">

	<p class="ocpop-toggle">
		<label>
			<input type="checkbox" name="ocpop[enabled]" value="1" <?php checked( $s['enabled'], 1 ); ?>>
			<strong><?php esc_html_e( 'Popup is enabled', 'october-popups' ); ?></strong>
		</label>
		<span class="description"><?php esc_html_e( 'Uncheck to switch the popup off site-wide without deleting it.', 'october-popups' ); ?></span>
	</p>

	<h3><?php esc_html_e( 'Content', 'october-popups' ); ?></h3>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><?php esc_html_e( 'Build the popup with', 'october-popups' ); ?></th>
			<td>
				<label style="margin-right:16px;">
					<input type="radio" name="ocpop[content_mode]" value="template" class="ocpop-mode" <?php checked( $s['content_mode'], 'template' ); ?>>
					<?php esc_html_e( 'Simple template', 'october-popups' ); ?>
				</label>
				<label>
					<input type="radio" name="ocpop[content_mode]" value="builder" class="ocpop-mode" <?php checked( $s['content_mode'], 'builder' ); ?>>
					<?php esc_html_e( 'Page builder (WP Bakery / Elementor)', 'october-popups' ); ?>
				</label>
				<p class="description"><?php esc_html_e( 'Simple template = fill in the fields below (recommended for competitions). Page builder = design the body with the editor above.', 'october-popups' ); ?></p>
			</td>
		</tr>
	</table>

	<div class="ocpop-mode-builder-note" style="display:none;">
		<p class="description" style="padding:10px 12px;background:#fff8e5;border:1px solid #f0d78a;border-radius:6px;">
			<?php esc_html_e( 'Page builder mode: design the popup body with the editor above (WP Bakery / Elementor). The template fields below are ignored.', 'october-popups' ); ?>
		</p>
	</div>

	<div class="ocpop-tpl-fields">
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><label for="ocpop_tpl_layout"><?php esc_html_e( 'Layout', 'october-popups' ); ?></label></th>
				<td>
					<select name="ocpop[tpl_layout]" id="ocpop_tpl_layout">
						<option value="image-left"  <?php selected( $s['tpl_layout'], 'image-left' ); ?>><?php esc_html_e( 'Image left, text right', 'october-popups' ); ?></option>
						<option value="image-right" <?php selected( $s['tpl_layout'], 'image-right' ); ?>><?php esc_html_e( 'Image right, text left', 'october-popups' ); ?></option>
						<option value="image-top"   <?php selected( $s['tpl_layout'], 'image-top' ); ?>><?php esc_html_e( 'Image on top, text below', 'october-popups' ); ?></option>
						<option value="text-only"   <?php selected( $s['tpl_layout'], 'text-only' ); ?>><?php esc_html_e( 'Text only (no image)', 'october-popups' ); ?></option>
					</select>
				</td>
			</tr>
			<tr class="ocpop-tpl-image-row">
				<th scope="row"><?php esc_html_e( 'Image', 'october-popups' ); ?></th>
				<td>
					<input type="hidden" name="ocpop[tpl_image_id]" id="ocpop_tpl_image_id" value="<?php echo esc_attr( $s['tpl_image_id'] ); ?>">
					<div id="ocpop_tpl_image_preview" class="ocpop-img-preview">
						<?php
						if ( ! empty( $s['tpl_image_id'] ) ) {
							echo wp_get_attachment_image( (int) $s['tpl_image_id'], 'medium' );
						}
						?>
					</div>
					<button type="button" class="button ocpop-img-select"><?php esc_html_e( 'Choose image', 'october-popups' ); ?></button>
					<button type="button" class="button-link ocpop-img-remove" <?php echo empty( $s['tpl_image_id'] ) ? 'style="display:none;"' : ''; ?>><?php esc_html_e( 'Remove', 'october-popups' ); ?></button>
					<label style="display:block;margin-top:8px;">
						<input type="checkbox" name="ocpop[tpl_show_image_mobile]" value="1" <?php checked( $s['tpl_show_image_mobile'], 1 ); ?>>
						<?php esc_html_e( 'Show image on mobile (off = text only on phones)', 'october-popups' ); ?>
					</label>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="ocpop_tpl_heading"><?php esc_html_e( 'Heading', 'october-popups' ); ?></label></th>
				<td>
					<input type="text" class="large-text" name="ocpop[tpl_heading]" id="ocpop_tpl_heading" value="<?php echo esc_attr( $s['tpl_heading'] ); ?>" placeholder="<?php esc_attr_e( 'A West Country Giveaway', 'october-popups' ); ?>">
					<label style="display:inline-block;margin-top:6px;margin-right:14px;"><?php esc_html_e( 'Heading colour:', 'october-popups' ); ?>
						<input type="text" name="ocpop[tpl_heading_color]" value="<?php echo esc_attr( $s['tpl_heading_color'] ); ?>" placeholder="#1a3b2a" style="width:120px;">
					</label>
					<label style="display:inline-block;margin-top:6px;"><?php esc_html_e( 'Size (px):', 'october-popups' ); ?>
						<input type="number" min="10" max="100" name="ocpop[tpl_heading_size]" value="<?php echo esc_attr( $s['tpl_heading_size'] ); ?>" style="width:80px;">
					</label>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="ocpop_tpl_text"><?php esc_html_e( 'Body text', 'october-popups' ); ?></label></th>
				<td>
					<textarea class="large-text" rows="6" name="ocpop[tpl_text]" id="ocpop_tpl_text"><?php echo esc_textarea( $s['tpl_text'] ); ?></textarea>
					<p class="description"><?php esc_html_e( 'Basic HTML allowed (links, bold, line breaks). Paragraphs are added automatically.', 'october-popups' ); ?></p>
					<label style="display:inline-block;margin-right:14px;"><?php esc_html_e( 'Text colour:', 'october-popups' ); ?>
						<input type="text" name="ocpop[tpl_text_color]" value="<?php echo esc_attr( $s['tpl_text_color'] ); ?>" placeholder="#333333" style="width:120px;">
					</label>
					<label style="display:inline-block;"><?php esc_html_e( 'Size (px):', 'october-popups' ); ?>
						<input type="number" min="8" max="60" name="ocpop[tpl_text_size]" value="<?php echo esc_attr( $s['tpl_text_size'] ); ?>" style="width:80px;">
					</label>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="ocpop_tpl_button_text"><?php esc_html_e( 'Button', 'october-popups' ); ?></label></th>
				<td>
					<input type="text" name="ocpop[tpl_button_text]" id="ocpop_tpl_button_text" value="<?php echo esc_attr( $s['tpl_button_text'] ); ?>" placeholder="<?php esc_attr_e( 'Enter Now', 'october-popups' ); ?>">
					<input type="url" class="regular-text" name="ocpop[tpl_button_url]" value="<?php echo esc_attr( $s['tpl_button_url'] ); ?>" placeholder="https://…">
					<p class="description"><?php esc_html_e( 'Button label and the link it points to (your competition entry page). Leave the label blank for no button.', 'october-popups' ); ?></p>
					<label style="margin-right:14px;"><?php esc_html_e( 'Button colour:', 'october-popups' ); ?>
						<input type="text" name="ocpop[tpl_button_bg]" value="<?php echo esc_attr( $s['tpl_button_bg'] ); ?>" placeholder="#1a3b2a" style="width:120px;">
					</label>
					<label style="margin-right:14px;"><?php esc_html_e( 'Button text colour:', 'october-popups' ); ?>
						<input type="text" name="ocpop[tpl_button_color]" value="<?php echo esc_attr( $s['tpl_button_color'] ); ?>" placeholder="#ffffff" style="width:120px;">
					</label>
					<label style="display:inline-block;margin-top:8px;margin-right:14px;"><?php esc_html_e( 'Corner radius (px):', 'october-popups' ); ?>
						<input type="number" min="0" max="100" name="ocpop[tpl_button_radius]" value="<?php echo esc_attr( $s['tpl_button_radius'] ); ?>" style="width:80px;">
					</label>
					<label style="display:inline-block;margin-top:8px;"><?php esc_html_e( 'Font family:', 'october-popups' ); ?>
						<input type="text" name="ocpop[tpl_button_font]" value="<?php echo esc_attr( $s['tpl_button_font'] ); ?>" placeholder="<?php esc_attr_e( 'inherit (theme font)', 'october-popups' ); ?>" style="width:200px;">
					</label>
					<p class="description"><?php esc_html_e( 'Font family: leave blank to use the theme font, or type a CSS font stack, e.g. Georgia, serif.', 'october-popups' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="ocpop_tpl_bg"><?php esc_html_e( 'Background colour', 'october-popups' ); ?></label></th>
				<td><input type="text" name="ocpop[tpl_bg]" id="ocpop_tpl_bg" value="<?php echo esc_attr( $s['tpl_bg'] ); ?>" placeholder="#ffffff" style="width:120px;"></td>
			</tr>
			<tr>
				<th scope="row"><label for="ocpop_tpl_padding"><?php esc_html_e( 'Text area padding (px)', 'october-popups' ); ?></label></th>
				<td>
					<input type="number" min="0" max="120" name="ocpop[tpl_padding]" id="ocpop_tpl_padding" value="<?php echo esc_attr( $s['tpl_padding'] ); ?>" style="width:80px;">
					<p class="description"><?php esc_html_e( 'Space around the heading, text and button.', 'october-popups' ); ?></p>
				</td>
			</tr>
		</table>
	</div>

	<h3><?php esc_html_e( 'Trigger', 'october-popups' ); ?></h3>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><label for="ocpop_trigger_type"><?php esc_html_e( 'When to show', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[trigger_type]" id="ocpop_trigger_type" class="ocpop-trigger-select">
					<?php foreach ( $trigger_labels as $val => $label ) : ?>
						<option value="<?php echo esc_attr( $val ); ?>" <?php selected( $s['trigger_type'], $val ); ?>><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</td>
		</tr>
		<tr class="ocpop-when ocpop-when-delay">
			<th scope="row"><label for="ocpop_delay"><?php esc_html_e( 'Delay (seconds)', 'october-popups' ); ?></label></th>
			<td><input type="number" min="0" max="600" name="ocpop[delay_seconds]" id="ocpop_delay" value="<?php echo esc_attr( $s['delay_seconds'] ); ?>"></td>
		</tr>
		<tr class="ocpop-when ocpop-when-scroll">
			<th scope="row"><label for="ocpop_scroll"><?php esc_html_e( 'Scroll depth (%)', 'october-popups' ); ?></label></th>
			<td><input type="number" min="1" max="100" name="ocpop[scroll_percent]" id="ocpop_scroll" value="<?php echo esc_attr( $s['scroll_percent'] ); ?>"></td>
		</tr>
		<tr class="ocpop-when ocpop-when-idle">
			<th scope="row"><label for="ocpop_idle"><?php esc_html_e( 'Inactivity (seconds)', 'october-popups' ); ?></label></th>
			<td><input type="number" min="1" max="3600" name="ocpop[idle_seconds]" id="ocpop_idle" value="<?php echo esc_attr( $s['idle_seconds'] ); ?>"></td>
		</tr>
		<tr class="ocpop-when ocpop-when-click">
			<th scope="row"><label for="ocpop_selector"><?php esc_html_e( 'Click on CSS selector', 'october-popups' ); ?></label></th>
			<td>
				<input type="text" class="regular-text" name="ocpop[click_selector]" id="ocpop_selector" value="<?php echo esc_attr( $s['click_selector'] ); ?>" placeholder=".enter-competition, #promo-btn">
				<p class="description"><?php esc_html_e( 'Any element matching this selector opens the popup when clicked.', 'october-popups' ); ?></p>
			</td>
		</tr>
		<tr class="ocpop-when ocpop-when-exit ocpop-when-load ocpop-when-manual">
			<th scope="row"></th>
			<td><p class="description ocpop-note-exit"><?php esc_html_e( 'Fires when the visitor moves the cursor to leave the page (desktop).', 'october-popups' ); ?></p>
			<p class="description ocpop-note-load"><?php esc_html_e( 'Fires as soon as the page finishes loading.', 'october-popups' ); ?></p>
			<p class="description ocpop-note-manual"><?php esc_html_e( 'Only opens when a matching link/button (class ocpop-open-ID) or the shortcode is used.', 'october-popups' ); ?></p></td>
		</tr>
	</table>

	<h3><?php esc_html_e( 'How often', 'october-popups' ); ?></h3>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><label for="ocpop_frequency"><?php esc_html_e( 'Show frequency', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[frequency]" id="ocpop_frequency" class="ocpop-freq-select">
					<option value="always"  <?php selected( $s['frequency'], 'always' ); ?>><?php esc_html_e( 'Every page view', 'october-popups' ); ?></option>
					<option value="session" <?php selected( $s['frequency'], 'session' ); ?>><?php esc_html_e( 'Once per browser session', 'october-popups' ); ?></option>
					<option value="days"    <?php selected( $s['frequency'], 'days' ); ?>><?php esc_html_e( 'Once every N days', 'october-popups' ); ?></option>
					<option value="once"    <?php selected( $s['frequency'], 'once' ); ?>><?php esc_html_e( 'Once, ever', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
		<tr class="ocpop-freq ocpop-freq-days">
			<th scope="row"><label for="ocpop_freq_days"><?php esc_html_e( 'Days between views', 'october-popups' ); ?></label></th>
			<td><input type="number" min="1" max="365" name="ocpop[frequency_days]" id="ocpop_freq_days" value="<?php echo esc_attr( $s['frequency_days'] ); ?>"></td>
		</tr>
	</table>

	<h3><?php esc_html_e( 'Schedule', 'october-popups' ); ?></h3>
	<p class="description"><?php esc_html_e( 'Optional. Leave blank for no limit — handy for time-boxed competitions.', 'october-popups' ); ?></p>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><label for="ocpop_start"><?php esc_html_e( 'Start date', 'october-popups' ); ?></label></th>
			<td><input type="date" name="ocpop[start_date]" id="ocpop_start" value="<?php echo esc_attr( $s['start_date'] ); ?>"></td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_end"><?php esc_html_e( 'End date', 'october-popups' ); ?></label></th>
			<td><input type="date" name="ocpop[end_date]" id="ocpop_end" value="<?php echo esc_attr( $s['end_date'] ); ?>"></td>
		</tr>
	</table>

	<h3><?php esc_html_e( 'Where to show', 'october-popups' ); ?></h3>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><label for="ocpop_display_on"><?php esc_html_e( 'Pages', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[display_on]" id="ocpop_display_on" class="ocpop-display-select">
					<option value="all"      <?php selected( $s['display_on'], 'all' ); ?>><?php esc_html_e( 'Everywhere', 'october-popups' ); ?></option>
					<option value="front"    <?php selected( $s['display_on'], 'front' ); ?>><?php esc_html_e( 'Homepage only', 'october-popups' ); ?></option>
					<option value="selected" <?php selected( $s['display_on'], 'selected' ); ?>><?php esc_html_e( 'Only on selected pages/posts', 'october-popups' ); ?></option>
					<option value="exclude"  <?php selected( $s['display_on'], 'exclude' ); ?>><?php esc_html_e( 'Everywhere except selected', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
		<tr class="ocpop-target-ids">
			<th scope="row"><label for="ocpop_target_ids"><?php esc_html_e( 'Page / post IDs', 'october-popups' ); ?></label></th>
			<td>
				<input type="text" class="regular-text" name="ocpop[target_ids]" id="ocpop_target_ids" value="<?php echo esc_attr( $s['target_ids'] ); ?>" placeholder="12, 34, 56">
				<p class="description"><?php esc_html_e( 'Comma-separated IDs. Find an ID in the URL when editing a page (post=123).', 'october-popups' ); ?></p>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_devices"><?php esc_html_e( 'Devices', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[devices]" id="ocpop_devices">
					<option value="all"     <?php selected( $s['devices'], 'all' ); ?>><?php esc_html_e( 'All devices', 'october-popups' ); ?></option>
					<option value="desktop" <?php selected( $s['devices'], 'desktop' ); ?>><?php esc_html_e( 'Desktop only', 'october-popups' ); ?></option>
					<option value="mobile"  <?php selected( $s['devices'], 'mobile' ); ?>><?php esc_html_e( 'Mobile only', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_logged_in"><?php esc_html_e( 'Visitors', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[logged_in]" id="ocpop_logged_in">
					<option value="all" <?php selected( $s['logged_in'], 'all' ); ?>><?php esc_html_e( 'Everyone', 'october-popups' ); ?></option>
					<option value="out" <?php selected( $s['logged_in'], 'out' ); ?>><?php esc_html_e( 'Logged-out only', 'october-popups' ); ?></option>
					<option value="in"  <?php selected( $s['logged_in'], 'in' ); ?>><?php esc_html_e( 'Logged-in only', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
	</table>

	<h3><?php esc_html_e( 'Appearance', 'october-popups' ); ?></h3>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><label for="ocpop_position"><?php esc_html_e( 'Position', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[position]" id="ocpop_position">
					<option value="center"      <?php selected( $s['position'], 'center' ); ?>><?php esc_html_e( 'Centre modal', 'october-popups' ); ?></option>
					<option value="top-bar"     <?php selected( $s['position'], 'top-bar' ); ?>><?php esc_html_e( 'Top bar', 'october-popups' ); ?></option>
					<option value="bottom-bar"  <?php selected( $s['position'], 'bottom-bar' ); ?>><?php esc_html_e( 'Bottom bar', 'october-popups' ); ?></option>
					<option value="slide-left"  <?php selected( $s['position'], 'slide-left' ); ?>><?php esc_html_e( 'Slide-in (bottom left)', 'october-popups' ); ?></option>
					<option value="slide-right" <?php selected( $s['position'], 'slide-right' ); ?>><?php esc_html_e( 'Slide-in (bottom right)', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_width"><?php esc_html_e( 'Max width — desktop (px)', 'october-popups' ); ?></label></th>
			<td>
				<input type="number" min="200" max="2000" name="ocpop[width]" id="ocpop_width" value="<?php echo esc_attr( $s['width'] ); ?>">
				<p class="description"><?php esc_html_e( 'How wide the popup can grow on larger screens. Increase this if a wide image is being cut off.', 'october-popups' ); ?></p>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_width_mobile"><?php esc_html_e( 'Max width — mobile (px)', 'october-popups' ); ?></label></th>
			<td>
				<input type="number" min="150" max="2000" name="ocpop[width_mobile]" id="ocpop_width_mobile" value="<?php echo esc_attr( $s['width_mobile'] ); ?>">
				<p class="description"><?php esc_html_e( 'Used on phones (screens up to 600px). The popup never exceeds the screen width regardless of this value.', 'october-popups' ); ?></p>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_radius"><?php esc_html_e( 'Corner radius (px)', 'october-popups' ); ?></label></th>
			<td>
				<input type="number" min="0" max="100" name="ocpop[radius]" id="ocpop_radius" value="<?php echo esc_attr( $s['radius'] ); ?>">
				<p class="description"><?php esc_html_e( 'Rounds the popup corners. 0 = square. Applies to both content modes.', 'october-popups' ); ?></p>
			</td>
		</tr>
		<tr>
			<th scope="row"><label for="ocpop_animation"><?php esc_html_e( 'Animation', 'october-popups' ); ?></label></th>
			<td>
				<select name="ocpop[animation]" id="ocpop_animation">
					<option value="fade"  <?php selected( $s['animation'], 'fade' ); ?>><?php esc_html_e( 'Fade', 'october-popups' ); ?></option>
					<option value="slide" <?php selected( $s['animation'], 'slide' ); ?>><?php esc_html_e( 'Slide', 'october-popups' ); ?></option>
					<option value="zoom"  <?php selected( $s['animation'], 'zoom' ); ?>><?php esc_html_e( 'Zoom', 'october-popups' ); ?></option>
					<option value="none"  <?php selected( $s['animation'], 'none' ); ?>><?php esc_html_e( 'None', 'october-popups' ); ?></option>
				</select>
			</td>
		</tr>
		<tr>
			<th scope="row"><?php esc_html_e( 'Overlay', 'october-popups' ); ?></th>
			<td>
				<label><input type="checkbox" name="ocpop[overlay]" value="1" <?php checked( $s['overlay'], 1 ); ?>> <?php esc_html_e( 'Dim the page behind the popup', 'october-popups' ); ?></label><br>
				<label style="display:inline-block;margin-top:6px;"><?php esc_html_e( 'Overlay colour:', 'october-popups' ); ?>
					<input type="text" class="regular-text" name="ocpop[overlay_color]" value="<?php echo esc_attr( $s['overlay_color'] ); ?>" placeholder="rgba(0,0,0,0.6)" style="width:180px;">
				</label>
			</td>
		</tr>
		<tr>
			<th scope="row"><?php esc_html_e( 'Closing', 'october-popups' ); ?></th>
			<td>
				<label><input type="checkbox" name="ocpop[show_close]" value="1" <?php checked( $s['show_close'], 1 ); ?>> <?php esc_html_e( 'Show a close (×) button', 'october-popups' ); ?></label><br>
				<label><input type="checkbox" name="ocpop[overlay_close]" value="1" <?php checked( $s['overlay_close'], 1 ); ?>> <?php esc_html_e( 'Close when the overlay is clicked', 'october-popups' ); ?></label><br>
				<label><input type="checkbox" name="ocpop[esc_close]" value="1" <?php checked( $s['esc_close'], 1 ); ?>> <?php esc_html_e( 'Close on the Escape key', 'october-popups' ); ?></label>
				<p style="margin-top:8px;">
					<label for="ocpop_close_delay"><?php esc_html_e( 'Delay before the × appears (seconds):', 'october-popups' ); ?></label>
					<input type="number" min="0" max="120" name="ocpop[close_delay]" id="ocpop_close_delay" value="<?php echo esc_attr( $s['close_delay'] ); ?>" style="width:70px;">
				</p>
			</td>
		</tr>
	</table>
</div>
