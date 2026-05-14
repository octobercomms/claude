# HyperFrames Skill Overview

HyperFrames enables creation of video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions using HTML as the source of truth.

## Core Workflow

**Step 1: Design System**
Read `design.md` or `DESIGN.md` first if present—it contains brand colors, fonts, and constraints. If absent, either match a named visual style, use the design picker, or reference house-style defaults.

**Step 2: Prompt Expansion**
Ground the user's intent against design and style guides before composition authoring (see `references/prompt-expansion.md`).

**Step 3: Plan**
Define narrative arc, structure (scenes/tracks), rhythm patterns, timing, layout, then animation.

## Key Principles

**Layout Before Animation**
"Position every element where it should be at its most visible moment—the frame where it's fully entered, correctly placed, and not yet exiting." Build static CSS first, then add entrance/exit tweens using `gsap.from()` and `gsap.to()`.

**Scene Transitions (Non-Negotiable)**
Multi-scene compositions must:
1. Always use transitions between scenes
2. Always animate every element IN via entrance tweens
3. Never use exit animations except on the final scene
4. Let transitions handle scene exits

**No Exit Animations Before Transitions**
The outgoing scene must be fully visible when the transition starts.

## Technical Requirements

- Timelines start `{ paused: true }` and register to `window.__timelines`
- Use `data-*` attributes for timing, track indices, and composition metadata
- Muted video + separate `<audio>` elements for sound
- No `Math.random()`, asynchronous timeline construction, or infinite repeats
- Only animate visual properties (opacity, transforms, colors)—never `display`, `visibility`, or media playback

## Quality Checks

Run `npx hyperframes lint`, `validate`, and `inspect` before delivery. Verify design adherence, WCAG contrast (4.5:1 minimum), and animation choreography via the animation map.
