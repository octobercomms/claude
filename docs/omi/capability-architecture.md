# Capability architecture — tools that work alone and together

_Status: proposal, awaiting sign-off. No code written._

## The problem, in Daniel's words

> "I often don't use OMI tools when it's specific about the process. It forces
> me to use it one way and not the use case I suddenly have that this tool
> could do."

> "Sometimes the obvious next step isn't plumbed in, so I have to manually
> connect the steps."

And the consequence that makes both fatal rather than annoying:

> "The tools we have only do some of the job. So I end up not using any of it."

A tool that does 70% of a job gets used zero times, because you finish in the
other tool anyway, and once you are there you may as well have started there.
Partial tools have no value, not partial value. **The metric for this
architecture is whether a thing gets opened, not whether it works.**

## The cause

OMI ships workflows. A workflow assumes an order. When the situation is not the
one it assumed, there is no way in and no way out, so the user leaves.

The two complaints are one cause seen from both ends. A rail you cannot get on
in the middle is complaint one. A rail that stops short of the next thing is
complaint two.

## The proof case already in the codebase

This is not hypothetical. Two shipped features do the same work:

| | Edit Studio | Video Studio |
|---|---|---|
| Trim | Yes, a tick box you choose | Yes, inside roughcut |
| Clean audio | Yes, standalone | No |
| Captions | Yes, burned + `.srt` | Yes, brand-styled ASS |
| Grade loop | No | Yes |
| Shape | À la carte, you pick | One unattended pipeline |

`video-autoedit-plan.md` states the design intent plainly: *"one auto-task, not
a step-by-step wizard... never a click between stages."* That was a reasonable
call at the time. It is also exactly the rail Daniel now bounces off.

The two cannot compose. A Video Studio master cannot go into Edit Studio for a
trim. Edit Studio's audio clean cannot run as a stage of the auto pipeline.
Same work, twice, in two shapes, neither of which fits every job.

Unifying these is the first target. It is deduplication, not greenfield, which
makes it cheap to justify and easy to judge.

## The model

Stop shipping workflows. Ship capabilities.

**A capability does one job, takes a typed input, returns a typed output, and
is callable on its own.** It does not know what ran before it or what runs
next.

Four rules:

**1. Artefacts, not screens.** The stored unit is a thing, not a page: a
transcript, a select list, an audience, a release, a rendered variant. Every
artefact is saved, addressable and reusable. Screens become views onto
artefacts rather than containers for them.

**2. Every capability declares what it eats and what it produces.** This single
piece of metadata is what makes everything else work.

**3. Next steps are offered, never forced.** When a capability finishes, OMI
lists every capability that accepts the artefact you now hold. One click to
continue, or stop and take it elsewhere. This fixes the missing joins without
rebuilding a rail.

**4. Every capability opens cold.** You can start at "clean this audio" with an
upload, without having come through anything first. This fixes the forced
process.

The fifth point is the one that matters most. **The agent gets the same
registry the UI does.** Once capabilities are typed and callable, the agent
composes them for a job nobody designed a screen for. Describe the odd case you
have today, it chains four capabilities, done. We stop needing to have
anticipated you.

Which is the same shape as the external tools decision: internally and
externally, everything becomes a typed tool.

## Reconciling this with Process Rails

`process-rails-plan.md` (July 2026) answered the opposite complaint: *"what
isn't clear to me is the action to take... I'm so overwhelmed."* The response
was ordered steps with derived status and a "do this next" highlight.

That is not in conflict, and it should not be torn out. Process Rails is a
**navigation and status layer** that reads real data and suggests. Suggestion is
rule 3. The failure mode is when a suggested order becomes the only order, or
when a step has no cold entry point. Rails stay; they gain a way in at every
step and a way out at every step.

Worth checking with Daniel which specific screens feel forced, because the rails
themselves may not be the culprit.

## Testability — the strongest argument for this

A workflow is hard to test because the unit under test is a journey. A
capability is a function, so it is testable in five ways a workflow is not.

**1. Unit: artefact in, artefact out.** A fixture input, an assertion on the
output. No UI, no session, no ordering. Every capability gets this on the day
it is written.

**2. Contract: the registry checks itself.** One test walks the registry and
asserts every declared input and output type exists in the type set, and that
every capability's output is consumable by at least one other capability or is
a terminal deliverable. A typo in a type is caught at CI, not at runtime.

**3. Composition: assert the handoff.** Chain two capabilities against a golden
fixture and assert the second accepts what the first produced. Cheap, and it is
the exact failure Daniel hits manually today.

**4. Golden fixtures per artefact type.** One known-good example of each
artefact, held in the repo. Any capability that claims to accept that type must
accept the fixture. This is what stops types drifting.

