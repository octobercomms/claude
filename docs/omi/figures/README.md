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
cp -r docs/omi/figures/false-zero anatomy/examples/
cd anatomy
node examples/false-zero/build.mjs            # dark
node examples/false-zero/build.mjs --light    # light
```

The output is a standalone HTML page with the kit inlined: no build step, no
dependencies, open it in a browser. Copy both pages back here when they change.

Verify before committing, with `CHROME_PATH` pointing at a Chromium binary
(`/opt/pw-browsers/chromium` in a cloud session):

```sh
node scripts/lines.mjs examples/false-zero/false-zero.html        # must print "line ends: 0"
node scripts/lines.mjs examples/false-zero/false-zero-light.html  # and in light too
node scripts/capture.mjs examples/false-zero/false-zero.html --out shot.png --reduced
```

**Read the PNG.** The line check does not see composition, and two faults in
the first figure were only visible by looking: see below.

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
