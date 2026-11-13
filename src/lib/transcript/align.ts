/**
 * Place transcribed candidate turns between the saved interviewer messages.
 * Pure (no I/O) so it can be unit-tested.
 */
export type TranscribedTurn = {
  speaker?: string;
  startSec?: number;
  afterLine?: number;
  text?: string;
};

export type AnchorMessage = { timestamp: string; questionId: string | null };

export type AlignedTurn = { text: string; timestamp: string; questionId: string | null };

const FALLBACK_GAP_MS = 60_000;

export function alignCandidateTurns(turns: TranscribedTurn[], anchors: AnchorMessage[]): AlignedTurn[] {
  const candidate = turns
    .filter((t) => String(t.speaker ?? "").toLowerCase() === "candidate")
    .map((t) => ({
      text: String(t.text ?? "").replace(/\s+/g, " ").trim(),
      afterLine: Number.isFinite(Number(t.afterLine)) ? Math.trunc(Number(t.afterLine)) : NaN,
    }))
    .filter((t) => t.text && !/^\[?inaudible\]?\.?$/i.test(t.text));

  // Clamp anchors to 0..N and keep them non-decreasing (turns are in spoken order).
  const n = anchors.length;
  let prev = 0;
  const withAnchor = candidate.map((t) => {
    let a = Number.isNaN(t.afterLine) ? prev : Math.min(Math.max(t.afterLine, 0), n);
    if (a < prev) a = prev;
    prev = a;
    return { ...t, anchor: a };
  });

  // Group by anchor so several turns after one question spread evenly in its gap.
  const groups = new Map<number, typeof withAnchor>();
  for (const t of withAnchor) {
    const g = groups.get(t.anchor) ?? [];
    g.push(t);
    groups.set(t.anchor, g);
  }

  const ts = anchors.map((a) => new Date(a.timestamp).getTime());
  const out: AlignedTurn[] = [];
  for (const [anchor, group] of Array.from(groups.entries()).sort((a, b) => a[0] - b[0])) {
    // anchor k (1-based) sits after anchors[k-1] and before anchors[k].
    const lo = anchor > 0 ? ts[anchor - 1] : (ts[0] ?? Date.now()) - FALLBACK_GAP_MS;
    const hi = anchor < n ? ts[anchor] : lo + FALLBACK_GAP_MS;
    const span = Math.max(hi - lo, group.length + 1);
    const questionId = anchor > 0 ? anchors[anchor - 1].questionId : (anchors[0]?.questionId ?? null);
    group.forEach((t, i) => {
      out.push({
        text: t.text,
        timestamp: new Date(lo + Math.max(1, Math.floor((span * (i + 1)) / (group.length + 1)))).toISOString(),
        questionId,
      });
    });
  }
  return out;
}