**5. Usage, which is the real acceptance test.** Log every capability
invocation. A capability nobody calls in a month is either badly placed, badly
named, or should not exist. The architecture exists to raise usage, so usage is
what we measure it against.

## What this is not

Not a rewrite. Arguing against a rewrite explicitly.

1. A capability registry and an artefacts table alongside what exists.
2. Register existing functions as capabilities when we happen to be touching
   them. Retrofit slowly, never as a project of its own.
3. Anything new registers from day one.

## Risks

**Bureaucracy.** If registering a capability costs more than roughly ten lines,
every future build slows down and the thing gets routed around. Keep
registration to a declaration, not a framework. If it grows a base class, it has
gone wrong.

**Type drift.** If "transcript" comes to mean three different things,
composition breaks and we are worse off than today. Start with a small closed
set, six to eight types, and hold it. Adding a type should need a reason.

**Half-migration.** A registry covering four capabilities out of forty is worse
than none, because the next-step suggestions will be wrong by omission. Either
the video cluster is fully converted or the suggestion UI stays off until it is.

## First slice

The six video capabilities, replacing the Edit Studio and Video Studio
duplication:

`trim` · `clean-audio` · `caption` · `roughcut` · `grade` · `export`

Each callable alone, each chainable, each with a unit test and a fixture. The
existing auto-edit pipeline becomes a saved chain of the same six rather than a
separate implementation. Edit Studio becomes the à la carte view of the same
six.

If the registry proves to be a nuisance, nothing is lost: the six capabilities
still work standalone, and the duplication is still gone.

## Decided: both tracks, one implementation

Daniel: *"Auto edit as one button could be useful. But then the ability to
edit manually. This allows both tracks."*

This is what the model gives for free, and it is the reason to prefer it over
picking a side:

- **One button** is a saved chain: `roughcut → caption → grade → export`, run
  unattended with the progress strip, exactly as the auto-edit does today.
- **Manual** is the same six capabilities offered individually, exactly as Edit
  Studio does today.

Same code, two entry points. Neither is a reimplementation of the other, which
is the failure the current pair represents. A third track falls out without
extra work: run the chain, then open the result in a single capability to fix
the one thing that is wrong, rather than re-running the whole pipeline or
giving up and opening Premiere.

## Licence audit (2026-09-26)

Run because Daniel offered to strip anything with a licence problem. **Nothing
needs stripping.** Recorded so it is not re-litigated.

Every installed package under `dev/platform/backend`, 660 in total:

| Licence | Count |
|---|---|
| MIT | 504 |
| Apache-2.0 | 53 |
| ISC | 35 |
| BSD-2-Clause / BSD-3-Clause | 41 |
| MPL-2.0 | 4 |
| Other permissive (0BSD, MIT-0, Unlicense, BlueOak) | 6 |

No AGPL. No GPL-only. No vendored copyleft source. `jszip` reads
`(MIT OR GPL-3.0-or-later)`, which is a choice, and we take MIT.

The discipline recorded in `video-pipeline-learnings.md` held: OpenMontage
(AGPLv3) was learned from as a design reference and its code was never brought
into `dev/platform`. Keep that rule.

**One conditional item: Remotion.** `remotion`, `@remotion/bundler` and
`@remotion/renderer` are production dependencies of the backend, driving
`remotionRender.js`. Remotion is not open source in the usual sense. Its
licence (verified against the text in the remotion-dev repository, not from
memory) grants free use to:

> "an individual", "a for-profit organization with up to 3 employees", "a
> non-profit or not-for-profit organization", or someone "evaluating whether
> Remotion is a good fit, and are not yet using it in a commercial way"

Everyone else needs a Company Licence. Published rates: Creators at $25 per
month per person writing Remotion code, including via an agent; Automators at
$0.01 per render with a $100 monthly minimum, which is the tier automated
rendering falls into.

This is a bill, not a violation, and it is not a reason to strip Remotion:
nothing comparable is both headless and React-based, and removing it would cost
far more than the licence. **Action: confirm October's headcount against the
three-employee threshold.** Under it, nothing to do. Over it, the automated
pipeline puts October on Automators at $100 a month minimum.

`dev/video` is a stray untouched Remotion starter template unrelated to the
platform's video stack. Delete it, so nobody mistakes it for the real thing
again, as this session did.

## Open questions for Daniel

1. Which screens specifically feel forced? Process Rails may not be the cause.
2. ~~One button or a chain?~~ Answered above: both, from one implementation.
3. Six types to start. Which artefacts matter most beyond video: audience,
   release, transcript, brief?
