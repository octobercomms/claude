# Section 6 — Qualification "quiz" logic

## Key finding: this is NOT a static branching quiz
The "quiz" reached via `Book a free consultation` → `?step=quiz` is a **live AI chat widget**
("AI Assistant"), not a fixed set of question/outcome panels. It posts to a custom WordPress
REST route already on the site:

    POST https://nvelope.co/wp-json/ocf/v1/chat

`ocf` = custom namespace (likely "October Comms Funnel" or similar) — this route is almost
certainly implemented by a snippet/mu-plugin already on the site. **Follow up in Section 8**
(Code Snippets / mu-plugins / WPCode) to find and export the PHP behind this route — that is
the actual "quiz logic" to port into the new plugin, not a decision tree.

Because responses are LLM-generated, the exact wording will vary run to run. What's structurally
consistent (confirmed by walking one path below):

## Structure observed
1. **Entry** — `?step=pre-quiz`: 3-way static choice card (not the chat): "Planning a project" /
   "Researching" / "Not sure".
   - "Planning a project" → routes to `?step=quiz` (the AI chat, documented below)
   - "Researching" → routes to `?step=not-ready` (static outcome panel, confirmed — see below)
   - "Not sure" → also routes to `?step=not-ready` (same outcome as Researching, confirmed)
2. **Q1 (chip choice)** — "What best describes where you are right now?"
   Chips: House Extension / House Renovation / New Build House / Apartment Refurbishment
   (plus free-text input always available instead of chips)
3. **Q2 (chip choice)** — "What's the current status of the property?"
   Chips: "I already own the property" / "I'm in the process of buying" / "I haven't secured a
   property yet"
4. **Q3 (free text)** — "Tell me about your project — what are you hoping to achieve?"
   (model extracts scope/budget/timeline from free text — confirmed it picked up "£150k" and
   "6 months" from a single free-text answer without asking separately)
5. **Q4 (free text / attach)** — asks for plans/drawings/photos, offers "Attach file" control or
   typed "skip"
6. **Lead capture begins** — "Could I get your full name?" (stopped here deliberately — did not
   submit a fake name/email into the live chat since that starts writing a real-looking lead
   into whatever CRM/Brevo automation is wired to this endpoint; confirm with Daniel before any
   further live testing of this specific flow)

## Sample transcript captured (House Extension / own property / £150k / 6mo / no drawings)
    AI: Hi there! Welcome — I'd love to learn a bit about your project so we can help out.
        To start, what best describes where you are right now?
        [House Extension] [House Renovation] [New Build House] [Apartment Refurbishment]
    User: House Extension
    AI: Great, a house extension — exciting! Now, what's the current status of the property?
        [I already own the property] [I'm in the process of buying] [I haven't secured a property yet]
    User: I already own the property
    AI: Perfect, that helps. Could you tell me a bit about your project — what are you hoping
        to achieve with the extension?
    User: We want to extend the kitchen and add a loft conversion, budget around £150k,
        hoping to start in 6 months
    AI: That sounds like a fantastic project! Kitchen extension plus a loft conversion —
        lovely combo. I've noted your budget and timeline too. Do you have any plans,
        drawings, or photos you could share a link to?
    User: No drawings yet, just early ideas
    AI: No worries, that's totally fine at this early stage! Would you like to upload any
        inspiration photos or files, or shall we skip that for now?
    User: skip
    AI: No problem, we can skip that. Could I get your full name?
    [chat stopped here — see note above]

## Outcome panel: `?step=not-ready` (confirmed — Researching and Not sure both land here)
Heading: "A good starting point"
Body:
> Thanks for sharing a few details about your project.
>
> From what you've told us, this looks like the right kind of project, but it's a little early
> for a useful conversation.
>
> The most helpful next step is to get clearer on costs, planning constraints, and what's
> involved before appointing an architect. That way, when you do speak to a studio, the
> conversation is focused and productive.

CTA: "Explore our Advice Hub" → `/learn/nvelope/`

Note: this same static panel text appears regardless of whether the visitor picked
"Researching" or "Not sure" at pre-quiz — it isn't personalised, despite reading like it might
reference specifics (it doesn't; no project details are collected on this path since it never
reaches the chat).

## Open items still to chase
- [ ] Find the `ocf/v1/chat` handler in Section 8 (Code Snippets/WPCode/mu-plugins) — this is
      where the actual system prompt / qualification logic / "serious buyer" scoring lives.
- [ ] Confirm with Daniel whether to complete a full run (incl. name/email/phone) to see the
      final outcome panel, ideally on a route that does NOT fire real CRM/Brevo automations
      (e.g. ask him to point it at a sandbox list, or accept a fabricated-but-obviously-test
      lead if that's fine operationally).
- [ ] The static pre-quiz 3-way choice ("Planning a project"/"Researching"/"Not sure") — only
      "Planning a project" was tested (routes into the AI chat). Need to confirm what
      "Researching" and "Not sure" do (may route straight to Advice Hub instead of the chat).
