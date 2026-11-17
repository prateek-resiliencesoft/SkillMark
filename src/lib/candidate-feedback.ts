/**
 * Candidate feedback on the thank-you screen: shared constants and validation
 * (client-safe, no server imports).
 */
import { z } from "zod";

export const FEEDBACK_TAGS = [
  "Audio quality",
  "Questions were clear",
  "Too long",
  "Technical issues",
  "Easy to use",
  "Interviewer was helpful",
] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];

export const FEEDBACK_COMMENT_MAX = 1000;

export const FeedbackInput = z.object({
  sessionId: z.string().uuid(),
  /** Invite token for invite links; checked against the session when present. */
  inviteToken: z.string().min(1).max(200).optional(),
  rating: z.number().int().min(1).max(5),
  tags: z
    .array(z.enum(FEEDBACK_TAGS))
    .max(FEEDBACK_TAGS.length)
    .default([])
    .transform((t) => Array.from(new Set(t))),
  comment: z
    .string()
    .max(FEEDBACK_COMMENT_MAX, `Keep it under ${FEEDBACK_COMMENT_MAX} characters.`)
    .optional()
    .transform((c) => (c && c.trim() ? c.trim() : null)),
});
export type FeedbackInputT = z.infer<typeof FeedbackInput>;
