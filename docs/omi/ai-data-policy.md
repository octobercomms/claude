# AI and client data: the position, and the document that goes to clients

Written 16 November 2026, from Anna Scott-Mearns' question in the Caro call and
Daniel's instruction that it be a promotional asset rather than a token note.
Serves **October and Caro equally**; the client-facing text below is written
once with the agency name as a variable.

---

## Part one: why this is worth doing properly

Anna's question was the standard one clients are starting to ask:

> "In their contract they want really clear parameters around our use of AI to
> protect their sensitive information. Is it drawn from an open model?"

Most agencies answer this in one of two ways. They use AI and say nothing,
hoping it does not come up. Or they ban it outright and say nothing, which is
increasingly a lie told by people whose staff use it anyway on personal
accounts, which is the genuinely dangerous version.

**A third answer is available and almost nobody is giving it:** here is exactly
which parts of your work touch a model, which never do, where the data goes,
what the provider is contractually prohibited from doing with it, and a switch
that turns the whole thing off for you specifically.

Carolyn in the same call: *"we should be the people that are ahead of the
game."* Anna, finishing Daniel's sentence about putting it in proposals:
*"experts."*

**Commercially this does three things:**

1. **It answers a procurement question before it is asked.** Larger clients and
   anyone with a legal team will ask. Having the document ready converts a
   stall into a credential.
2. **It is a differentiator that costs nothing to maintain.** The underlying
   facts are contractual, not technical, so the document does not rot the way a
   tool list does.
3. **It makes the AI use defensible rather than hidden.** An agency that can
   say "we use it here, not here, and here is why" is in a stronger position
   than one claiming not to use it at all.

The one rule that makes it credible: **everything in it has to be true and
checkable.** A policy that overclaims is worse than none, because the first
client who checks finds the gap.

---

## Part two: the facts, sourced

Checked against primary sources on 16 November 2026, not recalled.

### Claude (Anthropic), which is what does the work

**Anthropic's Commercial Terms of Service, Section B:**

> "Anthropic may not train models on Customer Content from Services."

"Customer Content" covers both **Inputs** (what is sent) and **Outputs** (what
comes back). This is a flat contractual prohibition in the commercial terms, not
a setting to be enabled and not a preference that can be quietly changed.

Also Section B, on ownership:

> Customer "retains all rights to its Inputs, and… owns its Outputs."

with Anthropic assigning "its right, title and interest" in Outputs to the
customer.

**Section E**, on confidentiality:

> "Customer Content is Customer's Confidential Information."

and under E.4 confidential information is destroyed "promptly upon request",
except where retention is required by law or sits in automated backups, which
remain subject to confidentiality.

**Anthropic's privacy policy** confirms the separation between consumer and
business products explicitly:

> "This Privacy Policy does not apply to content that we process on behalf of
> customers of our business offerings"

Business content is governed by the customer agreement, which is the commercial
terms quoted above. **This distinction is the one most people get wrong**, and
it is worth stating in the client document: the training behaviour people have
read about in the press concerns consumer chat products, not commercial API
use.

**Zero data retention** exists as an organisation-level configuration on the
Anthropic API for customers who need it. Worth knowing it is available; not
needed to make the claims above.

### The second model, and the honest asymmetry

OMI can route cheap, non-sensitive tasks to DeepSeek, a Chinese model, because
it costs a fraction of anything else. The platform's own code says so plainly:

> `'DeepSeek': Data is sent to DeepSeek — avoid for client data.`

**I could not verify DeepSeek's current terms in this session** (the host is not
reachable from here), and a client-facing document must not carry an unsourced
claim about a third party. So the policy below does not describe DeepSeek's
terms. It describes **our own rule about it**, which is checkable in the
product and is the stronger statement anyway:

- No client information is sent to any model other than Claude.
- The second model only ever sees tasks that contain no client data, such as
  drafting generic social copy from a brief the agency wrote.
- Any client can require Claude-only, and it is enforced in software rather
  than promised in an email.

That last line is the one that needs building. See Part four.

---

## Part three: the client-facing document

Plain English, one page. `[Agency]` is October Communications or Caro
Communications.

