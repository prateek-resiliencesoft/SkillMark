import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PanelRole } from "@/lib/round-two/types";
import type { Context } from "../context";
import { assertMinRole, getEffectiveProjectRole, getOrgMembership, hasProjectAccess } from "../trpc";

type Db = Context["supabase"];

export function newRoundToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashRoundToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface RoundRow {
  id: string;
  organizationId: string;
  projectId: string;
  candidateId: string;
  sourceSessionId: string | null;
  hostUserId: string;
  title: string;
  scheduledAt: string | null;
  durationMin: number;
  status: string;
  livekitRoom: string;
  candidateAdmittedAt: string | null;
  candidateConsentAt: string | null;
  questionPlan: unknown;
  round1Context: unknown;
  liveSummary: string;
  coveredQuestionIds: string[];
  aiTokensUsed: number;
  reportStatus: string;
  report: unknown;
  /** Open boards + coding task (db/init/51). */
  boardState?: unknown;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ParticipantRow {
  id: string;
  roundTwoId: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: PanelRole;
  status: string;
  joinedAt: string | null;
}

export interface RoundAccess {
  round: RoundRow;
  /** Effective panel role in the room. Org managers who weren't invited join as interviewers. */
  role: PanelRole;
  participant: ParticipantRow | null;
  /** Host or org member with MEMBER+ on the project: may invite, admit, end, edit plan. */
  canManage: boolean;
}

/** True when the user is an org member allowed to manage sessions in the project. */
export async function isProjectManager(db: Db, organizationId: string, projectId: string, userId: string): Promise<boolean> {
  const membership = await getOrgMembership(db, organizationId, userId);
  if (!membership) return false;
  if (!(await hasProjectAccess(db, projectId, userId))) return false;
  const role = await getEffectiveProjectRole(db, projectId, userId, membership.role);
  try {
    assertMinRole(role, "MEMBER");
    return true;
  } catch {
    return false;
  }
}

export async function requireProjectManager(db: Db, organizationId: string, projectId: string, userId: string): Promise<void> {
  const membership = await getOrgMembership(db, organizationId, userId, { write: true });
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this organization" });
  if (!(await hasProjectAccess(db, projectId, userId))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this project" });
  }
  const role = await getEffectiveProjectRole(db, projectId, userId, membership.role);
  assertMinRole(role, "MEMBER");
}

/**
 * Resolve the caller's access to a round 2. Invited panelists (incl. people outside
 * the org) get access to this round only; org managers get it via membership.
 */
export async function loadRoundAccess(db: Db, roundTwoId: string, userId: string): Promise<RoundAccess> {
  const { data: round } = await db.from("round_two_interviews").select("*").eq("id", roundTwoId).maybeSingle();
  if (!round) throw new TRPCError({ code: "NOT_FOUND", message: "Round 2 interview not found" });
  const r = round as RoundRow;

  const { data: p } = await db
    .from("round_two_participants")
    .select("*")
    .eq("roundTwoId", roundTwoId)
    .eq("userId", userId)
    .neq("status", "revoked")
    .maybeSingle();
  const participant = (p as ParticipantRow | null) ?? null;

  const manager = await isProjectManager(db, r.organizationId, r.projectId, userId);
  const isHost = r.hostUserId === userId || participant?.role === "host";
  if (!participant && !manager && !isHost) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You were not invited to this interview" });
  }
  const role: PanelRole = isHost ? "host" : participant?.role ?? "interviewer";
  return { round: r, role, participant, canManage: isHost || manager };
}

export function assertCanManage(access: RoundAccess): void {
  if (!access.canManage) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the host or project members can do this" });
  }
}

export function isOpenRound(status: string): boolean {
  return status === "scheduled" || status === "live" || status === "draft";
}
