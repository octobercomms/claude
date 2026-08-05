<?php
/**
 * Front page — Your Architect (Design Brief, Aug 2026).
 *
 * Radical restraint above the fold (logo + tagline + Archie embedded live),
 * then colour-zone sections below.
 *
 * @package Archlie
 */

get_header();
$face_svg = '<img class="a-ico" src="' . esc_url( get_template_directory_uri() . '/assets/archie-icon.svg' ) . '" alt="Archie">';
?>

<!-- HERO: arc + tagline + Archie -->
<section class="zone hero-zone" id="top">
	<div class="hero-deco" aria-hidden="true"><span class="arc"></span><span class="strip"></span></div>
	<div class="band hero">
		<div class="hero-inner">
			<h1 class="tagline"><?php esc_html_e( 'Architecture', 'archlie' ); ?><br><?php esc_html_e( 'priced upfront', 'archlie' ); ?></h1>
			<p class="hero-lede"><?php esc_html_e( 'Fixed-price architectural drawings.', 'archlie' ); ?><br><?php esc_html_e( 'Priced online. No call required.', 'archlie' ); ?></p>
			<div class="creds">
				<span class="cred"><span class="mark">arb</span><span class="desc">Architects<br>Registration<br>Board</span></span>
				<span class="cred"><span class="mark">RIBA</span><span class="desc">Chartered<br>Architect</span></span>
			</div>
		</div>

		<div class="hero-embed-wrap" id="archie">
			<?php if ( shortcode_exists( 'archie' ) ) : echo do_shortcode( '[archie]' ); else : ?>
			<div class="archie-embed">
				<div class="ob-top">
					<span class="ob-title"><span class="archie-face" aria-hidden="true"><?php echo $face_svg; // phpcs:ignore ?></span> <?php esc_html_e( 'Talk to Archie — your personalised price builds as you answer', 'archlie' ); ?></span>
					<div class="ob-actions"><button class="btn btn-outline" id="restartBtn" type="button"><?php esc_html_e( 'Start over', 'archlie' ); ?></button></div>
				</div>
				<div class="ob-body">
					<section class="ob-chat" aria-label="<?php esc_attr_e( 'Conversation', 'archlie' ); ?>">
						<div class="ob-savebar" id="saveBar" hidden>
							<div class="sb-inner">
								<div class="sb-text">
									<strong><?php esc_html_e( 'Save your progress', 'archlie' ); ?></strong>
									<span><?php esc_html_e( "Enter your email and we'll send a link so you can pick this up later.", 'archlie' ); ?></span>
								</div>
								<form class="sb-form" id="saveForm">
									<input type="email" id="saveEmail" placeholder="you@email.com" autocomplete="email" aria-label="<?php esc_attr_e( 'Email to save your progress', 'archlie' ); ?>">
									<button type="submit" class="btn btn-primary" style="padding:9px 15px"><?php esc_html_e( 'Save', 'archlie' ); ?></button>
								</form>
								<button class="sb-close" id="saveClose" type="button" aria-label="<?php esc_attr_e( 'Dismiss', 'archlie' ); ?>">✕</button>
							</div>
							<div class="sb-saved" id="saveSaved" hidden><?php esc_html_e( "Saved ✓ — we'll email you a link to pick up where you left off.", 'archlie' ); ?></div>
						</div>
						<div class="ob-messages" id="messages"><div class="wrapmsg" id="msgList"></div></div>
						<div class="ob-composer">
							<div class="ob-composer-inner">
								<div class="quick" id="quickReplies"></div>
								<div class="composer-row" id="composerRow">
									<button class="icon-btn" id="photoBtn" type="button" title="<?php esc_attr_e( 'Add a photo of your property', 'archlie' ); ?>" aria-label="<?php esc_attr_e( 'Add a photo', 'archlie' ); ?>">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 0 1 2-2h1.5l1-1.5h5l1 1.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.2"/></svg>
									</button>
									<input type="file" id="photoInput" accept="image/*" hidden>
									<div class="composer-input">
										<textarea id="textInput" rows="1" placeholder="<?php esc_attr_e( 'Type your answer…', 'archlie' ); ?>" autocomplete="off"></textarea>
										<button class="icon-btn" id="micBtn" type="button" title="<?php esc_attr_e( 'Voice input', 'archlie' ); ?>" aria-label="<?php esc_attr_e( 'Voice input', 'archlie' ); ?>">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke-linecap="round"/></svg>
										</button>
									</div>
									<button class="icon-btn send" id="sendBtn" type="button" title="<?php esc_attr_e( 'Send', 'archlie' ); ?>" aria-label="<?php esc_attr_e( 'Send', 'archlie' ); ?>">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h15M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
									</button>
								</div>
							</div>
						</div>
					</section>
					<aside class="ob-panel" id="packagePanel" aria-label="<?php esc_attr_e( 'Your project and price', 'archlie' ); ?>">
						<button class="ob-panel-toggle" id="panelToggle" type="button"><span><?php esc_html_e( 'Your project', 'archlie' ); ?></span><span class="tt-amt" id="toggleTotal">£0</span></button>
						<div class="ob-panel-head">
							<div class="ph-row">
								<h2><?php esc_html_e( 'Your project', 'archlie' ); ?></h2>
								<span class="ph-chip" id="londonChip"><?php esc_html_e( 'London pricing', 'archlie' ); ?></span>
							</div>
							<p><?php esc_html_e( 'Your price builds as you answer. Nothing is charged now.', 'archlie' ); ?></p>
						</div>
						<div class="ob-nodes" id="nodes">
							<div class="node-empty" id="nodesEmpty"><?php esc_html_e( 'Your package appears here as you answer Archie.', 'archlie' ); ?></div>
						</div>
						<div class="ob-panel-foot">
							<div class="redirect-banner" id="redirectBanner">
								<strong><?php esc_html_e( 'A full RIBA commission', 'archlie' ); ?></strong>
								<p><?php esc_html_e( 'Concept-to-construction work (RIBA Stages 0–7) is handled directly by Tiam Architects. Leave your details and the team will be in touch, or email info@tiamarchitects.com.', 'archlie' ); ?></p>
							</div>
							<div class="total-row"><span class="t-label"><?php esc_html_e( 'Total', 'archlie' ); ?></span><span class="t-amt" id="totalAmt">£0</span></div>
							<p class="total-sub" id="totalSub"><?php esc_html_e( 'Nothing is charged now', 'archlie' ); ?></p>
							<div class="quote-meta" id="quoteMeta" hidden>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <?php esc_html_e( 'Drawings issued', 'archlie' ); ?> <strong id="mDelivery"><?php esc_html_e( 'within 7 days', 'archlie' ); ?></strong></div>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <span id="mRevisions"><?php esc_html_e( '2 revisions included', 'archlie' ); ?></span></div>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <?php esc_html_e( 'Quote valid until', 'archlie' ); ?> <strong id="mValidity">—</strong></div>
							</div>
							<button class="btn btn-primary btn-block submit-btn" id="submitBtn" type="button" disabled><?php esc_html_e( 'Save & submit project', 'archlie' ); ?></button>
						</div>
					</aside>
				</div>
			</div>
			<?php endif; ?>
		</div>
	</div>
