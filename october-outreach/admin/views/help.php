<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>

<div class="oo-page-header">
    <h1 class="oo-page-title">Help & Support</h1>
</div>

<style>
.oo-help-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; margin-bottom:24px; }
.oo-help-service { display:flex; align-items:flex-start; gap:12px; padding:16px 0; border-bottom:1px solid var(--oo-border); }
.oo-help-service:last-child { border-bottom:none; padding-bottom:0; }
.oo-service-icon { width:40px; height:40px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:18px; }
.oo-service-info h3 { font-size:14px; font-weight:600; margin:0 0 2px; }
.oo-service-info p { font-size:13px; color:var(--oo-muted); margin:0 0 6px; line-height:1.5; }
.oo-cost-tag { font-size:11px; font-weight:600; color:var(--oo-accent); background:rgba(99,102,241,.08); padding:2px 8px; border-radius:20px; }
.oo-help-step { display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--oo-border); }
.oo-help-step:last-child { border-bottom:none; }
.oo-step-num { width:24px; height:24px; border-radius:50%; background:var(--oo-accent); color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px; }
.oo-step-text { font-size:13px; line-height:1.6; }
.oo-step-text strong { display:block; margin-bottom:2px; }
.oo-faq-item { padding:16px 0; border-bottom:1px solid var(--oo-border); }
.oo-faq-item:last-child { border-bottom:none; }
.oo-faq-q { font-size:14px; font-weight:600; margin:0 0 6px; }
.oo-faq-a { font-size:13px; color:var(--oo-muted); line-height:1.6; margin:0; }
</style>

<!-- Services Overview -->
<div class="oo-help-grid">

    <div class="oo-card">
        <h2 class="oo-card-title">Claude AI</h2>
        <p class="oo-muted" style="margin-bottom:16px;font-size:13px">The brain of October Outreach. Claude researches your audience, writes your emails, and classifies replies so you know who to follow up with.</p>

        <div class="oo-help-service">
            <div class="oo-service-icon" style="background:#f0f4ff">🤖</div>
            <div class="oo-service-info">
                <h3>What you need</h3>
                <p>An Anthropic account and API key. Usage is pay-per-use — you only pay when the AI is actively writing or researching.</p>
                <span class="oo-cost-tag">~$0.01–$0.05 per campaign email written</span>
            </div>
        </div>

        <div style="margin-top:12px">
            <p style="font-size:13px;font-weight:600;margin:0 0 8px">How to set up:</p>
            <div class="oo-help-step">
                <div class="oo-step-num">1</div>
                <div class="oo-step-text"><strong>Create an account</strong> Go to <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> and sign up.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">2</div>
                <div class="oo-step-text"><strong>Add credit</strong> Go to Billing and add a small amount (£10 will last a long time).</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">3</div>
                <div class="oo-step-text"><strong>Create an API key</strong> Go to API Keys → Create Key. Copy the key — you won't see it again.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">4</div>
                <div class="oo-step-text"><strong>Paste it here</strong> Go to <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Settings</a> and paste it into the Claude AI field.</div>
            </div>
        </div>
    </div>

    <div class="oo-card">
        <h2 class="oo-card-title">Hunter.io</h2>
        <p class="oo-muted" style="margin-bottom:16px;font-size:13px">Finds email addresses for the types of contacts you want to reach. You give it a list of company websites, it finds the right people.</p>

        <div class="oo-help-service">
            <div class="oo-service-icon" style="background:#fef3f2">🔍</div>
            <div class="oo-service-info">
                <h3>What you need</h3>
                <p>A Hunter.io account and API key. Free plan includes 25 searches per month — enough to test. Paid plans start from around $49/month.</p>
                <span class="oo-cost-tag">Free plan available · Paid from ~$49/mo</span>
            </div>
        </div>

        <div style="margin-top:12px">
            <p style="font-size:13px;font-weight:600;margin:0 0 8px">How to set up:</p>
            <div class="oo-help-step">
                <div class="oo-step-num">1</div>
                <div class="oo-step-text"><strong>Create an account</strong> Go to <a href="https://hunter.io" target="_blank">hunter.io</a> and sign up for free.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">2</div>
                <div class="oo-step-text"><strong>Get your API key</strong> Go to <a href="https://hunter.io/api-keys" target="_blank">hunter.io/api-keys</a> and copy your key.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">3</div>
                <div class="oo-step-text"><strong>Paste it here</strong> Go to <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Settings</a> and paste it into the Hunter.io field.</div>
            </div>
        </div>
    </div>

    <div class="oo-card">
        <h2 class="oo-card-title">Email Sending</h2>
        <p class="oo-muted" style="margin-bottom:16px;font-size:13px">Delivers your outreach emails. October Outreach supports four options — pick whichever you already have, or we recommend Amazon SES for the best value.</p>

        <div class="oo-help-service">
            <div class="oo-service-icon" style="background:#fafff4">📤</div>
            <div class="oo-service-info">
                <h3>Which one should I choose?</h3>
                <p><strong>Amazon SES</strong> — cheapest at $0.10 per 1,000 emails. Best if you're sending at volume.<br>
                <strong>Mailgun</strong> — easy setup, good deliverability, free up to 100 emails/day.<br>
                <strong>SendGrid</strong> — well known, free up to 100/day.<br>
                <strong>SMTP</strong> — use whatever your host already provides.</p>
            </div>
        </div>

        <div style="margin-top:8px">
            <a href="https://aws.amazon.com/ses/" target="_blank" class="oo-btn oo-btn-secondary oo-btn-sm" style="margin-right:6px">Amazon SES →</a>
            <a href="https://www.mailgun.com" target="_blank" class="oo-btn oo-btn-secondary oo-btn-sm" style="margin-right:6px">Mailgun →</a>
            <a href="https://sendgrid.com" target="_blank" class="oo-btn oo-btn-secondary oo-btn-sm">SendGrid →</a>
        </div>
    </div>

    <div class="oo-card">
        <h2 class="oo-card-title">Airtable</h2>
        <p class="oo-muted" style="margin-bottom:16px;font-size:13px">Keeps a live copy of your contacts in Airtable so you can view, filter, and edit them in a spreadsheet-style interface outside WordPress.</p>

        <div class="oo-help-service">
            <div class="oo-service-icon" style="background:#f0fff4">📋</div>
            <div class="oo-service-info">
                <h3>What you need</h3>
                <p>A free Airtable account, one "base" (their word for a database), and a Personal Access Token.</p>
                <span class="oo-cost-tag">Free plan available</span>
            </div>
        </div>

        <div style="margin-top:12px">
            <p style="font-size:13px;font-weight:600;margin:0 0 8px">How to set up:</p>
            <div class="oo-help-step">
                <div class="oo-step-num">1</div>
                <div class="oo-step-text"><strong>Create an account</strong> Go to <a href="https://airtable.com" target="_blank">airtable.com</a> and sign up for free.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">2</div>
                <div class="oo-step-text"><strong>Create a base</strong> Click "Add a base" and call it something like "Outreach Contacts". The plugin will create the right columns automatically.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">3</div>
                <div class="oo-step-text"><strong>Get your token</strong> Go to <a href="https://airtable.com/account" target="_blank">airtable.com/account</a> → Developer hub → Personal access tokens → Create token. Give it <strong>data.records:read</strong> and <strong>data.records:write</strong> and <strong>schema.bases:read</strong> scopes.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">4</div>
                <div class="oo-step-text"><strong>Find your Base ID</strong> Open your base in Airtable. The URL looks like: airtable.com/<strong>appXXXXXX</strong>/... — copy that <code>appXXXXXX</code> part.</div>
            </div>
            <div class="oo-help-step">
                <div class="oo-step-num">5</div>
                <div class="oo-step-text"><strong>Paste both here</strong> Go to <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Settings</a> and enter your token and Base ID.</div>
            </div>
        </div>
    </div>

