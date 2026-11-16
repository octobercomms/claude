# AI and client data: the position, and the document that goes to clients

Written 16 November 2026, from Anna Scott-Mearns' question in the Caro call and
Daniel's instruction that it be a promotional asset rather than a token note.
Serves **October and Caro equally**; the client-facing text is written once with
the agency name as a variable.

**Sources.** Anthropic's Commercial Terms of Service, their privacy policy, and
the Anthropic Privacy Center (58 articles, compiled 16 November 2026). That
compilation says of itself: *"This is a working reference, not the source of
record… Where a point matters contractually, check the linked article and the
underlying policy."* Treated accordingly below: the **Commercial Terms and the
DPA are what bind**, the Privacy Center is how the operational detail is
described.

---

## Part one: why this is worth doing properly

Anna's question was the standard one clients are starting to ask:

> "In their contract they want really clear parameters around our use of AI to
> protect their sensitive information. Is it drawn from an open model?"

Most agencies answer in one of two ways. They use AI and say nothing, hoping it
does not come up. Or they ban it and say nothing, which is increasingly a lie
told by firms whose staff use it anyway on personal accounts, which is the
genuinely dangerous version because nobody knows where the data went.

**A third answer is available and almost nobody is giving it:** here is which
parts of your work touch a model, which never do, where the data physically
sits, how long it is kept, what the provider is contractually prohibited from
doing with it, which standards they are audited against, and a switch that
turns it off for you specifically.

Carolyn in the same call: *"we should be the people that are ahead of the
game."* Anna, finishing Daniel's sentence about putting it in proposals:
*"experts."*

**Three commercial effects:**

1. **It answers a procurement question before it is asked.** Any client with a
   legal team will ask. Having the document ready turns a stall into a
   credential.
2. **It costs nothing to maintain.** The facts are contractual, not technical,
   so the document does not rot the way a tool list does. One annual re-read.
3. **It makes the AI use defensible rather than hidden**, which is the position
   an agency wants to be in when a client's own board asks them.

The rule that makes it credible: **everything in it must be true and
checkable.** A policy that overclaims is worse than none, because the first
client who checks finds the gap.

---

## Part two: the facts, sourced

### Training

**Commercial Terms of Service, Section B:**

> "Anthropic may not train models on Customer Content from Services."

"Customer Content" covers both Inputs and Outputs. The Privacy Center says the
same operationally: commercial products including the API *"do not use inputs or
outputs for training by default"*, and *"API data is not used for training
unless the customer's agreement says otherwise."*

**The three ways that default could be broken**, all of which require the
customer to act, and none of which we do:

- Joining Anthropic's **Development Partner Program**.
- **Explicitly opting in** in organisation settings.
- **Submitting feedback** — a thumbs up or down on a response allows the
  related session to be used for training.

That third one is the operationally important one, and it is a product rule for
OMI rather than a policy line: **do not build a feedback mechanism that sends
ratings to Anthropic.** OMI calls the API directly and has no such control
today, which is why the claim is currently true, and it needs to stay that way
deliberately rather than by accident.

### Ownership

Commercial Terms, Section B: the customer *"retains all rights to its Inputs,
and… owns its Outputs"*, with Anthropic assigning its right, title and interest
in Outputs to the customer.

### Who is controller, who is processor

Privacy Center, on commercial products including the API:

> "the customer organisation is the data controller for its users' data"

and

> "Anthropic acts as processor, handling data only as instructed in order to
> provide the service."

**This is the sentence a GDPR-literate client is looking for.** The agency is
the controller; Anthropic is the processor acting on instruction.

### The DPA, and lawful transfer

> "The DPA, including Standard Contractual Clauses, is built into the
> Commercial Terms of Service. Accepting the Commercial Terms means accepting
> the DPA. No separate signing step is described."

Standard Contractual Clauses are the mechanism UK and EU transfers rely on. It
is already in place rather than something to negotiate.

### Where the data physically is

This needs saying plainly to a UK client rather than being buried:

- **"Data is stored in the US."**
- Customer traffic may route by default to selected countries in the US, Europe,
  Asia and Australia unless otherwise agreed or configured.
- Traffic routing location is **selectable** on the Developer Platform,
  including a **US-only inference option**.

### How long it is kept

- **API inputs and outputs are deleted from backend systems within 30 days.**
  Exceptions: customer-controlled longer retention, separate agreements, or
  legal requirements.
- Content flagged for Usage Policy violations may be kept **up to two years**,
  with related safety scores up to **seven years**.

**Correction to an earlier draft of this document.** I had written that content
is "deleted on request", reading across from the confidentiality clause in the
Commercial Terms. The Privacy Center is explicit and more specific:

> "Ad hoc deletion is not available for paid API customers. Specific data sent
> through the API cannot be removed on demand."

So the mechanism is **automatic deletion within 30 days**, not deletion on
demand. The client document below says that, because promising on-demand
deletion would have been a promise we could not keep.

### Zero data retention

Available to some Claude Platform (API) customers, **subject to Anthropic
approval**, and requested per organisation through sales. Under it, inputs and
outputs are kept only where needed for legal compliance or to address misuse.
Safety classifier results are still retained.

Not needed for any claim below. Worth knowing it exists if a client's
requirements are unusually strict.

### Audited standards

- **ISO/IEC 42001:2023** — AI management systems.
- **ISO 27001:2022** — information security management.
- **SOC 2** Type I and Type II.
- HIPAA-ready configuration with a BAA available.

