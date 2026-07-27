<?php
/**
 * Front page — the Architects Direct landing experience.
 *
 * @package Architects_Direct
 */

get_header();

$ad_table    = ad_pricing_table();
$ad_services = $ad_table['services'];

// Service copy (kept in the template; prices come from the pricing table).
$ad_service_copy = array(
	'planning'        => __( 'Existing and proposed plans, elevations and site plans prepared to accompany a householder or full planning application.', 'architects-direct' ),
	'buildingcontrol' => __( 'Technical drawings and construction detail for building regulations approval and building control submission.', 'architects-direct' ),
	'permitted'       => __( 'Drawings and a lawful development certificate pack for works that fall under permitted development rights.', 'architects-direct' ),
	'tender'          => __( 'A coordinated drawing package suitable for issuing to builders for accurate, comparable quotes.', 'architects-direct' ),
);

$ad_hero_price = ad_price( $ad_services['planning']['A'] );
?>

<main id="content">

	<!-- ============ HERO ============ -->
	<section class="hero">
		<div class="wrap hero-inner">
			<div class="hero-copy">
				<div class="eyebrow"><?php echo esc_html( get_theme_mod( 'ad_hero_eyebrow', __( 'Architectural drawings, made simple', 'architects-direct' ) ) ); ?></div>
				<h1><?php echo esc_html( get_theme_mod( 'ad_hero_heading', __( 'Fixed-price architectural drawings. Priced online. No call required.', 'architects-direct' ) ) ); ?></h1>
				<p class="lede"><?php echo esc_html( get_theme_mod( 'ad_hero_lede', __( 'Planning, building control, permitted development and tender packages for standard residential works. Choose your service, get an instant fixed price, and send us your brief in under five minutes.', 'architects-direct' ) ) ); ?></p>
				<div class="hero-actions">
					<a href="#pricing" class="btn btn-primary"><?php esc_html_e( 'Get an instant price', 'architects-direct' ); ?></a>
					<a href="#how" class="btn btn-ghost"><?php esc_html_e( 'See how it works', 'architects-direct' ); ?></a>
				</div>
				<ul class="hero-points">
					<li><?php esc_html_e( 'Fixed price, agreed upfront', 'architects-direct' ); ?></li>
					<li><?php esc_html_e( 'No consultation needed to start', 'architects-direct' ); ?></li>
					<li><?php esc_html_e( 'Drawings delivered to your project portal', 'architects-direct' ); ?></li>
				</ul>
			</div>
			<aside class="hero-card" aria-label="<?php esc_attr_e( 'Example pricing', 'architects-direct' ); ?>">
				<div class="hero-card-top">
					<span class="tag"><?php esc_html_e( 'Example', 'architects-direct' ); ?></span>
					<span class="hero-card-service"><?php esc_html_e( 'Planning application', 'architects-direct' ); ?></span>
				</div>
				<div class="price-block">
					<span class="price-label"><?php esc_html_e( 'Fixed price from', 'architects-direct' ); ?></span>
					<span class="price-figure"><span class="cur">£</span><?php echo esc_html( number_format_i18n( $ad_services['planning']['A'] ) ); ?></span>
					<span class="price-band"><?php esc_html_e( 'Extension up to 50m² · Band A', 'architects-direct' ); ?></span>
				</div>
				<ul class="hero-card-list">
					<li><?php esc_html_e( 'Existing & proposed plans', 'architects-direct' ); ?></li>
					<li><?php esc_html_e( 'Elevations & site plan', 'architects-direct' ); ?></li>
					<li><?php esc_html_e( 'Drawing package ready to submit', 'architects-direct' ); ?></li>
				</ul>
				<a href="#pricing" class="btn btn-primary btn-block"><?php esc_html_e( 'Price my project', 'architects-direct' ); ?></a>
				<p class="hero-card-note"><?php esc_html_e( 'Indicative figure. Final pricing confirmed before you pay.', 'architects-direct' ); ?></p>
			</aside>
		</div>
	</section>

	<!-- ============ TRUST BAR ============ -->
	<section class="trustbar">
		<div class="wrap trustbar-inner">
			<div class="trust-item"><strong>4</strong><span><?php esc_html_e( 'Drawing packages', 'architects-direct' ); ?></span></div>
			<div class="trust-item"><strong>&lt;5 min</strong><span><?php esc_html_e( 'To send your brief', 'architects-direct' ); ?></span></div>
			<div class="trust-item"><strong><?php esc_html_e( 'Fixed', 'architects-direct' ); ?></strong><span><?php esc_html_e( 'Price, no surprises', 'architects-direct' ); ?></span></div>
			<div class="trust-item"><strong><?php esc_html_e( 'Online', 'architects-direct' ); ?></strong><span><?php esc_html_e( 'Pay & download', 'architects-direct' ); ?></span></div>
		</div>
	</section>

	<!-- ============ HOW IT WORKS ============ -->
	<section class="section" id="how">
		<div class="wrap">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'The process', 'architects-direct' ); ?></span>
				<h2><?php esc_html_e( 'Five minutes to get started. No phone tag.', 'architects-direct' ); ?></h2>
				<p><?php esc_html_e( "Everything runs online. You only hear from us if something's missing.", 'architects-direct' ); ?></p>
			</div>
			<ol class="steps">
				<li class="step">
					<span class="step-num">1</span>
					<h3><?php esc_html_e( 'Pick your service & size', 'architects-direct' ); ?></h3>
					<p><?php esc_html_e( "Select the drawing package you need and your project's floor area. See your fixed price instantly.", 'architects-direct' ); ?></p>
				</li>
				<li class="step">
					<span class="step-num">2</span>
					<h3><?php esc_html_e( 'Send your brief', 'architects-direct' ); ?></h3>
					<p><?php esc_html_e( 'A short self-service form — under five minutes. A project account is created for you automatically.', 'architects-direct' ); ?></p>
				</li>
				<li class="step">
					<span class="step-num">3</span>
					<h3><?php esc_html_e( 'We draw it up', 'architects-direct' ); ?></h3>
					<p><?php esc_html_e( 'Our architectural team completes your drawings and uploads them to your private project portal.', 'architects-direct' ); ?></p>
				</li>
				<li class="step">
					<span class="step-num">4</span>
					<h3><?php esc_html_e( 'Preview, pay, download', 'architects-direct' ); ?></h3>
					<p><?php esc_html_e( 'Review a watermarked preview. Pay online and the full drawing package is released immediately.', 'architects-direct' ); ?></p>
				</li>
			</ol>
		</div>
	</section>

	<!-- ============ SERVICES ============ -->
	<section class="section section-alt" id="services">
		<div class="wrap">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'What we draw', 'architects-direct' ); ?></span>
				<h2><?php esc_html_e( 'Standard residential drawing packages', 'architects-direct' ); ?></h2>
				<p><?php esc_html_e( 'Priced by service type and floor area. Straightforward, submission-ready, and delivered to a deadline.', 'architects-direct' ); ?></p>
			</div>
			<div class="services-grid">
				<?php foreach ( $ad_service_copy as $ad_key => $ad_desc ) : ?>
					<article class="service-card">
						<h3><?php echo esc_html( $ad_services[ $ad_key ]['label'] ); ?></h3>
						<p><?php echo esc_html( $ad_desc ); ?></p>
						<span class="service-from" data-service="<?php echo esc_attr( $ad_key ); ?>"><?php echo esc_html( ad_price_from( $ad_key ) ); ?></span>
					</article>
				<?php endforeach; ?>
				<article class="service-card service-card-wide">
					<h3><?php esc_html_e( 'Project coordination', 'architects-direct' ); ?> <span class="badge"><?php esc_html_e( 'Add-on', 'architects-direct' ); ?></span></h3>
					<p><?php esc_html_e( 'Optional site attendance and consultant liaison where a project needs a bit more hands-on coordination. Added to any package, priced on the details of your project.', 'architects-direct' ); ?></p>
					<span class="service-from" data-service="coordination"><?php esc_html_e( 'Price on request', 'architects-direct' ); ?></span>
				</article>
			</div>
			<p class="services-note"><?php esc_html_e( 'Working on something over 150m², a listed building, or a project that needs ongoing management?', 'architects-direct' ); ?> <a href="#redirect"><?php esc_html_e( "That's a job for Tiam Architects →", 'architects-direct' ); ?></a></p>
		</div>
	</section>

	<!-- ============ PRICING CALCULATOR ============ -->
	<section class="section" id="pricing">
		<div class="wrap">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'Instant pricing', 'architects-direct' ); ?></span>
				<h2><?php esc_html_e( 'Get your fixed price', 'architects-direct' ); ?></h2>
				<p><?php esc_html_e( 'Choose a service and floor area for an indicative price. Final pricing is confirmed before you pay — no hidden extras.', 'architects-direct' ); ?></p>
			</div>

			<div class="calc">
				<form class="calc-form" id="calcForm" aria-describedby="calcResultRegion">
					<fieldset class="calc-field">
						<legend><?php esc_html_e( '1. Which drawings do you need?', 'architects-direct' ); ?></legend>
						<div class="option-grid" role="radiogroup" aria-label="<?php esc_attr_e( 'Service type', 'architects-direct' ); ?>">
							<?php
							$ad_first = true;
							foreach ( $ad_services as $ad_key => $ad_svc ) :
								?>
								<label class="option"><input type="radio" name="service" value="<?php echo esc_attr( $ad_key ); ?>" <?php checked( $ad_first ); ?>><span><?php echo esc_html( $ad_svc['label'] ); ?></span></label>
								<?php
								$ad_first = false;
							endforeach;
							?>
						</div>
					</fieldset>

					<fieldset class="calc-field">
						<legend><?php esc_html_e( '2. Roughly how big is the project?', 'architects-direct' ); ?></legend>
						<div class="option-grid" role="radiogroup" aria-label="<?php esc_attr_e( 'Floor area', 'architects-direct' ); ?>">
							<label class="option"><input type="radio" name="band" value="A" checked><span><?php esc_html_e( 'Up to 50m²', 'architects-direct' ); ?><small><?php esc_html_e( 'Band A', 'architects-direct' ); ?></small></span></label>
							<label class="option"><input type="radio" name="band" value="B"><span><?php esc_html_e( '50–100m²', 'architects-direct' ); ?><small><?php esc_html_e( 'Band B', 'architects-direct' ); ?></small></span></label>
							<label class="option"><input type="radio" name="band" value="C"><span><?php esc_html_e( '100–150m²', 'architects-direct' ); ?><small><?php esc_html_e( 'Band C', 'architects-direct' ); ?></small></span></label>
							<label class="option"><input type="radio" name="band" value="over"><span><?php esc_html_e( 'Over 150m²', 'architects-direct' ); ?><small><?php esc_html_e( 'Larger project', 'architects-direct' ); ?></small></span></label>
						</div>
					</fieldset>

					<fieldset class="calc-field">
						<legend><?php esc_html_e( '3. Anything else we should know?', 'architects-direct' ); ?></legend>
						<div class="check-row">
							<label class="check"><input type="checkbox" name="listed" value="1"><span><?php esc_html_e( "It's a", 'architects-direct' ); ?> <strong><?php esc_html_e( 'listed building', 'architects-direct' ); ?></strong></span></label>
							<label class="check"><input type="checkbox" name="ongoing" value="1"><span><?php esc_html_e( 'I need', 'architects-direct' ); ?> <strong><?php esc_html_e( 'ongoing project management', 'architects-direct' ); ?></strong></span></label>
						</div>
					</fieldset>
				</form>

				<aside class="calc-result" id="calcResultRegion" aria-live="polite">
					<div class="result-standard" id="resultStandard">
						<span class="result-label"><?php esc_html_e( 'Your fixed price', 'architects-direct' ); ?></span>
						<div class="result-price"><span class="cur">£</span><span id="resultFigure"><?php echo esc_html( number_format_i18n( $ad_services['planning']['A'] ) ); ?></span></div>
						<p class="result-sub" id="resultSub"><?php esc_html_e( 'Planning application · up to 50m² (Band A)', 'architects-direct' ); ?></p>
						<ul class="result-list">
							<li><?php esc_html_e( 'Fixed price — no hourly billing', 'architects-direct' ); ?></li>
							<li><?php esc_html_e( 'Watermarked preview before you pay', 'architects-direct' ); ?></li>
							<li><?php esc_html_e( 'Full package released on payment', 'architects-direct' ); ?></li>
						</ul>
						<a href="#start" class="btn btn-primary btn-block" id="resultCta"><?php esc_html_e( 'Start this project', 'architects-direct' ); ?></a>
						<p class="result-note"><?php esc_html_e( 'Indicative price. Confirmed in writing before payment.', 'architects-direct' ); ?></p>
					</div>

					<div class="result-redirect" id="resultRedirect" hidden>
						<span class="tag tag-dark"><?php esc_html_e( 'Better suited to Tiam Architects', 'architects-direct' ); ?></span>
						<h3 id="redirectHeading"><?php esc_html_e( "This one's beyond a standard package", 'architects-direct' ); ?></h3>
						<p id="redirectBody"><?php esc_html_e( "Larger, listed or hands-on projects need a proper conversation and a bespoke fee. We'll pass your details to Tiam Architects for a formal consultation.", 'architects-direct' ); ?></p>
						<a href="#start" class="btn btn-dark btn-block" id="redirectCta"><?php esc_html_e( 'Request a consultation', 'architects-direct' ); ?></a>
						<p class="result-note"><?php esc_html_e( 'No obligation. Tiam handles complex and premium residential work.', 'architects-direct' ); ?></p>
					</div>
				</aside>
			</div>

			<p class="pricing-disclaimer" id="redirect"><?php esc_html_e( 'Prices shown are indicative placeholders for demonstration and will be set by Tiam Architects before launch. Projects over 150m², listed buildings, or those needing ongoing management are redirected to Tiam Architects for a bespoke consultation.', 'architects-direct' ); ?></p>
		</div>
	</section>

	<!-- ============ INTAKE / GET STARTED ============ -->
	<section class="section section-dark" id="start">
		<div class="wrap">
			<div class="section-head section-head-light">
				<span class="kicker"><?php esc_html_e( 'Start your project', 'architects-direct' ); ?></span>
				<h2><?php esc_html_e( 'Send us your brief', 'architects-direct' ); ?></h2>
				<p><?php esc_html_e( "The short version — under five minutes. We'll create your project account and come back to you if anything's missing. You only pay once your drawings are ready to preview.", 'architects-direct' ); ?></p>
			</div>

			<form class="intake" id="intakeForm" novalidate>
				<div class="intake-grid">
					<div class="field">
						<label for="f-name"><?php esc_html_e( 'Your name', 'architects-direct' ); ?> <span class="req">*</span></label>
						<input type="text" id="f-name" name="name" autocomplete="name" required>
					</div>
					<div class="field">
						<label for="f-email"><?php esc_html_e( 'Email', 'architects-direct' ); ?> <span class="req">*</span></label>
						<input type="email" id="f-email" name="email" autocomplete="email" required>
					</div>
					<div class="field">
						<label for="f-phone"><?php esc_html_e( 'Phone', 'architects-direct' ); ?> <span class="opt"><?php esc_html_e( 'optional', 'architects-direct' ); ?></span></label>
						<input type="tel" id="f-phone" name="phone" autocomplete="tel">
					</div>
					<div class="field">
						<label for="f-postcode"><?php esc_html_e( 'Project postcode', 'architects-direct' ); ?> <span class="req">*</span></label>
						<input type="text" id="f-postcode" name="postcode" autocomplete="postal-code" required>
					</div>
					<div class="field">
						<label for="f-service"><?php esc_html_e( 'Service needed', 'architects-direct' ); ?></label>
						<select id="f-service" name="service">
							<?php foreach ( $ad_services as $ad_key => $ad_svc ) : ?>
								<option value="<?php echo esc_attr( $ad_key ); ?>"><?php echo esc_html( $ad_svc['label'] ); ?></option>
							<?php endforeach; ?>
							<option value="unsure"><?php esc_html_e( 'Not sure yet', 'architects-direct' ); ?></option>
						</select>
					</div>
					<div class="field">
						<label for="f-band"><?php esc_html_e( 'Floor area', 'architects-direct' ); ?></label>
						<select id="f-band" name="band">
							<option value="A"><?php esc_html_e( 'Up to 50m² (Band A)', 'architects-direct' ); ?></option>
							<option value="B"><?php esc_html_e( '50–100m² (Band B)', 'architects-direct' ); ?></option>
							<option value="C"><?php esc_html_e( '100–150m² (Band C)', 'architects-direct' ); ?></option>
							<option value="over"><?php esc_html_e( 'Over 150m² / listed', 'architects-direct' ); ?></option>
						</select>
					</div>
					<div class="field field-full">
						<label for="f-brief"><?php esc_html_e( 'Tell us about the project', 'architects-direct' ); ?> <span class="opt"><?php esc_html_e( 'optional now — you can add this later', 'architects-direct' ); ?></span></label>
						<textarea id="f-brief" name="brief" rows="4" placeholder="<?php esc_attr_e( 'e.g. Single-storey rear extension to a 1930s semi. Need planning drawings to submit to the council.', 'architects-direct' ); ?>"></textarea>
					</div>
				</div>
				<div class="intake-footer">
					<label class="check check-light">
						<input type="checkbox" name="terms" required>
						<span><?php esc_html_e( 'I understand consultants (e.g. structural engineers) are appointed directly by me under the platform terms.', 'architects-direct' ); ?> <span class="req">*</span></span>
					</label>
					<button type="submit" class="btn btn-primary btn-lg"><?php esc_html_e( 'Create my project', 'architects-direct' ); ?></button>
				</div>
				<p class="intake-note" id="intakeNote" role="status"></p>
			</form>
		</div>
	</section>

	<!-- ============ CONSULTANTS / LIABILITY ============ -->
	<section class="section section-alt" id="consultants">
		<div class="wrap">
			<div class="two-col">
				<div class="two-col-copy">
					<span class="kicker"><?php esc_html_e( 'How specialists work', 'architects-direct' ); ?></span>
					<h2><?php esc_html_e( 'Need a structural engineer or surveyor?', 'architects-direct' ); ?></h2>
					<p><?php esc_html_e( 'Some projects need specialist input. When they do, you appoint the consultant directly through the platform under clear, upfront terms — so responsibility and professional liability sit with the specialist doing the work.', 'architects-direct' ); ?></p>
					<p><?php esc_html_e( "We work with a preferred panel of engineers and surveyors we already trust. Their fees are handled automatically through the platform, and they only join a project when it's actually needed.", 'architects-direct' ); ?></p>
				</div>
				<ul class="fact-list">
					<li><strong><?php esc_html_e( 'You appoint them', 'architects-direct' ); ?></strong> — <?php esc_html_e( 'consultants are engaged directly by you, not sub-contracted through us.', 'architects-direct' ); ?></li>
					<li><strong><?php esc_html_e( 'Clear liability', 'architects-direct' ); ?></strong> — <?php esc_html_e( 'each specialist is responsible for their own scope and professional indemnity.', 'architects-direct' ); ?></li>
					<li><strong><?php esc_html_e( 'Only when needed', 'architects-direct' ); ?></strong> — <?php esc_html_e( "simple planning-only jobs don't involve consultants at all.", 'architects-direct' ); ?></li>
					<li><strong><?php esc_html_e( 'Paid automatically', 'architects-direct' ); ?></strong> — <?php esc_html_e( 'fees are settled through the platform on completion.', 'architects-direct' ); ?></li>
				</ul>
			</div>
		</div>
	</section>

	<!-- ============ FAQ ============ -->
	<section class="section" id="faq">
		<div class="wrap wrap-narrow">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'Questions', 'architects-direct' ); ?></span>
				<h2><?php esc_html_e( 'Good to know', 'architects-direct' ); ?></h2>
			</div>
			<div class="faq">
				<details class="faq-item" open>
					<summary><?php esc_html_e( 'Do I have to book a call?', 'architects-direct' ); ?></summary>
					<div class="faq-body"><p><?php esc_html_e( "No. The whole point of Architects Direct is that you don't. You choose your service, get a fixed price, and send your brief online. We only get in touch if we need something to complete your drawings.", 'architects-direct' ); ?></p></div>
				</details>
				<details class="faq-item">
					<summary><?php esc_html_e( 'When do I pay?', 'architects-direct' ); ?></summary>
					<div class="faq-body"><p><?php esc_html_e( 'Not upfront. We prepare your drawings and show you a watermarked preview first. You only pay once you can see the work — and the full, clean drawing package is released the moment payment clears.', 'architects-direct' ); ?></p></div>
				</details>
				<details class="faq-item">
					<summary><?php esc_html_e( 'How is the price worked out?', 'architects-direct' ); ?></summary>
					<div class="faq-body"><p><?php esc_html_e( 'By service type and floor area, across three size bands (A, B and C). That keeps pricing transparent and consistent. Projects over 150m², listed buildings, or anything needing ongoing management are handled by our sister practice, Tiam Architects, on a bespoke basis.', 'architects-direct' ); ?></p></div>
				</details>
				<details class="faq-item">
					<summary><?php esc_html_e( 'What if my project is bigger or more complex?', 'architects-direct' ); ?></summary>
					<div class="faq-body"><p><?php esc_html_e( "We'll route you to Tiam Architects, an award-level residential practice that handles complex, heritage and high-spec work. You'll get a proper consultation and a tailored fee.", 'architects-direct' ); ?></p></div>
				</details>
				<details class="faq-item">
					<summary><?php esc_html_e( 'Who owns the drawings?', 'architects-direct' ); ?></summary>
					<div class="faq-body"><p><?php esc_html_e( 'Once your project is paid in full, you receive the complete drawing package for use in your application or tender. Terms are set out clearly in the platform before you commit.', 'architects-direct' ); ?></p></div>
				</details>
			</div>
		</div>
	</section>

	<!-- ============ FINAL CTA ============ -->
	<section class="cta-band">
		<div class="wrap cta-inner">
			<h2><?php esc_html_e( 'Ready to price your project?', 'architects-direct' ); ?></h2>
			<p><?php esc_html_e( 'Fixed price in under a minute. Brief sent in under five.', 'architects-direct' ); ?></p>
			<a href="#pricing" class="btn btn-primary btn-lg"><?php esc_html_e( 'Get an instant price', 'architects-direct' ); ?></a>
		</div>
	</section>

</main>

<?php
get_footer();