</div>

<!-- FAQ -->
<div class="oo-card" style="margin-bottom:24px">
    <h2 class="oo-card-title">Common Questions</h2>

    <div class="oo-faq-item">
        <p class="oo-faq-q">Do I need all four services to use October Outreach?</p>
        <p class="oo-faq-a">Claude AI is required for everything. Hunter.io is needed to find contacts automatically (you can still add contacts manually without it). An email sending service is required to send campaigns. Airtable is optional — it just gives you a nicer way to view your contacts outside WordPress.</p>
    </div>

    <div class="oo-faq-item">
        <p class="oo-faq-q">Will setting this up affect the rest of my website?</p>
        <p class="oo-faq-a">No. October Outreach runs entirely within WordPress admin and doesn't touch your website's front end. Your visitors won't see or be affected by anything you do here.</p>
    </div>

    <div class="oo-faq-item">
        <p class="oo-faq-q">What email address do my outreach emails come from?</p>
        <p class="oo-faq-a">You set this per campaign in the wizard. We strongly recommend using a separate sending domain (e.g. outreach.yourdomain.com) rather than your main domain. This protects your main email reputation if any outreach emails are marked as spam. You set up the sending domain with whichever email service you choose. All replies still come to your real email via the Reply-To setting.</p>
    </div>

    <div class="oo-faq-item">
        <p class="oo-faq-q">How much will I spend on AI and email credits?</p>
        <p class="oo-faq-a">For a typical campaign of 100 contacts with a 3-email sequence: Claude AI costs roughly £0.50–£2 to research and write the emails. Sending 300 emails costs less than $0.05 on Amazon SES, or uses around 3 days of Mailgun's free allowance. Hunter.io costs depend on how many domains you search — the free plan covers small campaigns.</p>
    </div>

    <div class="oo-faq-item">
        <p class="oo-faq-q">Something isn't working — tasks seem to stop halfway through.</p>
        <p class="oo-faq-a">This is usually a hosting timeout. Your web host may be set to stop tasks after 30–60 seconds, and some AI and contact-search tasks take longer. Go to <a href="<?php echo esc_url( admin_url( 'admin.php?page=oo-settings' ) ); ?>">Settings</a> — if there's a warning at the top, it includes an email you can forward to your developer or host to fix it.</p>
    </div>

</div>

<!-- Support -->
<div class="oo-card">
    <h2 class="oo-card-title">Get Support</h2>
    <p class="oo-muted" style="margin-bottom:16px;font-size:13px">October Outreach is built and maintained by <strong>October Comms</strong>. If you're stuck on something the guides above don't cover, get in touch.</p>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <a href="mailto:hello@octobercomms.com?subject=October+Outreach+Support" class="oo-btn oo-btn-primary">Email Support</a>
        <a href="https://octobercomms.com" target="_blank" class="oo-btn oo-btn-secondary">octobercomms.com</a>
        <span class="oo-muted" style="font-size:13px">We aim to reply within one working day.</span>
    </div>
</div>
