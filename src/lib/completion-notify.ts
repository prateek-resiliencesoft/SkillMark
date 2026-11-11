import { z } from "zod";

/** Org member + WhatsApp number to alert when a candidate finishes. */
export const completionNotifyMemberSchema = z.object({
  userId: z.string().uuid(),
  phone: z.string().min(8).max(20),
  name: z.string().max(120).optional(),
});

export type CompletionNotifyMember = z.infer<typeof completionNotifyMemberSchema>;

export const completionNotifyMembersSchema = z.array(completionNotifyMemberSchema).max(20);

export function parseCompletionNotifyMembers(raw: unknown): CompletionNotifyMember[] {
  const parsed = completionNotifyMembersSchema.safeParse(Array.isArray(raw) ? raw : []);
  return parsed.success ? parsed.data : [];
}

export function normalizeNotifyPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s()-]/g, "");
  if (!cleaned.startsWith("+")) return null;
  if (cleaned.length < 9 || cleaned.length > 16) return null;
  return cleaned;
}
