# Design Spec: Dark Mode Theme Redesign & Harmonized Light Mode

**Date:** 2026-10-27  
**Status:** Approved  
**Reference:** Dribbble "User profile page in dark theme" by Virgil Pana  

---

## 1. Overview & Objectives

Transform Skillmark's visual identity from the previous earthy terracotta/sand palette to a sleek, modern, high-contrast dark theme based directly on the provided reference design. In addition, introduce a matching contemporary light theme that shares the same electric violet brand accent and refined container geometry.

Key Objectives:
1. **Default Dark Mode:** Set dark mode as the default experience across all views (dashboard, management portals, and candidate interview sessions).
2. **Precision Color Palette:** Implement the sampled deep zinc canvas (`#1c1c1f`), elevated card surfaces (`#222226`), distinct sidebar tone (`#28282c`), and electric violet brand anchor (`#5944f6`).
3. **Container Geometry & Details:** Update border radius tokens (`--radius: 0.875rem`), soft hairline borders (`rgba(255,255,255,0.08)` / `#2e2e35`), and pill-shaped badge styling (`rounded-full`).
4. **Harmonized Light Mode:** Provide a crisp, clean slate/white light mode utilizing the same violet primary anchor for seamless brand continuity.
5. **Backward Compatibility:** Map legacy brand classes (`mk-terracotta`, `brand-terracotta`) to the new semantic tokens to guarantee zero visual breakage in existing components.

---

## 2. Color Palette & Token Architecture

### 2.1 CSS Variables (`src/app/globals.css`)

#### Dark Mode (`.dark`)
| Token | HSL Value | Hex Equivalent | Visual Role |
| :--- | :--- | :--- | :--- |
| `--background` | `240 7% 12%` | `#1c1c1f` | Main canvas / page background |
| `--card` | `240 6% 14%` | `#222226` | Elevated cards, metric panels, dialogs |
| `--card-foreground` | `0 0% 100%` | `#ffffff` | Primary text on cards |
| `--popover` | `240 6% 14%` | `#222226` | Dropdowns, menus, tooltips |
| `--popover-foreground`| `0 0% 100%` | `#ffffff` | Popover text |
| `--primary` | `247 90% 62%` | `#5944f6` | Primary action buttons, active indicator, focus rings |
| `--primary-foreground`| `0 0% 100%` | `#ffffff` | Text on primary buttons |
| `--secondary` | `245 13% 18%` | `#272733` | Pills, tags, secondary button fills |
| `--secondary-foreground`| `240 5% 85%` | `#d4d4d8` | Secondary / tag text |
| `--muted` | `245 13% 18%` | `#272733` | Inactive tracks, subtle highlights |
| `--muted-foreground` | `220 9% 65%` | `#9ca3af` | Secondary labels, descriptions, timestamps |
| `--accent` | `247 50% 22%` | `#26234b` | Active item background tint |
| `--accent-foreground` | `247 90% 75%` | `#a59df9` | Text on active item tint |
| `--destructive` | `0 84% 60%` | `#ef4444` | Errors and destructive buttons |
| `--border` | `240 7% 19%` | `#2e2e35` | Hairline card borders and dividers |
| `--input` | `240 7% 19%` | `#2e2e35` | Form input borders |
| `--ring` | `247 90% 62%` | `#5944f6` | Focus outline rings |

#### Light Mode (`:root`)
| Token | HSL Value | Hex Equivalent | Visual Role |
| :--- | :--- | :--- | :--- |
| `--background` | `240 20% 98%` | `#f8f8fc` | Main light canvas with soft cool tint |
| `--card` | `0 0% 100%` | `#ffffff` | Crisp white card containers |
| `--card-foreground` | `240 10% 10%` | `#18181b` | Primary text on light cards |
| `--popover` | `0 0% 100%` | `#ffffff` | Light dropdowns and popovers |
| `--primary` | `247 90% 62%` | `#5944f6` | Consistent brand electric violet |
| `--primary-foreground`| `0 0% 100%` | `#ffffff` | Text on primary buttons |
| `--secondary` | `245 25% 94%` | `#edeefc` | Light pill tags and secondary chips |
| `--secondary-foreground`| `247 60% 35%` | `#3c2fa8` | Text on secondary chips |
| `--muted` | `240 14% 94%` | `#edeef2` | Muted backgrounds and tab rails |
| `--muted-foreground` | `240 5% 42%` | `#646470` | Secondary light mode text |
| `--accent` | `247 80% 96%` | `#f0efff` | Hover tint for light mode items |
| `--border` | `240 16% 90%` | `#e2e2ec` | Clean light dividers |
| `--input` | `240 16% 90%` | `#e2e2ec` | Input borders |
| `--ring` | `247 90% 62%` | `#5944f6` | Focus outline rings |

---

## 3. Tailwind Configuration Updates (`tailwind.config.ts`)

1. **Primary Violet Scale (50–900):**
   * 50: `#f5f3ff`
   * 100: `#ede9fe`
   * 200: `#ddd6fe`
   * 300: `#c4b5fd`
   * 400: `#a78bfa`
   * 500: `#7c3aed`
   * 600: `#5944f6` (Core Brand)
   * 700: `#4c35e0`
   * 800: `#3f29c2`
   * 900: `#2e1b9b`

2. **Radius Tokens:**
   * `--radius`: Set to `0.875rem` (14px) for modern, soft curvature.
   * `rounded-lg`: `var(--radius)`
   * `rounded-xl`: `1rem`
   * `rounded-2xl`: `1.25rem`

3. **Brand / Surface Aliases:**
   * Map `colors.brand.terracotta` and `colors.mk.terracotta` to `#5944f6` to ensure legacy custom classes render with the new brand color without requiring immediate refactoring of every template.
   * Define `colors.surface.sidebar`: `#28282c` (dark) / `#f1f1f6` (light).

---

## 4. Application Configuration

* **`src/components/providers.tsx`:**
  Update `<ThemeProvider>` to set `defaultTheme="dark"` and `enableSystem={false}` (or `enableSystem` with default dark).

---

## 5. Verification & Testing

1. **Compilation Check:** Run `npm run build` or inspect Next.js dev server log for syntax or type issues.
2. **Visual Verification:**
   * Verify `/dashboard` renders with deep zinc background (`#1c1c1f`), dark cards (`#222226`), and violet buttons/indicators.
   * Verify `/interviews` list and `/candidates` view for contrast and pill badge appearance.
   * Verify `/i/[slug]` candidate session view for dark theme readability.
   * Verify light mode toggle renders properly with crisp cool slate surfaces.