---

### How [Agency] uses AI with your information

**The short version.** We use AI to do specific, named jobs faster: drafting,
summarising and analysing. It never makes decisions about your account, nothing
goes out in your name without a person approving it, and the company behind the
AI we use is contractually prohibited from training its models on your
information.

**What AI actually touches**

| Where we use it | What it does |
|---|---|
| Report writing | Reads the month's figures and coverage and drafts the narrative. A person edits it before you see it. |
| Coverage analysis | Reads an article and extracts the publication, journalist, date and tone. |
| Press release and pitch drafting | Produces a first draft from a brief we write. |
| Media research | Finds journalists who cover your sector, and checks whether contacts we hold are still writing and where. |
| Social copy | Drafts captions from a brief. |

**What it never touches**

- It never sends anything. Every email, pitch and post is approved by a person.
- It never decides strategy, pricing or who to work with.
- It is not given your commercially sensitive material unless the work requires
  it, and where it is, that work runs only on Claude (below).

**Where your information goes**

The AI we use for anything touching your account is **Claude, made by
Anthropic**, a US company, accessed under their Commercial Terms of Service.
Under those terms:

- **Anthropic may not train their models on your information.** That is their
  contractual commitment, covering both what we send and what comes back. It is
  not a setting we chose and could change.
- **You own the output.** Rights in what the model produces are assigned to the
  customer.
- **Your content is treated as confidential** under the agreement, and is
  deleted on request.

This is materially different from the consumer AI products people read about.
Anthropic's own privacy policy says it does not apply to content processed for
business customers; that content is governed by the commercial agreement above.

**A cheaper model, and the rule we apply to it**

For a small number of tasks that contain no information about you, we sometimes
use a cheaper model from another provider. It is used for things like drafting
generic social copy from a brief we have written ourselves.

**No information about you, your business or your coverage is sent to any model
other than Claude.** If you would prefer we use Claude for everything
regardless, tell us and we will switch it on for your account specifically.

**If you would rather we used no AI at all**

We can turn it off for your account. Your work is then done exactly as it was
before, and we will tell you honestly what that means for turnaround on reports
and drafts.

**Who to ask**

[Contact]. We would rather have this conversation at the start than after
something goes wrong.

---

## Part four: what the product has to do to make this true

The document above makes four promises. Three are already true; one is not.

| Promise | State |
|---|---|
| Named tasks use AI, others do not | **True.** `services/aiModels.js` holds a per-feature routing map covering every AI feature in the product. |
| Sensitive tasks never go to the non-Claude model | **Flagged, not enforced.** Every feature carries `sensitive: true` or `false` — report narratives, executive summaries, strategist briefings, strategy tailoring and client briefing research are all sensitive. The flag warns; it should refuse. |
| A client can require Claude-only | **Not built.** Needs a per-client setting. |
| A client can have AI switched off entirely | **Not built.** Daniel named it in the call: *"a way to restrict a particular client if they don't want, so to turn off AI features on a client."* |

**The work:** a per-client AI mode with three values — normal, Claude-only, and
off — read at the point every AI feature runs, and a hard refusal rather than a
warning when a sensitive feature is pointed at a non-Claude model.

Small, and it is what turns the document from a description into something an
agency can sign under.

**Worth a guard**, in the house style: a test that every feature in the routing
map carries a sensitivity flag, and that no feature flagged sensitive can
resolve to a non-Claude provider. The policy then cannot drift away from the
code without something going red.

---

## Part five: how to use it

**For October.** Attach it to proposals. The proposal engine already builds
documents; a standing section is cheap. It answers a question prospects are
starting to ask and most competitors cannot.

**For Caro.** Anna's original framing was contractual, and that is the floor.
The ceiling is Carolyn's: being the agency that is ahead of this rather than
reacting to it. The same document supports a new business line, a point of view
in the trade press, and a credential on pitches.

**What to keep checking.** The two facts with external dependencies are
Anthropic's commercial terms and the second model's terms. Re-read both
annually, and whenever a provider changes. If a claim here stops being true, the
document changes that week, because the whole value is that it is checkable.
