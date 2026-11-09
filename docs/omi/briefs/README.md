# Briefs

A brief is what was **agreed** before a build started. A plan is how the build
intends to get there. They are different documents with different authority,
and they are kept apart here because conflating them has already cost this
project a week of work.

## The rule

1. **A brief outranks a plan.** Where an implementation plan in `docs/omi/`
   departs from the brief it serves, the plan is wrong until Daniel says
   otherwise.
2. **A departure is written down.** A plan that knowingly diverges says so, in
   the plan, naming the brief and the reason, and carries sign off. Silently
   superseding a brief is the failure this folder exists to stop.
3. **An agreed decision has to land here as a file.** A conversation, a chat
   message or a claude.ai artifact link is invisible to every session after
   the one that heard it. Each session starts with no memory; what it reads is
   the repository plus the message in front of it. A link is neither.
4. **A brief names its source.** Artifact URL, conversation date, whatever it
   was. The file is the copy sessions read; the source is where it came from.

## Why

`produce-studio.md` is the worked example. The studio layout was agreed and
mocked, then production shipped six co-equal nav rows instead. Nobody
overruled it. The mockup existed only as an artifact link, so the one session
that had read it extracted the three data-model fields it needed, wrote those
into `video-batch-plan.md`, and left the IA behind. From then on the plan was
the brief, and the plan said nothing about consolidation. Four sessions built
against it.

The same mechanism is why `CLAUDE.md` points at `agent-guide.md`: a wrong line
in that file survived six sessions unnoticed, because nothing loaded it and
nothing tested it.

## Current briefs

| File | Covers | Status |
|---|---|---|
| `produce-studio.md` | Produce → Studio, the four-panel editor and the consolidation | Partly built. Nav done 9 November; chrome steps 2 to 7 open; decisions 3 and 6 to 9 need Daniel |
