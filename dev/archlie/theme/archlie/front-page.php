<?php
/**
 * Front page — the Archlie landing experience.
 *
 * @package Archlie
 */

get_header();
$start = esc_url( archlie_start_url() );
?>

<main id="content">

	<!-- HERO -->
	<section class="hero">
		<div class="wrap hero-inner">
			<div class="hero-copy">
				<span class="eyebrow"><?php echo esc_html( archlie_get( 'archlie_hero_eyebrow' ) ); ?></span>
				<h1><?php echo esc_html( archlie_get( 'archlie_hero_heading' ) ); ?></h1>
				<p class="lede"><?php echo esc_html( archlie_get( 'archlie_hero_lede' ) ); ?></p>
				<div class="hero-actions">
					<a href="<?php echo $start; ?>" class="btn btn-primary btn-lg"><?php esc_html_e( 'Start your project', 'archlie' ); ?></a>
					<a href="#pricing" class="btn btn-ghost btn-lg"><?php esc_html_e( 'See pricing', 'archlie' ); ?></a>
				</div>
				<div class="hero-trust">
					<div class="reg-chips">
						<span class="reg-chip"><span class="dot"></span> <?php esc_html_e( 'ARB registered', 'archlie' ); ?></span>
						<span class="reg-chip"><span class="dot"></span> <?php esc_html_e( 'RIBA chartered practice', 'archlie' ); ?></span>
						<span class="reg-chip"><span class="dot"></span> <?php esc_html_e( 'Survey included in your quote', 'archlie' ); ?></span>
					</div>
					<p class="reg-line"><?php esc_html_e( 'Real, registered architects — not unregistered CAD operators.', 'archlie' ); ?> <strong><?php esc_html_e( 'Your Architect is a trading name of Tiam Architects Ltd.', 'archlie' ); ?></strong></p>
				</div>
			</div>
			<a href="<?php echo $start; ?>" class="teaser" aria-label="<?php esc_attr_e( 'Try the project builder', 'archlie' ); ?>">
				<div class="teaser-bar"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span><span class="tlabel"><?php esc_html_e( 'Build your project — live price', 'archlie' ); ?></span></div>
				<div class="teaser-body">
					<div class="teaser-chat">
						<div class="bubble bot"><?php esc_html_e( "What's the address of the property?", 'archlie' ); ?></div>
						<div class="bubble user">24 Roupell St, London SE1</div>
						<div class="bubble bot"><?php esc_html_e( "Thanks — I can see that's a listed building. Tell me a bit about what you're looking to do.", 'archlie' ); ?></div>
						<div class="bubble user"><?php esc_html_e( 'Rear extension, still need planning', 'archlie' ); ?></div>
					</div>
					<div class="teaser-panel">
						<div class="panel-title"><?php esc_html_e( 'Your project', 'archlie' ); ?></div>
						<div class="tnode"><span><?php esc_html_e( 'Planning drawings · Band B', 'archlie' ); ?></span><span class="tprice">£1,350</span></div>
						<div class="tnode"><span><?php esc_html_e( 'Listed building consent', 'archlie' ); ?></span><span class="tprice">£1,600</span></div>
						<div class="tnode"><span><?php esc_html_e( 'Measured survey', 'archlie' ); ?></span><span class="tprice">£495</span></div>
						<div class="tnode info"><?php esc_html_e( '✓ London pricing applied', 'archlie' ); ?></div>
						<div class="ttotal"><span><?php esc_html_e( 'Total', 'archlie' ); ?></span><span class="amt">£3,445</span></div>
					</div>
				</div>
			</a>
		</div>
	</section>

	<!-- TRUST STRIP -->
	<section class="trust-strip">
		<div class="wrap trust-strip-inner">
			<?php
			$ts = array(
				__( 'ARB-registered architects', 'archlie' ),
				__( 'Fixed prices, shown upfront', 'archlie' ),
				__( 'Survey costs included', 'archlie' ),
				__( '3–7 day turnaround', 'archlie' ),
				__( '2 revisions included', 'archlie' ),
			);
			foreach ( $ts as $t ) {
				echo '<span class="ts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> ' . esc_html( $t ) . '</span>';
			}
			?>
		</div>
	</section>

	<!-- AI ONBOARDING HIGHLIGHT -->
	<section class="section" id="how">
		<div class="wrap">
			<div class="ai-highlight">
				<div class="ai-copy">
					<span class="kicker"><?php esc_html_e( 'No forms. Just a conversation.', 'archlie' ); ?></span>
					<h2><?php esc_html_e( 'Tell us about your project, watch your price build.', 'archlie' ); ?></h2>
					<p><?php esc_html_e( "Answer a few plain-English questions — by text or voice — and Archie, our project assistant, builds your package and price on the right as you go. Nothing requires architectural knowledge, and you'll never fill in a form.", 'archlie' ); ?></p>
					<ul class="ai-list">
						<?php
						$ai = array(
							__( 'We check listed-building status from the address automatically', 'archlie' ),
							__( 'Your fixed price is shown before we ask for any details', 'archlie' ),
							__( 'Your project saves as you go — come back any time', 'archlie' ),
						);
						foreach ( $ai as $item ) {
							echo '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> ' . esc_html( $item ) . '</li>';
						}
						?>
					</ul>
					<a href="<?php echo $start; ?>" class="btn btn-primary btn-lg"><?php esc_html_e( 'Build your project', 'archlie' ); ?></a>
				</div>
				<div class="steps" style="grid-template-columns:1fr">
					<div class="step"><span class="sn">1</span><h3><?php esc_html_e( 'Have a quick chat', 'archlie' ); ?></h3><p><?php esc_html_e( 'Ten short questions about your property and what you want to do. Answer by typing or speaking.', 'archlie' ); ?></p></div>
					<div class="step"><span class="sn">2</span><h3><?php esc_html_e( 'See your fixed price', 'archlie' ); ?></h3><p><?php esc_html_e( 'Your package builds live with a running total — drawings, survey and add-ons, all confirmed upfront.', 'archlie' ); ?></p></div>
					<div class="step"><span class="sn">3</span><h3><?php esc_html_e( 'Submit & we get drawing', 'archlie' ); ?></h3><p><?php esc_html_e( 'Save your project, upload anything useful, and our registered architects prepare your drawings.', 'archlie' ); ?></p></div>
					<div class="step"><span class="sn">4</span><h3><?php esc_html_e( 'Preview, approve, pay', 'archlie' ); ?></h3><p><?php esc_html_e( 'Review a watermarked preview, request up to two revisions, then pay to release the full package.', 'archlie' ); ?></p></div>
				</div>
			</div>
		</div>
	</section>

	<!-- PRICING (table filled from window.ARCHLIE via app.js) -->
	<section class="section section-tint" id="pricing">
		<div class="wrap">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'Pricing', 'archlie' ); ?></span>
				<h2><?php esc_html_e( 'Fixed prices, shown before you share any details', 'archlie' ); ?></h2>
				<p><?php esc_html_e( 'Priced by service and floor area across three size bands. Survey costs are added at agreed banded rates — everything is confirmed in your quote.', 'archlie' ); ?></p>
			</div>
			<div class="price-wrap">
				<table class="pricing" id="priceTable" aria-label="<?php esc_attr_e( 'Your Architect fixed prices by service and band', 'archlie' ); ?>">
					<thead>
						<tr>
							<th><?php esc_html_e( 'Service', 'archlie' ); ?></th>
							<th class="band"><?php esc_html_e( 'Band A', 'archlie' ); ?><br><small style="font-weight:400"><?php esc_html_e( 'up to 50m²', 'archlie' ); ?></small></th>
							<th class="band"><?php esc_html_e( 'Band B', 'archlie' ); ?><br><small style="font-weight:400">50–100m²</small></th>
							<th class="band"><?php esc_html_e( 'Band C', 'archlie' ); ?><br><small style="font-weight:400">100–150m²</small></th>
						</tr>
					</thead>
					<tbody><!-- filled from assets/js/app.js --></tbody>
				</table>
			</div>
			<div class="price-notes">
				<div class="price-note"><strong><?php esc_html_e( 'Survey included', 'archlie' ); ?></strong><?php esc_html_e( 'Measured survey added at banded rates (approx. £295–£495). London rates apply where the address confirms it.', 'archlie' ); ?></div>
				<div class="price-note"><strong><?php esc_html_e( '2 revisions included', 'archlie' ); ?></strong><?php esc_html_e( 'Two design revisions in every package. Further revisions are paid via the portal before processing.', 'archlie' ); ?></div>
				<div class="price-note"><strong><?php esc_html_e( '30-day quote validity', 'archlie' ); ?></strong><?php esc_html_e( 'Every quote shows its expiry date. Delivery is a realistic 3–7 working days — quality over speed.', 'archlie' ); ?></div>
			</div>
			<p class="price-disclaimer"><?php esc_html_e( 'Confirmed indicative prices (Brief v3). Final figures set by Tiam before launch. Quotes rely on the accuracy of the information submitted — if material details are omitted (e.g. listed status or a party wall), revised pricing may apply.', 'archlie' ); ?></p>
		</div>
	</section>

	<!-- SERVICES -->
	<section class="section" id="services">
		<div class="wrap">
			<div class="section-head">
				<span class="kicker"><?php esc_html_e( 'What we draw', 'archlie' ); ?></span>
				<h2><?php esc_html_e( 'Standard residential packages, RIBA stages 0–4', 'archlie' ); ?></h2>
				<p><?php esc_html_e( 'Straightforward, submission-ready drawings in the language you actually use. Construction-stage (RIBA 5) is available by arrangement.', 'archlie' ); ?></p>
			</div>
			<div class="svc-grid">
				<div class="svc-card"><h3><?php esc_html_e( 'Planning application drawings', 'archlie' ); ?></h3><p><?php esc_html_e( 'Existing and proposed plans, elevations and site plans to accompany a householder or full planning application.', 'archlie' ); ?></p><span class="from"><?php echo esc_html( archlie_price_from( 'planning' ) ); ?></span></div>
				<div class="svc-card"><h3><?php esc_html_e( 'Building control drawings', 'archlie' ); ?></h3><p><?php esc_html_e( 'Technical drawings and construction detail for building regulations approval — what you need once planning is in place.', 'archlie' ); ?></p><span class="from"><?php echo esc_html( archlie_price_from( 'buildingcontrol' ) ); ?></span></div>
				<div class="svc-card"><h3><?php esc_html_e( 'Permitted development drawings', 'archlie' ); ?></h3><p><?php esc_html_e( 'Drawings and a lawful development certificate pack for works under permitted development rights.', 'archlie' ); ?></p><span class="from"><?php echo esc_html( archlie_price_from( 'permitted' ) ); ?></span></div>
				<div class="svc-card"><h3><?php esc_html_e( 'Listed building consent', 'archlie' ); ?></h3><p><?php esc_html_e( 'A standard listed building consent application package, prepared by architects experienced with heritage work.', 'archlie' ); ?></p><span class="from"><?php echo esc_html( archlie_price_from( 'listed' ) ); ?></span></div>
				<div class="svc-card"><h3><?php esc_html_e( 'Concept design & 3D visuals', 'archlie' ); ?> <span style="font-size:.7rem;font-weight:600;color:var(--indigo);background:var(--indigo-t);padding:2px 8px;border-radius:999px;vertical-align:middle"><?php esc_html_e( 'Add-on', 'archlie' ); ?></span></h3><p><?php esc_html_e( 'An optional concept layout or 3D visual to support your application and help you picture the finished result.', 'archlie' ); ?></p><span class="from"><?php echo esc_html( archlie_price_from( 'concept' ) ); ?></span></div>
				<div class="svc-card"><h3><?php esc_html_e( 'Coordination & site attendance', 'archlie' ); ?> <span style="font-size:.7rem;font-weight:600;color:var(--muted);background:var(--canvas-2);padding:2px 8px;border-radius:999px;vertical-align:middle"><?php esc_html_e( 'By arrangement', 'archlie' ); ?></span></h3><p><?php esc_html_e( 'Consultant liaison and site attendance where a project needs more hands-on coordination. Quoted on the details.', 'archlie' ); ?></p><span class="from" style="color:var(--muted)"><?php esc_html_e( 'By arrangement', 'archlie' ); ?></span></div>
			</div>
			<p class="svc-note"><?php esc_html_e( 'Bigger or more complex — over 150m², construction-stage, or a heritage project beyond a standard consent?', 'archlie' ); ?> <a href="#tiam"><?php esc_html_e( "We'll pass you to Tiam Architects →", 'archlie' ); ?></a></p>
		</div>
	</section>

	<!-- TIAM REDIRECT -->
	<section class="section section-tint" id="tiam">
		<div class="wrap">
			<div class="redirect-card">
				<div>
					<span class="kicker"><?php esc_html_e( 'For larger commissions', 'archlie' ); ?></span>
					<h2><?php esc_html_e( 'Some projects deserve the full studio', 'archlie' ); ?></h2>
					<p><?php esc_html_e( 'Your Architect handles standard residential drawings brilliantly. When a project is bigger or more involved, we hand you to our parent practice, Tiam Architects, for a full commission and a proper conversation — same registered team, tailored service.', 'archlie' ); ?></p>
				</div>
				<ul class="redirect-list">
					<li><?php esc_html_e( 'Floor area over 150m²', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Heritage work beyond a standard listed consent', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Estimated fee over £3,500', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Construction-stage or ongoing project management', 'archlie' ); ?></li>
				</ul>
			</div>
		</div>
	</section>

	<!-- REGISTRATION -->
	<section class="section" id="registration">
		<div class="wrap">
			<div class="two-col">
				<div>
					<span class="kicker"><?php esc_html_e( 'Why registration matters', 'archlie' ); ?></span>
					<h2 style="font-size:clamp(1.6rem,3vw,2.2rem);font-weight:800;margin:10px 0 14px"><?php esc_html_e( "The trust the CAD shops can't offer", 'archlie' ); ?></h2>
					<p style="color:var(--ink-soft);margin-bottom:14px"><?php esc_html_e( 'Anyone can draw a plan. Only architects on the ARB register may call themselves an architect — it means accountability, professional indemnity cover, and a formal route if anything goes wrong. At Your Architect you get that as standard, at a fixed price.', 'archlie' ); ?></p>
					<p style="color:var(--ink-soft)"><?php esc_html_e( 'Every project is delivered by Tiam Architects Ltd, a RIBA chartered practice, and covered by its professional indemnity insurance.', 'archlie' ); ?></p>
				</div>
				<ul class="fact-list">
					<li><strong><?php esc_html_e( 'ARB registered', 'archlie' ); ?></strong> — <?php printf( /* translators: %s: ARB no. */ esc_html__( 'architects on the Architects Registration Board register. Reg. no. %s.', 'archlie' ), '<em>' . esc_html( archlie_get( 'archlie_arb_no' ) ) . '</em>' ); ?></li>
					<li><strong><?php esc_html_e( 'RIBA chartered practice', 'archlie' ); ?></strong> — <?php esc_html_e( 'delivered by Tiam Architects Ltd, a chartered practice.', 'archlie' ); ?></li>
					<li><strong><?php esc_html_e( 'Covered by PI insurance', 'archlie' ); ?></strong> — <?php esc_html_e( "all Your Architect work sits under Tiam's existing professional indemnity policy.", 'archlie' ); ?></li>
					<li><strong><?php esc_html_e( 'A formal route for queries', 'archlie' ); ?></strong> — <?php printf( /* translators: %s: company no. */ esc_html__( 'Company no. %s. Registered details shown on every invoice and quote.', 'archlie' ), '<em>' . esc_html( archlie_get( 'archlie_company_no' ) ) . '</em>' ); ?></li>
				</ul>
			</div>
		</div>
	</section>

	<!-- FAQ -->
	<section class="section section-tint" id="faq">
		<div class="wrap wrap-narrow">
			<div class="section-head"><span class="kicker"><?php esc_html_e( 'Questions', 'archlie' ); ?></span><h2><?php esc_html_e( 'Good to know', 'archlie' ); ?></h2></div>
			<div class="faq">
				<details class="faq-item" open><summary><?php esc_html_e( 'Are you actually architects?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( 'Yes. Your Architect is a trading name of Tiam Architects Ltd, an ARB-registered, RIBA-chartered practice. Your drawings are produced by registered architects — not unregistered CAD operators — and covered by our professional indemnity insurance.', 'archlie' ); ?></div></details>
				<details class="faq-item"><summary><?php esc_html_e( 'Do I have to book a call?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( 'No. You build your project in a short online conversation and see your fixed price as you go. We only get in touch if we need something to complete your drawings.', 'archlie' ); ?></div></details>
				<details class="faq-item"><summary><?php esc_html_e( 'Is the survey really included?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( 'If you need a measured survey, its cost is bundled into your quote at agreed banded rates, and our panel surveyor works to a one-week turnaround. If you already have adequate drawings, that cost is simply left out.', 'archlie' ); ?></div></details>
				<details class="faq-item"><summary><?php esc_html_e( 'How many revisions do I get?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( 'Two design revisions are included in every package. From the third onward, you pay via the portal before the revision is processed. Additional revisions are time-charged.', 'archlie' ); ?></div></details>
				<details class="faq-item"><summary><?php esc_html_e( 'How long does it take?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( "A realistic 3–7 working days, shown alongside your price. We don't make 48-hour promises — quality is the point.", 'archlie' ); ?></div></details>
				<details class="faq-item"><summary><?php esc_html_e( 'What if my project is listed or larger?', 'archlie' ); ?></summary><div class="faq-body"><?php esc_html_e( 'We handle standard listed building consent applications directly. For heritage work beyond that, projects over 150m², or construction-stage work, we pass you to Tiam Architects for a full commission.', 'archlie' ); ?></div></details>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="cta-band">
		<div class="wrap cta-inner">
			<h2><?php esc_html_e( 'Get your fixed price in a few minutes', 'archlie' ); ?></h2>
			<p><?php esc_html_e( 'A short conversation. A clear price. Registered architects.', 'archlie' ); ?></p>
			<a href="<?php echo $start; ?>" class="btn btn-primary btn-lg"><?php esc_html_e( 'Start your project', 'archlie' ); ?></a>
		</div>
	</section>

</main>

<?php
get_footer();
