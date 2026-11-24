import "server-only";
import { resolveTaskModels } from "@/lib/ai/registry";
import { createLogger } from "@/lib/logger";
import {
  isBugSeverity,
  normalizeBugKey,
  type BugSeverity,
  type TriageEventPayload,
} from "./types";

const log = createLogger("bug-triage/classify");

export type OpenBucketHint = {
  id: string;
  bugKey: string;
  title: string;
  severity: BugSeverity;
  summary: string;
};

export type ClassifyResult = {
  isBug: boolean;
  severity: BugSeverity;
  bugKey: string;
  title: string;
  summary: string;
  matchesBucketId: string | null;
};

const SYSTEM = `You triage product feedback and server error logs for SkillMark (AI interview platform).
Return ONLY compact JSON (no markdown) with keys:
isBug (boolean), severity ("info"|"warning"|"error"|"critical"), bugKey (kebab-case slug),
title (short), summary (1-3 sentences: what's happening + what to fix),
matchesBucketId (uuid of an existing bucket if same bug, else null).

Rules:
- Praise / feature requests with no failure → isBug=false, severity=info.
- Real failures → isBug=true. Prefer matching an existing bucket when same root cause.
- bugKey stable across wording (e.g. mic-permission-denied).`;

export async function classifyTriageEvent(opts: {
  source: string;
  payload: TriageEventPayload;
  openBuckets: OpenBucketHint[];
}): Promise<ClassifyResult> {
  const bucketsJson = JSON.stringify(
    opts.openBuckets.slice(0, 40).map((b) => ({
      id: b.id,
      bugKey: b.bugKey,
      title: b.title,
      severity: b.severity,
      summary: b.summary.slice(0, 200),
    })),
  );
  const user = [
    `Source: ${opts.source}`,
    `Payload: ${JSON.stringify(opts.payload).slice(0, 1500)}`,
    `Open buckets: ${bucketsJson}`,
  ].join("\n");

  try {
    const { provider, generatorModel } = await resolveTaskModels(null, "generate");
    const res = await provider.generateResponse({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      model: generatorModel,
      temperature: 0.1,
      maxTokens: 400,
    });
    const text = (res.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const parsed = parseClassifyJson(text);
    if (parsed) {
      const match =
        parsed.matchesBucketId && opts.openBuckets.some((b) => b.id === parsed.matchesBucketId)
          ? parsed.matchesBucketId
          : null;
      return { ...parsed, matchesBucketId: match };
    }
    log.warn("classify parse failed — heuristic fallback");
  } catch (err) {
    log.warn("classify AI failed — heuristic fallback", err);
  }
  return heuristicClassify(opts.source, opts.payload, opts.openBuckets);
}

function parseClassifyJson(text: string): ClassifyResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const severity = isBugSeverity(raw.severity) ? raw.severity : "warning";
    const isBug = raw.isBug !== false && severity !== "info" ? Boolean(raw.isBug ?? true) : Boolean(raw.isBug);
    const bugKey = normalizeBugKey(String(raw.bugKey || raw.title || "unspecified-bug"));
    const title = String(raw.title || bugKey).slice(0, 160);
    const summary = String(raw.summary || title).slice(0, 2000);
    const matchesBucketId =
      typeof raw.matchesBucketId === "string" && raw.matchesBucketId.length > 10 ? raw.matchesBucketId : null;
    return {
      isBug: isBug || severity === "error" || severity === "critical",
      severity: isBug === false && severity === "info" ? "info" : severity,
      bugKey,
      title,
      summary,
      matchesBucketId,
    };
  } catch {
    return null;
  }
}

function heuristicClassify(
  source: string,
  payload: TriageEventPayload,
  openBuckets: OpenBucketHint[],
): ClassifyResult {
  const msg = (payload.message || "").toLowerCase();
  const hint = (payload.severityHint || "").toLowerCase();
  let severity: BugSeverity = "info";
  if (source === "error_log") {
    if (hint === "critical") severity = "critical";
    else if (hint === "error") severity = "error";
    else if (hint === "warning") severity = "warning";
    else severity = "error";
  } else if (payload.rating != null && payload.rating <= 2) {
    severity = msg ? "error" : "warning";
  } else if (/\b(crash|bug|broken|error|fail|timeout|cannot|can't|unable)\b/i.test(msg)) {
    severity = "error";
  } else if (msg) {
    severity = "warning";
  }
  const isBug = severity !== "info" || Boolean(msg && source === "error_log");
  const bugKey = normalizeBugKey(
    source === "error_log"
      ? `${payload.category || "error"}-${(payload.message || "unknown").slice(0, 40)}`
      : `feedback-${(payload.message || "low-rating").slice(0, 40)}`,
  );
  const match = openBuckets.find((b) => b.bugKey === bugKey);
  return {
    isBug,
    severity,
    bugKey,
    title: (payload.message || bugKey).slice(0, 120),
    summary: payload.message || `Heuristic triage from ${source}`,
    matchesBucketId: match?.id ?? null,
  };
}
