# Design Document: Brevo Integration, Multi-Provider Messaging & Webhooks

**Date:** 2026-10-28  
**Status:** Approved  
**Author:** Antigravity Pairing Assistant  

---

## 1. Executive Summary

This feature adds:
1. **Brevo (formerly Sendinblue) Transactional Email Support** alongside Resend.
2. **Multi-Provider Messaging Architecture**:
   - Multiple email providers (Resend, Brevo) and WhatsApp providers (ResilioHub).
   - Default provider configuration per organization.
   - Per-send provider selection in the `SendInvitesDialog`.
3. **Outbound Webhooks Engine**:
   - Secure HMAC SHA-256 signed event delivery to external endpoints (Zapier, Make, recruiter CRM, ATS) for events: `candidate.invited`, `session.started`, and `session.completed`.
4. **Inbound Webhook API**:
   - `POST /api/webhooks/candidates` allowing external tools to create candidates, generate customized interviews, and optionally dispatch invites automatically.

---

## 2. Architecture & Data Flow

```
+-----------------------------------------------------------------------------------------+
|                                     Settings / Admin                                    |
|   - Configure Resend (API key, From, Reply-To)                                          |
|   - Configure Brevo (API key, From Email, From Name, Reply-To)                          |
|   - Configure WhatsApp (ResilioHub API key, Template, Base URL)                         |
|   - Configure Inbound Webhook Secret & Outbound Webhook Target + Events                  |
+--------------------------------------------+--------------------------------------------+
                                             |
                                             v
                      +---------------------------------------------+
                      |         public.org_integrations             |
                      |   - Stored credentials (AES-GCM encrypted)  |
                      |   - defaultEmailProvider: 'resend'|'brevo'   |
                      |   - outboundWebhookUrl, Secret, Events      |
                      +----------------------+----------------------+
                                             |
                   +-------------------------+-------------------------+
                   |                                                   |
                   v                                                   v
   +-------------------------------+                   +-------------------------------+
   |      Batch Send Invites       |                   |       Inbound Webhook         |
   | (SendInvitesDialog / Router)  |                   |  POST /api/webhooks/candidate |
   | - Select Email: Resend|Brevo  |                   | - Ingest candidate details    |
   | - Select WhatsApp: ResilioHub |                   | - Generate interview / batch  |
   +---------------+---------------+                   +---------------+---------------+
                   |                                                   |
                   +-------------------------+-------------------------+
                                             |
                                             v
                             +-------------------------------+
                             |    src/server/invite-delivery |
                             | - deliverEmail (Resend/Brevo) |
                             | - deliverWhatsapp(ResilioHub) |
                             | - dispatchOutboundWebhook     |
                             +---------------+---------------+
                                             |
        +------------------------------------+------------------------------------+
        |                                    |                                    |
        v                                    v                                    v
+---------------+                    +---------------+                    +---------------+
|    Resend     |                    |     Brevo     |                    | Outbound Hook |
|   Email API   |                    |   SMTP API    |                    |  Target URL   |
+---------------+                    +---------------+                    +---------------+
```

---

## 3. Database Schema (`db/init/06-multi-provider-webhooks.sql`)

```sql
-- ────────────────────────────────────────────────────────────
-- 06-multi-provider-webhooks.sql: Brevo, Multi-provider, Webhooks
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.org_integrations
  -- Brevo credentials
  ADD COLUMN IF NOT EXISTS "brevoApiKey" text,
  ADD COLUMN IF NOT EXISTS "brevoFromEmail" text,
  ADD COLUMN IF NOT EXISTS "brevoFromName" text,
  ADD COLUMN IF NOT EXISTS "brevoReplyTo" text,
  -- Default provider selection
  ADD COLUMN IF NOT EXISTS "defaultEmailProvider" text DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS "defaultWhatsappProvider" text DEFAULT 'resilio',
  -- Outbound Webhooks
  ADD COLUMN IF NOT EXISTS "outboundWebhookUrl" text,
  ADD COLUMN IF NOT EXISTS "outboundWebhookSecret" text,
  ADD COLUMN IF NOT EXISTS "outboundWebhookEvents" text[] DEFAULT ARRAY['candidate.invited', 'session.started', 'session.completed']::text[],
  -- Inbound Webhook Token
  ADD COLUMN IF NOT EXISTS "inboundWebhookSecret" text;

-- Record delivery provider on candidate
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS "emailProvider" text,
  ADD COLUMN IF NOT EXISTS "whatsappProvider" text;
```

