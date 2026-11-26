/**
 * Zod schemas for the public results API. The same schemas validate requests
 * in the route handlers and generate the OpenAPI document, so the docs can't
 * drift from the code.
 */
import { z } from "zod";

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Use an ISO 8601 date, e.g. 2026-11-01 or 2026-11-01T09:30:00Z");

export const SESSION_STATUSES = ["IN_PROGRESS", "COMPLETED", "ABANDONED", "DISQUALIFIED"] as const;
export const REPORT_STATUSES = ["none", "pending", "generating", "ready", "failed"] as const;

export const ListMeta = {
  limit: z.coerce.number().int().min(1).max(100).default(20).describe("Items per page, 1 to 100."),
  cursor: z.string().max(200).optional().describe("Value of `next_cursor` from the previous page."),
};

/* ---------------- Inputs ---------------- */

export const IdParams = z.object({ id: z.string().uuid().describe("Session id (UUID).") });

export const ListSessionsQuery = z.object({
  status: z.enum(SESSION_STATUSES).optional().describe("Only sessions with this status."),
  interview_id: z.string().uuid().optional().describe("Only sessions of this interview."),
  candidate_email: z.string().email().optional().describe("Only sessions of the candidate with this email (case-insensitive)."),
  from: isoDate.optional().describe("Created at or after this time (ISO 8601)."),
  to: isoDate.optional().describe("Created at or before this time (ISO 8601)."),
  ...ListMeta,
});

export const ListInterviewsQuery = z.object({
  active: z.enum(["true", "false"]).optional().describe("Only open (`true`) or closed (`false`) interviews."),
  ...ListMeta,
});

export const ListCandidatesQuery = z.object({
  interview_id: z.string().uuid().optional().describe("Only candidates invited to this interview."),
  email: z.string().email().optional().describe("Only candidates with this email (case-insensitive)."),
  ...ListMeta,
});

export const CreateInviteBody = z.object({
  interview_id: z.string().uuid().describe("Interview to invite the candidate to."),
  name: z.string().trim().min(1).max(200).describe("Candidate full name."),
  email: z.string().email().optional().describe("Candidate email. Needed to send the invite by email."),
  phone: z.string().trim().min(5).max(30).optional().describe("Candidate phone in international format, e.g. +919876543210. Needed for WhatsApp."),
  send: z
    .object({
      email: z.boolean().default(false).describe("Email the invite link now."),
      whatsapp: z.boolean().default(false).describe("Send the invite link on WhatsApp now."),
    })
    .optional()
    .describe("Leave out to only create the link (nothing is sent)."),
});

/* ---------------- Outputs ---------------- */

export const ErrorBody = z.object({
  error: z.object({
    code: z.string().describe("Stable machine-readable code, e.g. NOT_FOUND."),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const Session = z.object({
  id: z.string().uuid(),
  interview_id: z.string().uuid(),
  interview_title: z.string(),
  candidate_id: z.string().uuid().nullable(),
  candidate_name: z.string().nullable(),
  candidate_email: z.string().nullable(),
  status: z.enum(SESSION_STATUSES),
  end_reason: z.string().nullable().describe("Why the session ended, e.g. COMPLETED, TAB_CLOSED, DISCONNECTED."),
  report_status: z.enum(REPORT_STATUSES),
  overall_score: z.number().nullable().describe("Average score out of 10 once the report is ready."),
  duration_seconds: z.number().int().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
});

export const Result = z.object({
  session_id: z.string().uuid(),
  status: z.enum(SESSION_STATUSES),
  report_status: z.enum(REPORT_STATUSES),
  overall_score: z.number().nullable(),
  recommendation: z.enum(["hire", "maybe", "no"]).nullable().describe("hire at 7+, maybe at 5+, otherwise no. Disqualified is always no."),
  summary: z.string().nullable(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  key_insights: z.array(z.string()),
  themes: z.array(z.string()),
  criteria: z.array(z.object({ name: z.string(), score: z.number(), reasoning: z.string() })),
  questions: z.array(
    z.object({
      question: z.string(),
      score: z.number(),
      evaluation: z.string(),
      highlights: z.array(z.string()),
      improvements: z.array(z.string()),
    }),
  ),
  integrity: z.object({
    disqualified: z.boolean(),
    strikes: z.number().int(),
    events: z.array(z.object({ label: z.string(), count: z.number().int() })),
  }),
});

export const TranscriptMessage = z.object({
  role: z.enum(["interviewer", "candidate"]),
  content: z.string(),
  timestamp: z.string(),
});

export const Transcript = z.object({
  session_id: z.string().uuid(),
  messages: z.array(TranscriptMessage),
});

export const Interview = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  mode: z.string(),
  language: z
    .string()
    .describe('Interview language: "en" (English), "hi" (Hindi, transcripts in Roman-script Hinglish), or "multi" (Hindi + English; the candidate picks one and can switch or mix)'),
  is_active: z.boolean(),
  time_limit_minutes: z.number().int().nullable(),
  session_count: z.number().int(),
  completed_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const Candidate = z.object({
  id: z.string().uuid(),
  interview_id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(["invited", "in_progress", "completed", "abandoned", "disqualified"]),
  session_id: z.string().uuid().nullable(),
  invite_expires_at: z.string().nullable(),
  created_at: z.string(),
});

const Delivery = z.object({ status: z.enum(["sent", "failed", "skipped"]), error: z.string().optional() });

export const Invite = z.object({
  candidate_id: z.string().uuid(),
  interview_id: z.string().uuid(),
  invite_url: z.string(),
  expires_at: z.string().nullable(),
  delivery: z.object({ email: Delivery.optional(), whatsapp: Delivery.optional() }),
});

export const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() });
export const one = <T extends z.ZodType>(item: T) => z.object({ data: item });
