# October Proposals

In-house WordPress plugin for octobercomms.com that generates October's client proposals as
an on-brand **web page** (video + animated process + accept/e-sign/pay) and a matching
**downloadable PDF**, from a single source — built with a Hillcroft-style **wizard**.

Code lives in `dev/oc-proposals/` (not yet started). Docs:

- **[PROPOSAL-AUDIT.md](PROPOSAL-AUDIT.md)** — audit of the current October proposal template
  (SG/D, Studio Seilern, IndieWalls) and the target proposal shape the plugin produces.
- **[PLUGIN-SCOPE.md](PLUGIN-SCOPE.md)** — full plugin scope: architecture, wizard, pricing
  page, web page, PDF, phases. (Open decisions in §9 are now resolved — see DECISIONS.md.)
- **[DECISIONS.md](DECISIONS.md)** — round-2 decisions + answers: client branding (no logos),
  landscape A4/Letter, mPDF confidence, GoCardless vs Stripe, the Claude pricing agent, the
  public "create your own proposal" builder, native CRM (from the Sales Leads Tracker), and
  subscription pause.
- **[mockups/pricing-table.html](mockups/pricing-table.html)** — clearer pricing-table concept
  (Plan-of-Work rail + two buckets + ROI anchor + pause note). Open in a browser; prints A4
  landscape.

**Status:** Scope agreed; decisions locked — ready to scaffold the plugin. No code yet.
