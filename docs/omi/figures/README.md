# Figures

Explanatory illustrations for OMI, built with [`wheresryan22/anatomy`](https://github.com/wheresryan22/anatomy)
(MIT), an agent skill that draws a concept as a real machine.

## What this is good for, and what it is not

Read the limits before reaching for it, because the obvious use does not work.

**It is not a chart library.** Its own README says so. It draws machines,
instruments and furniture, so it will not visualise a client's numbers. Point
it at "£140,967 across 809 orders" and you get a drawing of a machine, not that
data. For performance visuals the answer is `recharts`, which is already in the
frontend.

**It runs at authoring time, not runtime.** It is a skill an agent invokes,
slowly and deliberately, which writes a standalone HTML file. Nothing in OMI
can call it per briefing, so it cannot illustrate a weekly briefing.

**Where it earns its place** is the explainers: the mechanisms the Strategist
keeps describing in prose and a client keeps not believing. Why a broken Pixel
poisons a benchmark. Why six stores under one AOV tells you nothing. Those are
mechanisms, and a mechanism is what this draws.

## Building one

The build script imports the anatomy kit, so it runs from a checkout of that
repo rather than from here:

```sh
git clone --depth 1 https://github.com/wheresryan22/anatomy.git
cp -r docs/omi/figures/<name> anatomy/examples/
cd anatomy
node examples/<name>/build.mjs            # dark
node examples/<name>/build.mjs --light    # light
```

The output is a standalone HTML page with the kit inlined: no build step, no
dependencies, open it in a browser. Copy both pages back here when they change.

Verify before committing, with `CHROME_PATH` pointing at a Chromium binary
(`/opt/pw-browsers/chromium` in a cloud session):

```sh
node scripts/lines.mjs examples/<name>/<name>.html        # must print "line ends: 0"
node scripts/lines.mjs examples/<name>/<name>-light.html  # and in light too
node scripts/capture.mjs examples/<name>/<name>.html --out shot.png --reduced
```

**Read the PNG.** The line check does not see composition, and the faults that
mattered most in both figures so far were only visible by looking: a gap that
read as contact, and two dials occluding each other. Capture both poses of
anything that moves, because a figure can be right at rest and wrong in use.

## `blended-average`

Six weights of different heights in six bored pockets, and two gauges on one
column. The upper one reads their average, the lower one the spread between
the heaviest and lightest. Redistribute the weights without changing the total
and **the average needle does not move by a hair** while the spread needle
swings across its whole scale.

It illustrates Falcon's six storefronts, consumer DTC and trade portal across
UK, US and EU, collapsing into one £174 average order value. Both poses are
the same arithmetic over the same sum; only one of them is a business you
would run the same way.

| In the drawing | In the account |
|---|---|
| Each weight's height | One storefront's average order value |
| The upper gauge | The £174 everyone quotes |
| The lower gauge | The range it is hiding |
| Same total, any shape | Why the quoted number cannot be acted on |

### Why two gauges

A single still needle reads as a broken instrument. The needle that moves is
what makes the still one damning, and it is the reason the figure has a second
dial rather than a caption asking you to take the stillness on trust.

Both poses sum to exactly 154, so the average is genuinely identical rather
than nearly. Every frame on the way between them is a blend of the two, so the
total holds across the whole sweep and not only at the ends.

### Three faults the PNG caught

- **Two dials side by side at different depths occlude each other.** The near
  one covered a third of the far one and the column rose between them.
  Stacking them on one column fixed the occlusion and gave the figure the
  height it needed against a wide base.
- **The column ran on past the top gauge with nothing on it.** A bare stretch
  is an empty corner, which the craft rules count as unfinished rather than
  calm.
- **The dial ticks floated.** They sat at `DIAL_R - 3.6` against a ring at
  `DIAL_R - 2.4`, so their outer ends stopped 1.2 units short of anything: the
  line check counted twelve. Ticks hang *from* the ring, and a gauge needle
  reaches its scale.

### A JavaScript trap worth remembering

The live script is assembled in a template literal, and inside `${...}` the
content is **expression context**, so template-literal escaping does not
apply. `replace(/k\\./g, "")` there is a regex matching a literal backslash,
strips nothing, and the page dies at runtime with `k is not defined`. It is
`replace(/k\./g, "")`.

## `false-zero`

A dial indicator whose probe is parked clear of the workpiece. The needle reads
zero, the block is still 18 units tall, and anyone who sets the bezel to that
reading has a datum that was never true.

It illustrates the thing the Falcon briefing spent four paragraphs on: a broken
Meta Pixel reports 0% paid conversion while the store takes 809 real orders, and
benchmarking against that zero poisons every future trend read.

| In the drawing | In the account |
|---|---|
| The block's height | Orders that are happening anyway |
| The air gap | The Pixel not firing |
| The needle at zero | "0% paid conversion rate" |
| The bezel's zero mark | The benchmark set against that reading |
| Closing the gap | Fixing the tracking, and the number appearing at once |

### Two faults worth remembering

Both were invisible to the checks and obvious in the PNG.

**In isometric, a floating object reads as resting on the surface behind it.**
At 1× the parked probe looked like it was touching, so a figure about a gap had
no visible gap. The first fix was a blurred contact shadow, which was wrong
twice over: the kit's halo is dark, so on a dark block in the dark theme it drew
nothing, and a blur is a trick rather than a part. The fix that worked is a
scribed witness ring on the work, the spot the probe is meant to land on. A real
feature, always there, and a probe hanging over a target it is not touching is
unmistakable.

**A moving group has to take everything that moves with it.** The clamp was
drawn with the fixed post, so at full travel the arm slid away from the thing
holding it up and the gauge sank into the block. It belongs to the head: you
slacken the clamp and the whole gauge slides down the post, which is the motion
the figure is about.
