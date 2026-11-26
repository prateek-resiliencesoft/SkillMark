import "server-only";
import { createLogger } from "@/lib/logger";
import { listRoomIdentities, sendToIdentities } from "@/lib/livekit";
import {
  DATA_TOPICS,
  ROUND2_RUBRIC,
  USER_IDENTITY_PREFIX,
  describeAiError,
  normalizeLiveScoring,
  type LiveScoring,
  type Round1Context,
} from "@/lib/round-two/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callJson, clip } from "./ai";
import { verifyLiveScoring } from "./checks";
import { latestCodeContext } from "./boards";
import { round1ContextPrompt } from "./context";

const log = createLogger("round-two/live-score");

const TOKEN_BUDGET = Number(process.env.ROUND2_AI_TOKEN_BUDGET) || 250_000;
/** Minimum gap between automatic live scoring runs per room. */
const MIN_GAP_MS = Number(process.env.ROUND2_LIVE_SCORING_GAP_MS) || 60_000;
/** Candidate words needed before the first automatic score. */
const MIN_WORDS = 60;

export function liveScoringEnabled(): boolean {
  return !/^(0|off|false|no)$/i.test(process.env.ROUND2_LIVE_SCORING?.trim() ?? "");
}

const g = globalThis as unknown as { __r2Score?: { running: Set<string>; lastRun: Map<string, number> } };
const state = (g.__r2Score ??= { running: new Set(), lastRun: new Map() });

const SYSTEM = `You score a candidate live during a round 2 interview to help the human panel. The panel decides; you only suggest.
Score each criterion 1-5 (1 = clearly weak, 3 = adequate, 5 = exceptional) ONLY from what the candidate actually said in this round.
If there is not enough evidence for a criterion yet, use null. Never guess from the CV or round 1 alone; use them only as context.
Produce JSON:
{"scores": [{"criterion": one of ${JSON.stringify(ROUND2_RUBRIC)}, "score": 1-5 | null, "reason": string (one short sentence), "evidence": string (a short quote copied verbatim from the candidate, or "")}],
 "recommendation": "strong_no"|"no"|"lean_no"|"lean_yes"|"yes"|"strong_yes"|null (null if too early),
 "confidence": number 0-1 (how much of the interview you have seen to back these scores),
 "summary": string (one or two sentences)}`;

export type ScoringOutcome =
  | { ok: true; scoring: LiveScoring }
  | { ok: false; reason: "disabled" | "busy" | "not_live" | "budget" | "too_early" | "error"; message: string };

export async function recordAiError(roundTwoId: string, stage: "copilot" | "scoring", err: unknown, trigger: string): Promise<string> {
  const message = describeAiError(err);
  const { error } = await supabaseAdmin.from("round_two_ai_events").insert({
    roundTwoId,
    kind: "error",
    trigger: trigger === "manual" || trigger === "ask" ? trigger : "turn",
    payload: { stage, message, at: new Date().toISOString() },
  });
  if (error) log.warn("could not record AI error (migration 50 applied?)", error.message);
  return message;
}

/** Suggested per-criterion scores from the live transcript (stored as an ai_event, never into a scorecard). */
export async function runLiveScoring(roundTwoId: string, trigger: "turn" | "manual"): Promise<ScoringOutcome> {
  if (!liveScoringEnabled()) return { ok: false, reason: "disabled", message: "Live scoring is turned off on this server." };
  if (state.running.has(roundTwoId)) return { ok: false, reason: "busy", message: "Live scoring is already running." };
  state.running.add(roundTwoId);
  try {
    const { data: round } = await supabaseAdmin
      .from("round_two_interviews")
      .select('id, "organizationId", status, "livekitRoom", "round1Context", "aiTokensUsed"')
      .eq("id", roundTwoId)
      .maybeSingle();
    if (!round || round.status !== "live") return { ok: false, reason: "not_live", message: "Interview is not live." };
    if ((round.aiTokensUsed as number) >= TOKEN_BUDGET) {
      return { ok: false, reason: "budget", message: "This interview has used its AI budget (ROUND2_AI_TOKEN_BUDGET)." };
    }
    const { data: segs } = await supabaseAdmin
      .from("round_two_transcript")
      .select('"speakerRole", "speakerName", text, "startMs"')
      .eq("roundTwoId", roundTwoId)
      .order("startMs", { ascending: false })
      .limit(120);
    const segments = (segs ?? []).reverse() as { speakerRole: string; speakerName: string | null; text: string }[];
    const candidateText = segments.filter((x) => x.speakerRole === "candidate").map((x) => x.text).join("\n");
    const words = candidateText.split(/\s+/).filter(Boolean).length;
    if (words < (trigger === "manual" ? 15 : MIN_WORDS)) {
      return { ok: false, reason: "too_early", message: "Not enough candidate answers to score yet." };
    }
    const transcript = segments
      .map((x) => `${x.speakerRole === "candidate" ? "Candidate" : x.speakerName || "Interviewer"}: ${x.text}`)
      .join("\n");

    const codeText = await latestCodeContext(roundTwoId).catch(() => "");
    const r = await callJson<Record<string, unknown>>({
      organizationId: round.organizationId as string,
      task: "round2_scoring",
      maxTokens: 900,
      temperature: 0.2,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            round1ContextPrompt((round.round1Context ?? {}) as Round1Context),
            codeText,
            `Live transcript (latest last):\n${clip(transcript, 14_000)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      signal: AbortSignal.timeout(45_000),
    });
    const scoring = verifyLiveScoring(normalizeLiveScoring(r.data), candidateText);

    await Promise.all([
      supabaseAdmin
        .from("round_two_interviews")
        .update({ aiTokensUsed: (round.aiTokensUsed as number) + r.tokens, updatedAt: new Date().toISOString() })
        .eq("id", roundTwoId),
      supabaseAdmin.from("round_two_ai_events").insert({ roundTwoId, kind: "scores", trigger, payload: scoring }),
    ]);
    const panel = (await listRoomIdentities(round.livekitRoom as string)).filter((i) => i.startsWith(USER_IDENTITY_PREFIX));
    await sendToIdentities(round.livekitRoom as string, panel, DATA_TOPICS.copilot, { roundTwoId, trigger, kind: "scores" });
    return { ok: true, scoring };
  } catch (err) {
    log.error("live scoring failed", roundTwoId, err instanceof Error ? err.message : err);
    return { ok: false, reason: "error", message: await recordAiError(roundTwoId, "scoring", err, trigger) };
  } finally {
    state.lastRun.set(roundTwoId, Date.now());
    state.running.delete(roundTwoId);
  }
}

/** Called after each automatic copilot run; scores at most once per MIN_GAP_MS. */
export function maybeRunLiveScoring(roundTwoId: string): void {
  if (!liveScoringEnabled()) return;
  if (Date.now() - (state.lastRun.get(roundTwoId) ?? 0) < MIN_GAP_MS) return;
  void runLiveScoring(roundTwoId, "turn");
}
