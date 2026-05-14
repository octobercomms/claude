# GSAP Animation Reference for HyperFrames

## Core Contract

HyperFrames manages GSAP through a runtime adapter. You must create a paused timeline synchronously and register it on `window.__timelines` using the composition's `data-composition-id` as the key. HyperFrames then controls playback and seeking.

Key requirements:
- Do not call `tl.play()` for render-critical motion
- Do not build timelines inside async code, timers, or event handlers
- Keep loops finite — HyperFrames renders finite video durations

## Primary Tween Methods

The four main functions:
- `gsap.to()` — animate to target state
- `gsap.from()` — animate from specified state (use for entrances)
- `gsap.fromTo()` — explicit start and end states
- `gsap.set()` — apply immediately without animation

Always use camelCase for property names.

## Basic Timeline Pattern

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });

  tl.from(".title", { opacity: 0, y: 40, duration: 0.65, ease: "power2.out" })
    .from(".subtitle", { opacity: 0, y: 24, duration: 0.5, ease: "power2.out" }, "+=0.1");

  window.__timelines = window.__timelines || {};
  window.__timelines["my-composition-id"] = tl;
</script>
```

## Essential Configuration

Common animation variables: `duration`, `delay`, `ease`, `stagger`. Use transform aliases (`x`, `y`, `rotation`, `scale`) rather than raw transform strings. Prefer `autoAlpha` over `opacity` for better performance (handles `visibility` alongside opacity).

## Timeline Sequencing

Position parameters control sequencing:
- Absolute time: `tl.to(el, props, 1.5)` — starts at 1.5s
- Relative offset: `tl.to(el, props, "+=0.5")` — 0.5s after previous ends
- Label alignment: `tl.to(el, props, "<")` — same start as previous
- Label: `tl.addLabel("scene2", 3); tl.to(el, props, "scene2")`

## Stagger Pattern

```js
tl.from(".card", {
  opacity: 0,
  y: 30,
  duration: 0.5,
  stagger: 0.1,
  ease: "power2.out",
});
```

## Performance Optimization

- Animate compositor-friendly properties: `x`, `y`, `scale`, `rotation`, `opacity`
- Use `will-change` CSS sparingly
- Leverage `gsap.quickTo()` for frequent updates
- Prefer staggered animations over individual tweens with manual delays
- Avoid animating layout properties (`width`, `height`, `top`, `left`) when transforms work

## Do Not

- Call `tl.play()` for render-critical motion
- Use `repeat: -1` (infinite loops) — use a finite repeat count from composition duration
- Build timelines in `setTimeout`, `requestAnimationFrame`, `fetch().then()`, or event handlers
- Animate `display`, `visibility`, or media playback state
- Use `Math.random()` or `Date.now()` inside timeline construction
