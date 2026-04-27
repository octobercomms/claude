=== Architecture Cost Calculator ===
Contributors:     octobercomms
Tags:             calculator, architecture, construction, cost estimator, residential
Requires at least: 6.0
Tested up to:     6.5
Requires PHP:     8.0
Stable tag:       1.0.0
License:          GPL-2.0+
License URI:      https://www.gnu.org/licenses/gpl-2.0.html

Residential construction cost calculator for architecture practices. Embed with [arch_cost_calculator].

== Description ==

A lightweight, configurable cost calculator that helps homeowners estimate residential project costs. Designed for small architecture practices as a lead generation tool.

Features:

* Six project types: single storey extension, double storey extension, loft conversion, new build, basement conversion, full refurbishment
* Three specification levels: Standard, Mid-range, High specification
* Fully configurable cost-per-sqm rates (18 rates total) via the admin panel
* Configurable architect fee percentages per project type
* Dynamic client-side calculation — no page reloads, no server requests
* Configurable CTA button (label and URL)
* Show/hide architect fees section
* Minimal CSS, namespaced under `.acc-` to avoid theme conflicts
* Mobile responsive

== Installation ==

1. Upload the `architecture-cost-calculator` folder to `/wp-content/plugins/`.
2. Activate the plugin via **Plugins > Installed Plugins**.
3. Go to **Settings > Cost Calculator** to configure rates and display options.
4. Add `[arch_cost_calculator]` to any page or post.

== Configuration ==

=== Settings > Cost Calculator > Cost Rates ===

Edit the 18 build cost rates (£ per sqm) across 6 project types × 3 specification levels.

=== Settings > Cost Calculator > Architect Fee Rates ===

Set the architect fee percentage (of mid-point build cost) for each project type. Typical range: 10–15%.

=== Settings > Cost Calculator > Display Settings ===

* **Calculator Heading** – heading displayed above the form
* **CTA Button Label** – text for the call-to-action button
* **CTA Button URL** – where the CTA button links to (leave blank to hide the button)
* **Currency Symbol** – defaults to £
* **Show Architect Fees** – toggle the fees estimate section on or off

== Calculation Logic ==

Build cost is calculated as: floor area × cost per sqm (based on project type and specification level).

A ±10% range is applied and figures are rounded to the nearest £1,000.

Architect fees are calculated as a configurable percentage of the mid-point build cost, with a ±10% range rounded to the nearest £100.

== Shortcode ==

    [arch_cost_calculator]

Place this shortcode on any page or post to embed the calculator.

== Default Cost Rates (£ per sqm) ==

| Project Type                  | Standard | Mid-range | High Spec |
|-------------------------------|----------|-----------|-----------|
| Single storey rear extension  | £1,800   | £2,400    | £3,200    |
| Double storey extension       | £1,600   | £2,200    | £3,000    |
| Loft conversion               | £1,500   | £2,000    | £2,800    |
| New build (single dwelling)   | £2,000   | £2,800    | £4,000    |
| Basement conversion           | £3,000   | £3,800    | £5,000    |
| Full refurbishment            | £1,200   | £1,800    | £2,600    |

Default architect fee: 12% across all project types.

== Frequently Asked Questions ==

= Can I use this on multiple sites? =

Yes. Each site has its own independent settings stored in WordPress options.

= Will this conflict with my theme? =

All CSS classes are prefixed with `.acc-` and styles are scoped to `.acc-calculator`. There are no CSS frameworks or global style resets included.

= Can I override the styles? =

Yes. Add CSS to your theme's customiser or stylesheet targeting `.acc-` classes.

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
