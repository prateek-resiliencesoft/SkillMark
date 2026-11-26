import { normalizeWhatsappPhone } from "@/lib/messaging/templates";
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

/** Same rules as WhatsApp delivery (E.164; Indian 10-digit → +91). */
export function normalizeNotifyPhone(phone: string | null | undefined): string | null {
  return normalizeWhatsappPhone(phone);
}
