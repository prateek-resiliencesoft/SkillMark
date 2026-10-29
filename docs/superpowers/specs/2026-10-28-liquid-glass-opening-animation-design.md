# Design Specification: Cinematic Liquid Glass Logo Reveal & Auth Opening Sequence

**Date:** 2026-10-28  
**Status:** Approved  
**Author:** Antigravity Pairing Assistant  

---

## 1. Executive Summary

This feature redesigns the Skillmark opening and authentication experience (`/login` and `/register`) with a multi-stage cinematic animation sequence:
1. **Stage 1 (Liquid Glass Reveal in Center, 0.0s – 2.4s)**:
   A WebGL2 liquid glass droplet effect renders in the center of the viewport. The glass droplet lands, stretches into a squircle, bends the Skillmark logo into spectral colors with optical dispersion, sweeps a light sheen across the surface, and releases the logo.
2. **Stage 2 (Glide to Left Branding Column, 2.4s – 3.2s)**:
   The logo smoothly glides from the screen center `(50vw, 50vh)` to its settled position in the left branding column, seamlessly transitioning into the interactive [`DitheredLogo`](file:///home/dewashish/Projects/workprojects/Skillmark/src/components/ui/dithered-logo.tsx).
3. **Stage 3 (Particle Gathering Typography, 2.8s – 3.8s)**:
   Below the logo, particles scatter across the canvas and magnetically assemble into the title `"SKILLMARK"` and subtitle `"Measure what matters"` using spring physics in [`CursorDrivenParticleTypography`](file:///home/dewashish/Projects/workprojects/Skillmark/src/components/ui/cursor-driven-particle-typography.tsx).
4. **Stage 4 (Auth Container Entrance, 3.4s – 4.2s)**:
   The right-hand authentication container (segmented tabs and login/register card) smoothly slides into view from the right with spring damping.
5. **Session Persistence & Replay**:
   The full sequence runs once per session (stored in `sessionStorage`). Subsequent visits or tab switches between Login and Register render the settled layout immediately, with an optional replay trigger.

---

## 2. Architecture & Choreography

```
[ Viewport Center ]
        |
        v  (0.0s - 2.4s)
+--------------------------------------------------------+
| Liquid Glass Reveal (WebGL2 Canvas)                    |
| - Optical dispersion, light sheen, squircle boundary   |
| - Renders Skillmark logo mark                          |
+--------------------------------------------------------+
        |
        v  (2.4s - 3.2s)
+--------------------------------------------------------+
| Logo Glides to Left Column (Framer Motion spring)      |
| - Crossfades into interactive DitheredLogo             |
+--------------------------------------------------------+
        |
        v  (2.8s - 3.8s)
+--------------------------------------------------------+
| Particle Typography Assembles (Gather Animation)       |
| - Particles coalesce into "SKILLMARK" & Tagline        |
| - Transitions into cursor-driven interactive physics   |
+--------------------------------------------------------+
        |
        v  (3.4s - 4.2s)
+--------------------------------------------------------+
| Auth Form Container Slides In                          |
| - Slides from right (x: +80px -> 0, opacity: 0 -> 1)   |
| - Form ready for input                                 |
+--------------------------------------------------------+
```

---

## 3. Component Design & Changes

### 3.1. `LiquidGlassLogoReveal` (`src/components/ui/liquid-glass-logo-reveal.tsx`)
- Copied from the 21st.dev / zanwei WebGL2 shader implementation.
- Wrapped with shadcn / Tailwind CSS conventions and TypeScript.
- Enhanced with:
  - `onComplete?: () => void`: Fires when `time >= end` and the glass has released the mark.
  - Support for custom logo image `/images/skillmark-logo.png` or SVG mark.
  - Responsive tile sizing matching the device pixel ratio.
  - Automatic theme-aware background (`#09090b` for dark mode, `#f9fafb` for light mode).

### 3.2. `CursorDrivenParticleTypography` (`src/components/ui/cursor-driven-particle-typography.tsx`)
- Add `gatherOnMount?: boolean` prop (default `false` or controlled by parent state).
- When `gatherOnMount` is true, particle initial coordinates `(x, y)` are initialized with a dispersed offset `originX + (Math.random() - 0.5) * 500`, `originY + (Math.random() - 0.5) * 350` and an initial velocity.
- The spring return physics (`returnSpeed * 1.5` ramping to normal `returnSpeed`) draws the particles into their glyph coordinates over ~800ms.
- Once gathered, standard cursor repulsion and shimmer take over seamlessly.

### 3.3. `AuthSplitView` (`src/components/auth/auth-split-view.tsx`)
- Orchestrates the sequence state:
  `type AnimationStage = "glass_center" | "gliding" | "gathering" | "settled";`
- On mount, checks `sessionStorage.getItem("skillmark_intro_played")`:
  - If previously played, sets stage directly to `"settled"`.
  - If not played, sets stage to `"glass_center"` and advances through timers / `onComplete`.
- Central stage: renders `LiquidGlassLogoReveal` centered via fixed/absolute positioning with an entrance/exit transition.
- Left column: logo target anchor with Framer Motion `motion.div` gliding from center.
- Right column: `motion.div` animating `x: 80 -> 0`, `opacity: 0 -> 1` once the logo reaches position.
- Subtle replay button on the branding footer or header allowing user to re-trigger the animation anytime.

---

## 4. Verification Plan
- `npm run test:web`: Run all unit tests.
- `npx tsc --noEmit`: Ensure zero TypeScript errors across all modified and newly created files.
- `npm run lint`: Ensure zero ESLint warnings or errors.
- Visual verification: Verify WebGL context creation, shader compilation, glide transition, particle convergence, and form slide-in on `http://localhost:3000/login`.
