# Brevo Integration, Multi-Provider Messaging & Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Brevo email delivery support, multi-provider selection at send time and organization settings, and inbound/outbound webhooks with HMAC verification.

**Architecture:** Extend `org_integrations` and `candidates` tables with Brevo credentials and webhook configs; implement `sendBrevoEmail` in `src/lib/messaging/providers.ts`; add outbound HMAC webhook dispatcher in `src/lib/messaging/webhooks.ts`; implement `POST /api/webhooks/candidates` inbound endpoint; update tRPC routers and Settings/Batch dialog UIs.

**Tech Stack:** TypeScript, Next.js 14 App Router, tRPC, PostgreSQL, Radix UI, Tailwind CSS, Node.js crypto.

---

### Task 1: Database Migration
**Files:**
- Create: `db/init/06-multi-provider-webhooks.sql`

- [ ] **Step 1: Write SQL migration file**
  Add Brevo columns, default provider selection, outbound/inbound webhook columns to `org_integrations`, and `emailProvider`/`whatsappProvider` to `candidates`.
- [ ] **Step 2: Apply migration to PostgreSQL container**
  Run: `docker exec -i skillmark-db-1 psql -U skillmark -d skillmark < db/init/06-multi-provider-webhooks.sql`
- [ ] **Step 3: Reload PostgREST schema cache**
  Run: `docker exec -i skillmark-db-1 psql -U skillmark -d skillmark -c "NOTIFY pgrst, 'reload schema';"`

---

### Task 2: Brevo Email Provider Client
**Files:**
- Modify: `src/lib/messaging/providers.ts`
- Create / Test: `tests/webhooks.test.ts`

- [ ] **Step 1: Write test for Brevo request format and response parsing**
- [ ] **Step 2: Run test and verify failure**
- [ ] **Step 3: Implement `sendBrevoEmail` in `src/lib/messaging/providers.ts`**
  Call Brevo REST API (`POST https://api.brevo.com/v3/smtp/email`) with `api-key` header and sender/recipient payload.
- [ ] **Step 4: Run test and verify it passes**

---

### Task 3: Outbound Webhook Dispatcher
**Files:**
- Create: `src/lib/messaging/webhooks.ts`
- Test: `tests/webhooks.test.ts`

- [ ] **Step 1: Write test for HMAC SHA-256 signature computation and payload formatting**
- [ ] **Step 2: Run test and verify failure**
- [ ] **Step 3: Implement `dispatchOutboundWebhook` in `src/lib/messaging/webhooks.ts`**
  Check subscribed events, generate signature `X-Skillmark-Signature`, and dispatch with timeout.
- [ ] **Step 4: Run test and verify it passes**

---

### Task 4: Inbound Webhook API Route
**Files:**
- Create: `src/app/api/webhooks/candidates/route.ts`
- Test: `tests/webhooks.test.ts`

- [ ] **Step 1: Write test for authentication verification and payload schema validation**
- [ ] **Step 2: Implement POST handler in `src/app/api/webhooks/candidates/route.ts`**
  Validate secret, create candidate, generate interview token, optionally trigger delivery.
- [ ] **Step 3: Verify tests pass**

---

### Task 5: Integration tRPC Router Updates
**Files:**
- Modify: `src/server/routers/integration.ts`
- Modify: `src/server/invite-delivery.ts`

- [ ] **Step 1: Update `loadDeliveryConfig` to load Brevo credentials and webhook configs**
- [ ] **Step 2: Support Brevo in `deliverEmail` based on configured/requested provider**
- [ ] **Step 3: Update `integration.get` and `integration.save` queries and mutations in `src/server/routers/integration.ts`**
- [ ] **Step 4: Add Brevo test email support in `integration.sendTest`**

---

### Task 6: Batch Router Multi-Provider Send Updates
**Files:**
- Modify: `src/server/routers/batch.ts`

- [ ] **Step 1: Accept optional `emailProvider` and `whatsappProvider` in `batch.sendInvites` input**
- [ ] **Step 2: Pass selected provider to `deliverEmail` and record provider on `candidates` table**
- [ ] **Step 3: Dispatch `candidate.invited` outbound webhook on successful sends**

---

### Task 7: Settings → Integrations UI Updates
**Files:**
- Modify: `src/app/(dashboard)/settings/integrations/page.tsx`

- [ ] **Step 1: Add Brevo configuration card (API key, From Email, From Name, Reply-to)**
- [ ] **Step 2: Add Default Provider selector (Resend vs Brevo)**
- [ ] **Step 3: Add Webhooks section (Outbound Webhooks URL + Secret + Events, Inbound Webhook instructions + secret)**
- [ ] **Step 4: Add test send button for Brevo**

---

### Task 8: Send Invites Dialog Provider Selector
**Files:**
- Modify: `src/components/batch/send-invites-dialog.tsx`

- [ ] **Step 1: Display provider selection pills when multiple email providers are connected**
- [ ] **Step 2: Default to the organization's preferred provider**
- [ ] **Step 3: Pass `emailProvider` in `send.mutate` payload**

---

### Task 9: Verification
- [ ] **Step 1: Run `npm run test:web` (ensure 100% pass rate)**
- [ ] **Step 2: Run `npx tsc --noEmit` (ensure 0 type errors)**
- [ ] **Step 3: Run `npm run lint` (ensure 0 warnings/errors)**
