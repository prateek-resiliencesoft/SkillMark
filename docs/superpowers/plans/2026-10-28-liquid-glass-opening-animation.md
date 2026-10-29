# Implementation Plan: Liquid Glass Opening Animation & Auth Sequence

**Goal:** Integrate `liquid-glass-logo-reveal.tsx` and build the coordinated opening animation for Skillmark where the logo reveals inside liquid glass in the center, glides to the left column, typography particles assemble from surrounding space, and the auth card slides in from the right.

---

### Task 1: Create `src/components/ui/liquid-glass-logo-reveal.tsx`
- Copy the WebGL2 liquid glass reveal component into `src/components/ui/liquid-glass-logo-reveal.tsx`.
- Add `onComplete?: () => void` callback trigger when `time >= end`.
- Support custom image/SVG logo and light/dark theme adaptation.

### Task 2: Enhance `src/components/ui/cursor-driven-particle-typography.tsx`
- Add `gatherOnMount?: boolean` and `triggerGather?: number` props.
- Implement particle dispersion initialization when `gatherOnMount` is enabled so particles magnetically converge from outside into the title & tagline.

### Task 3: Build Choreography in `src/components/auth/auth-split-view.tsx`
- Add state orchestrator (`"glass_center" | "gliding" | "gathering" | "settled"`).
- Add `sessionStorage` persistence check with replay control.
- Animate logo glide from screen center `(50vw, 50vh)` to left branding column.
- Crossfade to interactive `DitheredLogo`.
- Trigger typography particle gathering.
- Slide right auth container into view with spring motion.

### Task 4: Verification
- Verify TypeScript compilation: `npx tsc --noEmit`.
- Run tests: `npm run test:web`.
- Run linter: `npm run lint`.
- Test opening sequence and replay on `/login` and `/register`.