ISO 42001 is worth naming specifically. It is an AI-management standard, and
citing it shows the agency knows the difference between a general security
badge and one about AI governance.

### The second model, and the honest asymmetry

OMI can route cheap, non-sensitive tasks to DeepSeek. The platform's own code
says why that is bounded:

> `'DeepSeek': Data is sent to DeepSeek — avoid for client data.`

**DeepSeek's own terms could not be reached from this session**, and a
client-facing document must not carry an unsourced claim about a third party. So
the policy below says nothing about DeepSeek's terms. It states **our own rule**,
which is checkable in the product and is the stronger statement anyway: no
client information reaches any model other than Claude, and a client can require
Claude-only or switch AI off entirely.

---

## Part three: the client-facing document

Plain English. `[Agency]` is October Communications or Caro Communications.

---

### How [Agency] uses AI with your information

**The short version.** We use AI to do specific, named jobs faster: drafting,
summarising and analysing. It never sends anything in your name, it never
decides anything about your account, and the company behind it is contractually
prohibited from training its models on your information.

**What AI actually does**

| Where we use it | What it does |
|---|---|
| Report writing | Reads the month's figures and coverage, drafts the narrative. A person edits it before you see it. |
| Coverage analysis | Reads an article and extracts publication, journalist, date and tone. |
| Press release and pitch drafting | Produces a first draft from a brief we write. |
| Media research | Finds journalists who cover your sector, and checks whether the contacts we hold are still writing and where. |
| Social copy | Drafts captions from a brief. |

**What it never does**

- It never sends. Every email, pitch and post is approved by a person first.
- It never decides strategy, budget, or who we approach.
- It is not a chatbot with access to your files. It is given the specific
  information a specific task needs.

**Where your information goes**

Anything touching your account runs on **Claude, made by Anthropic**, under
their Commercial Terms of Service. Under those terms and their published
policies:

- **Anthropic may not train their models on your information.** That is the
  contractual wording, and it covers both what we send and what comes back. It
  is not a setting we chose and could quietly change.
- **You own the output.** Rights in what the model produces are assigned to the
  customer.
- **We are the data controller; Anthropic is the processor**, handling the
  information only as instructed in order to provide the service.
- **A Data Processing Addendum, including Standard Contractual Clauses, is built
  into those terms** — the mechanism UK and EU data transfers rely on.
- **Information sent through the interface is deleted within 30 days.** Content
  flagged for a policy violation can be held longer.
- **Data is stored in the United States.** We can restrict processing to the US
  specifically if that suits your requirements better.

Anthropic is independently audited against **ISO/IEC 42001** for AI management
and **ISO 27001** for information security, and holds SOC 2 Type I and Type II
reports.

This is materially different from the consumer AI products that appear in the
press. Anthropic's own privacy policy states it does not apply to content
processed for business customers; that content is governed by the commercial
agreement above.

**One thing we will not pretend**

Once information has been sent for a task, we cannot pull that individual item
back on demand. It is deleted automatically within 30 days. If something must
never be sent at all, tell us and it will not be.

**A cheaper model, and the rule we apply to it**

For a small number of tasks containing no information about you, we sometimes
use a cheaper model from another provider — drafting generic social copy from a
brief we wrote ourselves, for instance.

**No information about you, your business or your coverage is sent to any model
other than Claude.** If you would prefer Claude for everything regardless, say
so and we will set it for your account.

**If you would rather we used no AI at all**

We can switch it off for your account entirely. Your work is then done as it was
before, and we will tell you honestly what that means for turnaround on reports
and drafts.

**Who to ask**

[Contact]. We would rather have this conversation at the start than after
something goes wrong.

---

## Part four: what the product must do to make this true

Four promises. Two are already true, two are not.

| Promise | State |
|---|---|
| Named tasks use AI, others do not | **True.** `services/aiModels.js` holds a per-feature routing map covering every AI feature. |
| No training, no feedback opt-in | **True by default, and must stay deliberate.** OMI sends no ratings to Anthropic. Do not add a thumbs up/down that does. |
| Sensitive tasks never reach the non-Claude model | **Flagged, not enforced.** Every feature carries `sensitive: true` or `false` — report narratives, executive summaries, strategist briefings, strategy tailoring and client briefing research are all sensitive. The flag warns where it should refuse. |
| A client can require Claude-only, or no AI | **Not built.** Daniel named it in the call: *"a way to restrict a particular client if they don't want, so to turn off AI features on a client."* |

**The work:** a per-client AI mode with three values — normal, Claude-only, off
— read wherever an AI feature runs, and a hard refusal rather than a warning
when a sensitive feature resolves to a non-Claude provider.

**A guard, in the house style:** a test that every feature in the routing map
carries a sensitivity flag, and that no feature flagged sensitive can resolve to
a non-Claude provider. The policy then cannot drift from the code without
something going red.

---

## Part five: how to use it

**For October.** Attach it to proposals. The proposal engine already assembles
documents, so a standing section is cheap. It answers a question prospects are
beginning to ask and most competitors cannot.

**For Caro.** Anna's framing was contractual, and that is the floor. Carolyn's
is the ceiling: being the agency ahead of this rather than reacting to it. The
same document supports a pitch credential, a point of view in the trade press,
and a straight answer when a client's board asks what their agency is doing with
AI.

**What to re-check, and when.** Three facts have external dependencies:
Anthropic's commercial terms, their published retention and routing practice,
and the second model's terms. Re-read annually and whenever a provider announces
a change. If a claim here stops being true, the document changes that week,
because the entire value of it is that it is checkable.