</section>

<!-- STATS -->
<section class="zone zone--ink pad">
	<div class="band">
		<div class="stats">
			<div class="stat"><div class="figure">90%<span class="accent">+</span></div><div class="label"><?php esc_html_e( 'Planning approval rate', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'Target at launch — the number that reframes the price.', 'archlie' ); ?></div></div>
			<div class="stat"><div class="figure">£0</div><div class="label"><?php esc_html_e( 'Hidden fees', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'Everything in our control is fixed. No hourly rates.', 'archlie' ); ?></div></div>
			<div class="stat"><div class="figure">7<span style="font-size:.4em;font-weight:700"> <?php esc_html_e( 'days', 'archlie' ); ?></span></div><div class="label"><?php esc_html_e( 'Typical turnaround', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'Drawings usually issued within 7 days of survey receipt or confirmed requirements.', 'archlie' ); ?></div></div>
		</div>
	</div>
</section>

<!-- HONEST COMPARISON -->
<section class="zone pad" id="compare">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'The honest comparison', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'What you actually get, side by side.', 'archlie' ); ?></h2>
			<p><?php esc_html_e( 'No selling. The gap between a transparent service and how architecture is usually sold speaks for itself.', 'archlie' ); ?></p>
		</div>
		<div class="compare-wrap">
			<table class="compare">
				<thead>
					<tr><th></th><th class="col us"><?php esc_html_e( 'Your Architect', 'archlie' ); ?></th><th class="col"><?php esc_html_e( 'Traditional practice', 'archlie' ); ?></th><th class="col"><?php esc_html_e( 'Unregistered CAD', 'archlie' ); ?></th></tr>
				</thead>
				<tbody>
					<?php
					$rows = array(
						array( __( 'Price shown upfront', 'archlie' ), '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Quote after a call', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Sometimes', 'archlie' ) . '</span>' ),
						array( __( 'ARB / RIBA registered', 'archlie' ), '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="no">✕</span>' ),
						array( __( 'Survey included in the price', 'archlie' ), '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Extra', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Extra', 'archlie' ) . '</span>' ),
						array( __( 'Start today, no call', 'archlie' ), '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="no">✕</span>', '<span class="muted">' . esc_html__( 'Varies', 'archlie' ) . '</span>' ),
						array( __( 'Published approval rate', 'archlie' ), '<span class="yes">' . esc_html__( 'Yes', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Never shown', 'archlie' ) . '</span>', '<span class="no">✕</span>' ),
						array( __( 'Revisions included', 'archlie' ), '<span class="yes">' . esc_html__( 'Two', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Hourly', 'archlie' ) . '</span>', '<span class="muted">' . esc_html__( 'Varies', 'archlie' ) . '</span>' ),
					);
					foreach ( $rows as $r ) {
						echo '<tr><th>' . esc_html( $r[0] ) . '</th><td class="cell us">' . wp_kses_post( $r[1] ) . '</td><td class="cell">' . wp_kses_post( $r[2] ) . '</td><td class="cell">' . wp_kses_post( $r[3] ) . '</td></tr>';
					}
					?>
				</tbody>
			</table>
		</div>
	</div>
</section>

<!-- PRICING MENU (two flat packages) -->
<section class="zone zone--pale pad" id="pricing">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'Pricing', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'Two fixed packages. Pick one.', 'archlie' ); ?></h2>
			<p><?php esc_html_e( "No floor-area bands, no hourly rates. Two flat prices, with a short menu of optional add-ons shown before you commit. Every package includes two revisions — and we're not VAT-registered, so the price you see is the price you pay.", 'archlie' ); ?></p>
		</div>
		<div class="pkg-grid">
			<div class="pkg-card feat">
				<div class="pkg-top">
					<h3><?php esc_html_e( 'Planning — full package', 'archlie' ); ?></h3>
					<div class="pkg-price"><span data-pkg-price="planning"><?php echo esc_html( archlie_package_price( 'planning' ) ); ?></span></div>
				</div>
				<p class="pkg-blurb"><?php esc_html_e( 'Home extensions · loft, mansard & garage conversions · outbuildings · new dwellings', 'archlie' ); ?></p>
				<div class="pkg-inc-label"><?php esc_html_e( 'Includes', 'archlie' ); ?></div>
				<ul class="pkg-list">
					<li><?php esc_html_e( 'Site, location & block plans', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Existing + proposed drawings', 'archlie' ); ?></li>
					<li><?php esc_html_e( '3D concept design (up to 2 revisions)', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Planning application prep, submission & management', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Detailed Building Regulations drawings', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Drawing revisions', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Free amendments requested by the council', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Site visit on request (London boroughs only, additional charge)', 'archlie' ); ?></li>
				</ul>
			</div>
			<div class="pkg-card">
				<div class="pkg-top">
					<h3><?php esc_html_e( 'Building Regs drawings', 'archlie' ); ?></h3>
					<div class="pkg-price"><span data-pkg-price="buildingregs"><?php echo esc_html( archlie_package_price( 'buildingregs' ) ); ?></span></div>
				</div>
				<p class="pkg-blurb"><?php esc_html_e( 'For projects with planning already approved — internal alterations, approved extensions, conversions, outbuildings, new dwellings', 'archlie' ); ?></p>
				<div class="pkg-inc-label"><?php esc_html_e( 'Includes', 'archlie' ); ?></div>
				<ul class="pkg-list">
					<li><?php esc_html_e( 'Detailed Building Regulations drawings', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Construction details & written specification', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Drainage layout where required', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Building control submission on request', 'archlie' ); ?></li>
					<li><?php esc_html_e( 'Drawing revisions', 'archlie' ); ?></li>
				</ul>
			</div>
		</div>
		<div class="addons">
			<div class="addons-head"><?php esc_html_e( 'Optional add-ons', 'archlie' ); ?></div>
			<ul class="addon-list">
				<li><span><?php esc_html_e( '3D concept visual (up to 2 revisions)', 'archlie' ); ?></span><strong><?php echo esc_html( archlie_money( 250 ) ); ?></strong></li>
				<li><span><?php esc_html_e( 'We submit & manage your planning application', 'archlie' ); ?></span><strong>+<?php echo esc_html( archlie_money( 80 ) ); ?></strong></li>
				<li><span><?php esc_html_e( 'Site visit (London boroughs / within the M25)', 'archlie' ); ?></span><strong><?php echo esc_html( archlie_money( 350 ) ); ?></strong></li>
				<li><span><?php esc_html_e( 'Measured survey & structural engineer', 'archlie' ); ?></span><strong><?php esc_html_e( 'sourced separately — quote to follow', 'archlie' ); ?></strong></li>
			</ul>
			<p class="menu-note"><?php esc_html_e( "Need a measured survey or a structural engineer? We'll help — we find a trusted independent local professional, share their quote for your approval first, and you pay them directly for their work. No admin fees, and never for our time. Full RIBA services (Stages 0–7), concept to construction, are handled by Tiam Architects —", 'archlie' ); ?> <a href="mailto:info@tiamarchitects.com">info@tiamarchitects.com</a>.</p>
		</div>
	</div>
</section>

<!-- SERVICES -->
<section class="zone pad" id="services">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'Our services', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'The full range, any location in mainland UK.', 'archlie' ); ?></h2>
			<p><?php esc_html_e( 'Fully remote. Whatever your project needs, Archie will point you to the right package.', 'archlie' ); ?></p>
		</div>
		<ul class="services-grid">
			<?php
			$svcs = array(
				__( 'Rear, side & wraparound extensions', 'archlie' ),
				__( 'Two-storey extensions', 'archlie' ),
				__( 'Loft & mansard conversions', 'archlie' ),
				__( 'Garage conversions', 'archlie' ),
				__( 'Garden rooms & outbuildings', 'archlie' ),
				__( 'New build homes', 'archlie' ),
				__( 'Internal alterations & refurbishment', 'archlie' ),
				__( 'Change of use (without construction)', 'archlie' ),
				__( 'Pre-planning applications', 'archlie' ),
				__( 'Planning applications', 'archlie' ),
				__( 'Permitted development / lawful development certificate', 'archlie' ),
				__( 'Listed building consent', 'archlie' ),
				__( 'Retrospective applications', 'archlie' ),
				__( 'Measured building surveys', 'archlie' ),
			);
			foreach ( $svcs as $svc ) {
				echo '<li>' . esc_html( $svc ) . '</li>';
			}
			?>
		</ul>
	</div>
</section>

<!-- HOW WE WORK (Tiam's 3 steps) -->
<section class="zone pad" id="how">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'How we work', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'Three steps, no phone tag.', 'archlie' ); ?></h2>
		</div>
		<div class="steps steps--3">
			<div class="step"><div class="n">01</div><h3><?php esc_html_e( 'You send us your project details', 'archlie' ); ?></h3><p><?php esc_html_e( 'Answer a few plain questions with Archie — by text or voice. Your fixed price builds as you go.', 'archlie' ); ?></p></div>
			<div class="step"><div class="n">02</div><h3><?php esc_html_e( 'We confirm & set you up', 'archlie' ); ?></h3><p><?php esc_html_e( 'We review your requirements, confirm the fee by email and open your project portal. You click approved.', 'archlie' ); ?></p></div>
			<div class="step"><div class="n">03</div><h3><?php esc_html_e( 'Upload, we draw', 'archlie' ); ?></h3><p><?php esc_html_e( 'Add your sketches, photos and comments in the portal, and our registered architects produce your drawings. Simple as that.', 'archlie' ); ?></p></div>
		</div>
	</div>
</section>

<!-- FAQ -->
<section class="zone zone--pale pad" id="faq">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'FAQ', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'The questions we get asked most.', 'archlie' ); ?></h2>
		</div>
		<div class="faq">
			<?php
			$faqs = array(
				array( __( 'Is the price really fixed?', 'archlie' ), __( "Yes. Everything in our control — the drawings, two revisions, and the survey where you add it — is a fixed total, shown before you share any details. The only things we can't fix are third-party fees (like your local authority's planning application fee), and we flag those clearly.", 'archlie' ) ),
				array( __( 'Who actually does the drawings?', 'archlie' ), __( 'Registered architects at Tiam Architects Ltd — an ARB-registered, RIBA-chartered practice. Your Architect is our fixed-price service for standard residential projects; the same people prepare your package.', 'archlie' ) ),
				array( __( 'What if my project is bigger or unusual?', 'archlie' ), __( "If it's over 150m², or needs ongoing management, Archie will flag it as a better fit for a full commission with Tiam. You can still submit here, or request a consultation — no wasted call either way.", 'archlie' ) ),
				array( __( 'When do I pay?', 'archlie' ), __( 'Nothing is charged while you talk to Archie. We prepare your drawings and send a watermarked preview; you only pay online to release the full, submission-ready package.', 'archlie' ) ),
			);
			foreach ( $faqs as $i => $f ) {
				printf(
					'<details%s><summary>%s</summary><p>%s</p></details>',
					0 === $i ? ' open' : '',
					esc_html( $f[0] ),
					esc_html( $f[1] )
				);
			}
			?>
		</div>
	</div>
</section>

<!-- CTA -->
<section class="zone zone--blue pad-sm">
	<div class="band" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
		<h2 style="font-size:clamp(1.6rem,3.4vw,2.4rem);max-width:20ch;color:#fff"><?php esc_html_e( 'Your price is a conversation away.', 'archlie' ); ?></h2>
		<div class="cta-actions">
			<a href="#archie" class="btn btn-primary btn-lg"><?php esc_html_e( 'Talk to Archie', 'archlie' ); ?></a>
			<a href="#book" class="cta-call"><?php esc_html_e( 'Prefer to talk it through first? Book a call →', 'archlie' ); ?></a>
		</div>
	</div>
</section>

<?php
get_footer();
