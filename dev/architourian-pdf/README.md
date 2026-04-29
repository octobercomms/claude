# Architourian PDF Generator — WordPress Plugin

Generates branded itinerary PDFs from tour page custom fields, matching the
Architourian document template exactly.

## Requirements

- WordPress 6.0+
- PHP 8.0+
- Composer (to install mPDF)
- SVG uploads enabled (see below)

## Installation

1. Copy this folder into `wp-content/plugins/architourian-pdf/`
2. Inside the plugin folder, run:
   ```bash
   composer install --no-dev --optimize-autoloader
   ```
3. Activate the plugin in **WordPress › Plugins**
4. Go to **Settings › Architourian PDF** and configure:
   - Upload the logo mark SVG (the bracket icon)
   - Enter contact details (name, phone, email, website)
   - Enter the brand name

### Enable SVG uploads in WordPress

Add to your theme's `functions.php` or a mu-plugin:

```php
add_filter( 'upload_mimes', function( $mimes ) {
    $mimes['svg'] = 'image/svg+xml';
    return $mimes;
});
// Required for WordPress 5.1+
add_filter( 'wp_check_filetype_and_ext', function( $data, $file, $filename, $mimes ) {
    if ( substr( $filename, -4 ) === '.svg' ) {
        $data['ext']  = 'svg';
        $data['type'] = 'image/svg+xml';
    }
    return $data;
}, 10, 4 );
```

## Custom Fields Setup (JetEngine / Crocoblock)

Create the following fields on your Tour post type. Field names must match exactly.

| Field Name | Type | Description |
|---|---|---|
| `pdf_cover_svg_id` | Number / Media | Cover illustration — attachment ID of uploaded SVG |
| `pdf_tour_subtitle` | Text | e.g. "100 years of Architecture in India – Empire to Village" |
| `pdf_tour_reference` | Text | Reference code shown vertically, e.g. `INDEMP20250225` |
| `pdf_trip_description` | Textarea | Trip name / overview text (left column of overview page) |
| `pdf_starting_point` | Text | e.g. "New Delhi." |
| `pdf_end_point` | Text | e.g. "Chandigarh Airport or Railway Station." |
| `pdf_group_info` | Textarea | e.g. "Maximum group size of 8." |
| `pdf_cost_info` | Textarea | e.g. "Cost for a double room: £3,300 per person…" |
| `pdf_included_text` | Textarea / WYSIWYG | "Included in the trip" section body |
| `pdf_day_1` … `pdf_day_12` | Textarea | Day content. Lines starting with `–` or `-` become bullet points |
| `pdf_days_svg_id` | Number / Media | SVG illustration for bottom-right of final day page |
| `pdf_back_cover_svg_id` | Number / Media | Back cover page illustration |
| `pdf_terms_text` | Textarea / WYSIWYG | Per-tour T&C override. If empty, falls back to the global T&C in plugin settings |

### Day content format

Each `pdf_day_N` textarea uses plain text. Lines starting with `–` or `-`
become bullet points:

```
– Delhi: Pick up at Indira Gandhi International Airport if required.
– Arrive at The Claridges Hotel, built in 1955 in Lutyens' New Delhi.
– Stay at the Claridges Hotel (or similar 5 star hotel).
```

### Using a JetEngine Repeater instead of numbered fields

If you prefer a repeater field, create one named `pdf_days` with two sub-fields:
- `day_title` (text) — e.g. "Day 1"
- `day_content` (textarea) — bullet-point content as above

The plugin checks for the repeater first, then falls back to numbered fields.

## Adding the Download Button

### Option A — Shortcode (any page/post/widget)

```
[aipdf_download_button post_id="123"]
```

If placed on the tour's own page, `post_id` is optional (defaults to current post).

### Option B — JetEngine / Elementor button

Add a button with:
- Class: `aipdf-download-btn`
- Custom attribute: `data-post-id` = the post ID (use a dynamic tag)

### Option C — PHP in template

```php
echo do_shortcode( '[aipdf_download_button]' );
```

## SVG Illustrations

All illustrations are uploaded as SVG files via the WordPress media library.
They are embedded inline into the PDF so they render at full vector quality.

The plugin expects:
- **Cover SVG** — large architectural illustration, centred on the cover page
- **Days SVG** — smaller illustration, appears bottom-right of the final day page
- **Back cover SVG** — large illustration, centred on the back cover

## Terms & Conditions

The T&C page uses a 3-column flowing layout (matching page 6 of the template).

- **Global T&C** is entered once in **Settings → Architourian PDF** and appears on every PDF
- **Per-tour override**: add a `pdf_terms_text` field to the tour post to replace the global text for that tour
- The page uses the same header as inner pages but with "Terms & Conditions" as the section label
- Numbered headings like `1) Your Fitness` are auto-detected and rendered bold
- The T&C page is omitted entirely if no text is set

## Page Order

1. Cover (SVG illustration + tour subtitle)
2. Overview (trip info + included)
3–N. Day pages (2 days per page)
N+1. Terms & Conditions (3-column, if text is set)
Last. Back cover (SVG illustration + contact)

## Design Notes

- Font: Courier New (monospace) throughout, matching the original template
- Paper: A4 portrait
- The rotated reference code uses CSS `writing-mode: vertical-rl`
- Days are laid out 2 per page in a two-column table
- The plugin generates the PDF on-demand — no PDFs are stored on the server
