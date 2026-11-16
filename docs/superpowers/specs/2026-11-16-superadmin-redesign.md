# Superadmin Panel Redesign: High-Density Operations Center

- **Date:** 2026-11-16
- **Scope:** Complete redesign of the Superadmin Console (`src/components/admin/*` and `src/app/(admin)/admin/**`).
- **Aesthetic Direction:** High-Density Ops Center (Linear / Vercel style) with dark-mode radiance, subsurface 1px borders, tactile micro-press interactions, and unified operational ergonomics.

---

## 1. Architectural Overview

The Superadmin console manages tenant organizations, operator accounts, platform billing catalogs, server telemetry, host journals, and background interview pipelines across this ResilienceSoft Interview instance.

### Core Problems Addressed
- **Styling Drift**: Inconsistent card borders, disparate button variants, and varying padding across the 12+ administrative views.
- **Visual Friction**: Loose data layouts without clear information hierarchy or scan-friendly typography.
- **Ergonomic Gaps**: Lack of persistent filter controls, unstandardized loading/skeleton states, and missing live heartbeat indicators.

---

## 2. Shared Design System Primitives

All administrative components now import from `src/components/admin/admin-ui.tsx`:

* **`Panel`**:
  - Subsurface 1px borders (`border-border/70 dark:border-white/[0.08]`) with hover highlights (`dark:hover:border-white/[0.14]`).
  - Subtle top-edge inner highlight (`shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`).
  - Integrated header with micro-typography kicker (`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`), title, and action slots.

* **`StatCard`**:
  - Compact KPI tiles featuring monospace tabular metrics, icon badge slots with ambient colored backgrounds, and trend delta indicators with directional arrows.
  - Built-in live indicators (e.g. pulse dots for active sessions).

* **`TacticalButton`**:
  - Mechanical micro-press animation (`active:scale-[0.98] transition-all duration-150`).
  - Integrated loading spinner (`Loader2`) that disables during mutation execution.
  - Dedicated tactile variants (`default`, `outline`, `secondary`, `destructive`, `ghost`).

* **`StatusPill`**:
  - Standardized domain status badges (`ACTIVE`, `SUSPENDED`, `HEALTHY`, `DEGRADED`, `OFFLINE`, `COMPLETED`, `IN_PROGRESS`) with pinging/static indicator dots.

* **`FilterBar`**:
  - Search input with instant clear button, query debounce, filter slot, and live result counter.

* **`EmptyState`**:
  - Dashed container with icon glyph, headline, explanation, and CTA.

---

## 3. Chrome & Layout Upgrades (`admin-shell.tsx`)

* **Top Operational Strip**:
  - Live system heartbeat indicator (`Systems Online` with pulsing emerald dot).
  - Dynamic breadcrumbs showing current section and page context.
  - Operator badge indicating `Superadmin` privilege level.
* **Collapsible Navigation**:
  - High-craft brand header with product wordmark and admin badge.
  - Group accordions with active route spring layout animations.
  - User profile drawer with quick link to application.
* **Widescreen Viewport**:
  - Expanded container from `max-w-6xl` to `max-w-7xl` to comfortably accommodate dense logs and timeseries metrics.

---

## 4. Routes Overhauled

1. **Overview Dashboard (`/admin`)**:
   - KPI tiles for Organizations, People, Sessions, and Completion rates.
   - Dual-axis Area chart with subtle gradients and custom dark-theme tooltips.
   - Session status distributions with progress meters and recent audit feed.
2. **Organizations Directory (`/admin/organizations`)**:
   - Filter bar with search by slug/name and status selector.
   - Tenant monograms, live status pills, and inline plan update / pause controls.
3. **Organization Detail (`/admin/organizations/[id]`)**:
   - Breadcrumb navigation, KPI cards, AI/integrations quick links.
   - Quota override inputs, feature flag gates, member management with role dropdowns, and soft-remove danger zone.
4. **AI Models & Integrations (`/admin/organizations/[id]/ai` & `/integrations`)**:
   - Password-masked credential inputs, provider status chips, and task routing priority lists.
   - Resend, Brevo, Resilio WhatsApp, and webhook configuration panels.
5. **People Directory & Detail (`/admin/people` & `[id]`)**:
   - Account directory with role badges, temporary password generators, and organization membership lists.
6. **Telemetry & Server Operations**:
   - **`/admin/server-health`**: CPU core load, 1m/5m/15m system load, RAM, and disk utilization gauges.
   - **`/admin/server-logs`**: Full terminal-grade log streaming viewer with level filters and pagination.
   - **`/admin/server-activity`**: Dual-column Grafana timeseries charts with peak/current telemetry readouts.
   - **`/admin/status`**: UptimeRobot synthetic prober forms, latency sparklines, and public visibility toggles.
7. **Platform Governance**:
   - **`/admin/storage`**: Multi-scope media file pruning with confirmation guards.
   - **`/admin/config`**: Global tenancy policies, plan catalog management with Stripe hooks, and default feature flags.
   - **`/admin/activity`**: Chronological audit trail with action icons and target links.

---

## 5. Verification

- `tsc --noEmit`: 0 errors.
- Unit tests (`tests/admin-stats.test.ts`): 7 passed, 0 failed.
