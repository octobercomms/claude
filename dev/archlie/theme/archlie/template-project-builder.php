<?php
/**
 * Template Name: Project Builder
 *
 * Full-screen, two-panel conversational project builder. Assign this template
 * to a Page (the theme auto-creates a "Start your project" page on activation).
 * It renders its own document (no site header/footer chrome).
 *
 * @package Archlie
 */

?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<div class="ob-shell">

	<div class="ob-top">
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="logo" aria-label="<?php esc_attr_e( 'Your Architect home', 'archlie' ); ?>">
			<span class="ymark" aria-hidden="true"></span><span class="wordmark">Your Architect</span>
		</a>
		<span class="ob-title"><span class="archie-badge"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 4 V16.5 A3 3 0 0 0 16.5 19.5 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 9 H17.5" stroke="white" stroke-width="2.4" stroke-linecap="round"/></svg></span> <?php esc_html_e( 'Chat with Archie', 'archlie' ); ?></span>
		<div class="ob-actions">
			<button class="btn btn-outline" id="restartBtn" type="button"><?php esc_html_e( 'Start over', 'archlie' ); ?></button>
		</div>
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
						<button type="submit" class="btn btn-primary btn-sm"><?php esc_html_e( 'Save', 'archlie' ); ?></button>
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
			<button class="ob-panel-toggle" id="panelToggle" type="button">
				<span><?php esc_html_e( 'Your project', 'archlie' ); ?></span>
				<span class="tt-amt" id="toggleTotal">£0</span>
			</button>
			<div class="ob-panel-head">
				<div class="ph-row">
					<h2><?php esc_html_e( 'Your project', 'archlie' ); ?></h2>
					<span class="ph-chip" id="londonChip"><?php esc_html_e( 'London pricing', 'archlie' ); ?></span>
				</div>
				<p><?php esc_html_e( 'Prices update as we chat. Nothing is charged now.', 'archlie' ); ?></p>
			</div>
			<div class="ob-nodes" id="nodes">
				<div class="node-empty" id="nodesEmpty"><?php esc_html_e( 'Your package will appear here as you answer.', 'archlie' ); ?></div>
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

<?php wp_footer(); ?>
</body>
</html>
