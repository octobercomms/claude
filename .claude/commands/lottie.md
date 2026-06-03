# Lottie for HyperFrames

HyperFrames facilitates animation seeking through its `lottie` runtime adapter, compatible with both `lottie-web` and dotLottie players. Since the animation timeline is inherent to the asset, HyperFrames only requires access to a seekable player object.

## Core Requirements

- Load assets from local project files, usually under `assets/`.
- Disable autoplay with `autoplay: false`.
- Use `loop: false` unless the user explicitly needs looping.
- Register all players on `window.__hfLottie`.
- Maintain stable container dimensions via CSS.

## lottie-web Pattern

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
<div id="lottie-container" style="width: 400px; height: 400px;"></div>
<script>
  const anim = lottie.loadAnimation({
    container: document.getElementById("lottie-container"),
    renderer: "svg",
    loop: false,
    autoplay: false,
    path: "assets/animation.json",
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(anim);
</script>
```

`lottie-web` uses `goToAndStop(timeMs, false)` for seeking, where the second argument `false` means time is in milliseconds (not frames).

## dotLottie Pattern

```html
<script type="module">
  import { DotLottie } from "https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web/+esm";

  const canvas = document.getElementById("canvas");
  const dotLottie = new DotLottie({
    canvas,
    src: "assets/animation.lottie",
    autoplay: false,
    loop: false,
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(dotLottie);
</script>
```

dotLottie uses frame or percentage-based APIs for seeking. The HyperFrames adapter handles conversion from composition time.

## Best Practices

Good uses:
- After Effects exports that are already known to render correctly in lottie-web
- Logo reveals, icon loops, decorative accents, and product UI motion

## Avoid

- Remote `path` URLs at render time — load from local `assets/` only.
- Asynchronous player registration (registering inside `anim.addEventListener("data_ready", ...)`)
- Untested After Effects effects — unsupported effects may not survive the JSON conversion.
- Starting playback with `play()`.

Multiple animations can be registered together; HyperFrames synchronizes them all to the same composition time.

## Validation

After editing a Lottie composition:

```bash
npx hyperframes lint
npx hyperframes validate
```