---

## 4. Brevo API Client (`src/lib/messaging/providers.ts`)

Endpoint: `POST https://api.brevo.com/v3/smtp/email`  
Headers: `api-key: <API_KEY>`, `Content-Type: application/json`, `accept: application/json`  
Payload:
```json
{
  "sender": {
    "name": "Acme Hiring",
    "email": "hiring@acme.com"
  },
  "to": [
    {
      "email": "candidate@example.com",
      "name": "Priya Sharma"
    }
  ],
  "subject": "Your interview invitation",
  "htmlContent": "<!doctype html>...",
  "textContent": "Hello Priya...",
  "replyTo": {
    "email": "recruiter@acme.com"
  }
}
```

Response: `{ "messageId": "<...>" }` on success, or HTTP 4xx/5xx with error message.

---

## 5. Webhook System

### Outbound Webhooks (`src/lib/messaging/webhooks.ts`)
- Dispatches HTTP `POST` requests to `outboundWebhookUrl`.
- Header: `X-Skillmark-Signature: sha256=<HMAC_HEX>` computed with `outboundWebhookSecret`.
- Header: `X-Skillmark-Event: <EVENT_NAME>`.
- Payload structure:
  ```json
  {
    "event": "candidate.invited",
    "timestamp": "2026-10-28T12:00:00.000Z",
    "organizationId": "...",
    "data": {
      "candidateId": "...",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "inviteLink": "https://.../i/invite/abc123xyz789",
      "scheduledAt": "2026-11-02T10:00:00.000Z",
      "expiresAt": "2026-11-03T10:00:00.000Z",
      "channel": "email",
      "provider": "brevo"
    }
  }
  ```

### Inbound Webhooks (`src/app/api/webhooks/candidates/route.ts`)
- Endpoint: `POST /api/webhooks/candidates`
- Authentication: Header `X-Webhook-Secret: <SECRET>` or Query parameter `?token=<SECRET>` matching `inboundWebhookSecret`.
- Accepts:
  ```json
  {
    "organizationId": "...",
    "batchId": "...",
    "name": "Rahul Verma",
    "email": "rahul@example.com",
    "phone": "+919876543210",
    "scheduledAt": "2026-11-02T10:00:00.000Z",
    "expiresAt": "2026-11-09T23:59:59.000Z",
    "sendInviteImmediately": true,
    "emailProvider": "brevo"
  }
  ```
- Creates candidate, generates invite token, sends invite if requested, and returns `{ ok: true, candidateId, inviteLink }`.

---

## 6. User Interface Updates

1. **Settings → Integrations (`src/app/(dashboard)/settings/integrations/page.tsx`)**:
   - **Email Providers Grid**:
     - Resend Card (Connected badge, API key, From, Reply-to).
     - Brevo Card (Connected badge, API key, From Email, From Name, Reply-to).
     - Default Email Provider radio selector (*Resend* vs *Brevo*).
   - **WhatsApp Providers Grid**:
     - ResilioHub Card (Connected badge, API key, Template Name, Base URL).
   - **Webhooks Card**:
     - Outbound Webhook URL, Secret Key (with Regenerate button), Subscribed Event checkboxes.
     - Inbound Webhook URL (`https://.../api/webhooks/candidates`), Inbound Secret Token, and sample curl snippet.
   - **Send a Test**:
     - Allows testing both Resend and Brevo separately.

2. **Send Invites Dialog (`src/components/batch/send-invites-dialog.tsx`)**:
   - If both Resend and Brevo are configured:
     - Displays **Email Provider** selection pill (e.g. `[Resend] [Brevo]`) defaulting to the organization's choice.
   - Displays **WhatsApp Provider** selection pill (`[ResilioHub]`).

---

## 7. Verification Plan
- Apply SQL migration to PostgreSQL and reload PostgREST schema cache.
- Unit tests in `tests/batch-invites.test.ts` and `tests/webhooks.test.ts`:
  - Brevo payload building and response handling.
  - Outbound HMAC signature generation and event validation.
  - Inbound webhook authentication and payload parsing.
  - Multi-provider fallback and send routing.
- `npx tsc --noEmit` (0 errors).
- `npm run test:web` (100% passing).
- `npm run lint` (0 warnings/errors).
