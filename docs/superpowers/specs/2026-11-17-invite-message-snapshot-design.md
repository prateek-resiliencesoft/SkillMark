# Invite message snapshot in candidate side panel

## Goal
When opening a session/candidate right sheet, show the Email and WhatsApp invite that was (or would be) sent, in a structured format.

## Approach
- On successful send, persist a snapshot on `candidates.inviteMessages` (jsonb).
- When missing (older rows), reconstruct from current org templates + candidate vars and label **Reconstructed**.
- When present, label **Exact (saved)**.

## Shape
```ts
{
  email?: { subject, text, sentAt, provider, to }
  whatsapp?: { text, sentAt, provider, to, templateName? }
}
```

## UI
`CandidateDetailSheet` → Invite messages section with Email / WhatsApp cards showing channel, status, times, provider, subject, body.
