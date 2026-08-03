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
$t_svg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 4 V16.5 A3 3 0 0 0 16.5 19.5 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 9 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg>';
?>

<!-- HERO: logo (header) + tagline + Archie -->
<section class="zone zone--pale" id="top">
	<div class="band hero">
		<h1 class="tagline"><?php esc_html_e( 'Architecture priced', 'archlie' ); ?> <span class="u"><?php esc_html_e( 'upfront.', 'archlie' ); ?></span></h1>

		<div class="hero-embed-wrap" id="archie">
			<span class="hero-cue"><?php esc_html_e( 'Talk to Archie — your price builds as you answer', 'archlie' ); ?></span>
			<div class="archie-embed">
				<div class="ob-top">
					<span class="ob-title"><span class="archie-badge"><?php echo $t_svg; // phpcs:ignore ?></span> <?php esc_html_e( 'Chat with Archie', 'archlie' ); ?></span>
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
								<strong><?php esc_html_e( 'A better fit for a full commission', 'archlie' ); ?></strong>
								<p><?php esc_html_e( 'A project this size or scope is usually best handled by our parent studio, Tiam Architects. You can still submit here, or request a consultation.', 'archlie' ); ?></p>
							</div>
							<div class="total-row"><span class="t-label"><?php esc_html_e( 'Total', 'archlie' ); ?></span><span class="t-amt" id="totalAmt">£0</span></div>
							<p class="total-sub" id="totalSub"><?php esc_html_e( 'Fixed price · survey included where added', 'archlie' ); ?></p>
							<div class="quote-meta" id="quoteMeta" hidden>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <?php esc_html_e( 'Delivery in', 'archlie' ); ?> <strong id="mDelivery">3–7 working days</strong></div>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <span id="mRevisions"><?php esc_html_e( '2 revisions included', 'archlie' ); ?></span></div>
								<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> <?php esc_html_e( 'Quote valid until', 'archlie' ); ?> <strong id="mValidity">—</strong></div>
							</div>
							<button class="btn btn-primary btn-block submit-btn" id="submitBtn" type="button" disabled><?php esc_html_e( 'Save & submit project', 'archlie' ); ?></button>
						</div>
					</aside>
				</div>
			</div>
		</div>
	</div>
</section>

<!-- STATS -->
<section class="zone zone--ink pad">
	<div class="band">
		<div class="stats">
			<div class="stat"><div class="figure">90%<span style="color:var(--terra)">+</span></div><div class="label"><?php esc_html_e( 'Planning approval rate', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'Target at launch — the number that reframes the price.', 'archlie' ); ?></div></div>
			<div class="stat"><div class="figure">£0</div><div class="label"><?php esc_html_e( 'Hidden fees', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'Everything in our control is fixed. No hourly rates.', 'archlie' ); ?></div></div>
			<div class="stat"><div class="figure">3–7<span style="font-size:.4em;font-weight:700"> <?php esc_html_e( 'days', 'archlie' ); ?></span></div><div class="label"><?php esc_html_e( 'Typical turnaround', 'archlie' ); ?></div><div class="sub"><?php esc_html_e( 'A realistic timeframe, shown with your price.', 'archlie' ); ?></div></div>
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

<!-- PRICING -->
<section class="zone zone--pale pad" id="pricing">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'Pricing', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'Fixed prices, by size.', 'archlie' ); ?></h2>
			<p><?php esc_html_e( 'Three floor-area bands across our services. Band B — a typical extension or loft — is where most projects land. Survey costs added at banded rates. Every price includes two revisions.', 'archlie' ); ?></p>
		</div>
		<div class="price-grid" id="priceGrid">
			<div class="price-card" data-band="A"><h3><?php esc_html_e( 'Band A', 'archlie' ); ?></h3><p class="band-note"><?php esc_html_e( 'Up to 50m²', 'archlie' ); ?></p><div class="rows"></div></div>
			<div class="price-card feat" data-band="B"><h3><?php esc_html_e( 'Band B', 'archlie' ); ?></h3><p class="band-note">50–100m²</p><div class="rows"></div></div>
			<div class="price-card" data-band="C"><h3><?php esc_html_e( 'Band C', 'archlie' ); ?></h3><p class="band-note">100–150m²</p><div class="rows"></div></div>
		</div>
		<p class="price-note"><?php esc_html_e( 'Indicative prices, confirmed by Tiam before launch — set to sit just below comparable published rates. Over 150m², or a project that needs ongoing management, is handled by Tiam Architects as a full commission.', 'archlie' ); ?></p>
	</div>
</section>

<!-- HOW IT WORKS -->
<section class="zone pad" id="how">
	<div class="band">
		<div class="sec-head">
			<span class="sec-kicker"><?php esc_html_e( 'How it works', 'archlie' ); ?></span>
			<h2><?php esc_html_e( 'Four steps, no phone tag.', 'archlie' ); ?></h2>
		</div>
		<div class="steps">
			<div class="step"><div class="n">01</div><h3><?php esc_html_e( 'Tell Archie', 'archlie' ); ?></h3><p><?php esc_html_e( 'Answer a few plain questions — by text or voice. Your package and price build as you go.', 'archlie' ); ?></p></div>
			<div class="step"><div class="n">02</div><h3><?php esc_html_e( 'See your price', 'archlie' ); ?></h3><p><?php esc_html_e( 'A fixed total, shown before you share any details. Save it and come back whenever you like.', 'archlie' ); ?></p></div>
			<div class="step"><div class="n">03</div><h3><?php esc_html_e( 'We draw, you review', 'archlie' ); ?></h3><p><?php esc_html_e( 'Our registered architects prepare your drawings; you review a watermarked preview and request up to two revisions.', 'archlie' ); ?></p></div>
			<div class="step"><div class="n">04</div><h3><?php esc_html_e( 'Full drawings on payment', 'archlie' ); ?></h3><p><?php esc_html_e( 'Pay online and the complete, submission-ready package is released to your portal.', 'archlie' ); ?></p></div>
		</div>
	</div>
</section>

<!-- CTA -->
<section class="zone zone--terra pad-sm">
	<div class="band" style="display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
		<h2 style="font-size:clamp(1.6rem,3.4vw,2.4rem);max-width:20ch"><?php esc_html_e( 'Your price is a conversation away.', 'archlie' ); ?></h2>
		<a href="#archie" class="btn btn-primary btn-lg"><?php esc_html_e( 'Talk to Archie', 'archlie' ); ?></a>
	</div>
</section>

<?php
get_footer();
