/**
 * Print-ready session report used for the PDF live preview and capture.
 * Pure inline styles (no theme/dark-mode dependency) so html2canvas output is stable.
 * Every element marked data-pdf-block is a safe place to break between pages.
 */
import type { ReportData } from "@/lib/report-data";
import { scoreColor } from "@/lib/report-data";
import type { ReportTemplate } from "@/lib/report-template";
import type { ErrorLogSummary, SessionErrorEntry } from "@/lib/session-error-log";
import { forwardRef, type CSSProperties, type ReactNode } from "react";

export const MM_TO_PX = 96 / 25.4;

export interface ReportDocumentProps {
  data: ReportData;
  template: ReportTemplate;
  widthPx: number;
  errorLog?: { entries: SessionErrorEntry[]; summary: ErrorLogSummary } | null;
}

const REC_TEXT = { hire: "Recommended: Hire", maybe: "Maybe — review further", no: "Not recommended" } as const;
const REC_COLOR = { hire: "#16a34a", maybe: "#d97706", no: "#dc2626" } as const;

export const ReportDocument = forwardRef<HTMLDivElement, ReportDocumentProps>(function ReportDocument(
  { data, template, widthPx, errorLog },
  ref,
) {
  const { branding, format } = template;
  const accent = branding.accentColor;
  const fs = format.fontSize;
  const compact = format.style === "compact";
  const classic = format.style === "classic";
  const gap = compact ? 10 : 18;
  const font = classic ? "Georgia, 'Times New Roman', serif" : "Inter, 'Segoe UI', Arial, sans-serif";

  const card: CSSProperties = classic
    ? { borderTop: `2px solid ${accent}`, paddingTop: 8 }
    : compact
      ? { border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }
      : { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" };

  const H = ({ children }: { children: ReactNode }) => (
    <div
      style={{
        fontSize: fs + 3,
        fontWeight: 700,
        color: classic ? "#111827" : accent,
        marginBottom: compact ? 6 : 10,
        textTransform: classic ? "uppercase" : undefined,
        letterSpacing: classic ? 1 : undefined,
      }}
    >
      {children}
    </div>
  );
  const Bar = ({ score }: { score: number }) => (
    <div style={{ height: 8, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%`, height: "100%", background: scoreColor(score), borderRadius: 4 }} />
    </div>
  );

  const sections: Record<string, ReactNode> = {
    summary: data.summary ? (
      <div data-pdf-block style={card}>
        <H>Summary</H>
        <p style={{ margin: 0, whiteSpace: "pre-line", lineHeight: 1.55 }}>{data.summary}</p>
        {data.keyInsights.length > 0 && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {data.keyInsights.slice(0, 6).map((k, i) => <li key={i} style={{ marginBottom: 3 }}>{k}</li>)}
          </ul>
        )}
      </div>
    ) : null,
    scores: data.criteria.length || data.questions.length ? (
      <div data-pdf-block style={card}>
        <H>Scores at a glance</H>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130, paddingTop: 6 }}>
          {(data.criteria.length ? data.criteria.map((c) => ({ n: c.name, s: c.score })) : data.questions.map((q) => ({ n: `Q${q.index}`, s: q.score }))).slice(0, 14).map((x, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
              <div style={{ fontSize: fs - 2, fontWeight: 700, color: scoreColor(x.s) }}>{x.s}</div>
              <div style={{ width: "70%", height: `${x.s * 9}px`, background: scoreColor(x.s), borderRadius: "4px 4px 0 0", opacity: 0.85 }} />
              <div style={{ fontSize: fs - 3, color: "#6b7280", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{x.n}</div>
            </div>
          ))}
        </div>
      </div>
    ) : null,
    skills: data.criteria.length ? (
      <div data-pdf-block style={card}>
        <H>Skills &amp; competencies</H>
        {data.criteria.map((c, i) => (
          <div key={i} style={{ marginBottom: compact ? 6 : 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginBottom: 3 }}>
              <span>{c.name}</span>
              <span style={{ color: scoreColor(c.score) }}>{c.score}/10</span>
            </div>
            <Bar score={c.score} />
            {!compact && c.reasoning && <div style={{ fontSize: fs - 1.5, color: "#6b7280", marginTop: 3 }}>{c.reasoning}</div>}
          </div>
        ))}
      </div>
    ) : null,
    strengths: data.strengths.length || data.concerns.length ? (
      <div data-pdf-block style={{ display: "flex", gap }}>
        {([["Strengths", data.strengths, "#16a34a", "✓"], ["Concerns", data.concerns, "#d97706", "!"]] as const).map(([t, items, color, mark]) => (
          <div key={t} style={{ ...card, flex: 1, borderColor: classic ? undefined : `${color}55` }}>
            <H>{t}</H>
            {items.length === 0 && <div style={{ color: "#6b7280" }}>Nothing notable.</div>}
            {items.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                <span style={{ color, fontWeight: 700 }}>{mark}</span>
                <span>{s}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    ) : null,
    questions: data.questions.length ? (
      <div>
        <div data-pdf-block><H>Per-question details</H></div>
        {data.questions.map((q) => (
          <div key={q.index} data-pdf-block style={{ ...card, marginBottom: compact ? 6 : 10, borderLeft: classic ? undefined : `4px solid ${scoreColor(q.score)}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 600 }}>
              <span>Q{q.index}. {q.question}</span>
              <span style={{ color: scoreColor(q.score), whiteSpace: "nowrap" }}>{q.score}/10</span>
            </div>
            {q.answerExcerpt && !compact && (
              <div style={{ marginTop: 6, padding: "6px 10px", background: "#f9fafb", borderLeft: `2px solid ${accent}`, fontStyle: "italic", color: "#4b5563" }}>
                “{q.answerExcerpt}”
              </div>
            )}
            {q.evaluation && <div style={{ marginTop: 6, color: "#374151" }}>{q.evaluation}</div>}
          </div>
        ))}
      </div>
    ) : null,
    transcript: data.transcript.length ? (
      <div>
        <div data-pdf-block><H>Transcript</H></div>
        {data.transcript.map((m) => {
          const user = m.role === "USER";
          const when = m.timestamp
            ? new Date(m.timestamp).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "";
          return (
            <div key={m.id} data-pdf-block style={{ display: "flex", justifyContent: user ? "flex-end" : "flex-start", marginBottom: 6 }}>
              <div style={{ maxWidth: "78%", padding: "6px 10px", borderRadius: 8, background: user ? `${accent}14` : "#f3f4f6", border: user ? `1px solid ${accent}33` : "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: fs - 2.5, fontWeight: 700, color: user ? accent : "#6b7280" }}>
                  <span>{user ? "Candidate" : "Interviewer"}</span>
                  {when && <span style={{ fontWeight: 500, opacity: 0.75 }}>{when}</span>}
                </div>
                <div style={{ lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>
    ) : null,
    integrity: (
      <div data-pdf-block style={{ ...card, borderColor: data.disqualified ? "#fca5a5" : card.borderColor }}>
        <H>Integrity &amp; anti-cheat</H>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {Array.from({ length: data.maxStrikes }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 8, borderRadius: 4, background: i < data.integrityStrikes ? (data.disqualified ? "#ef4444" : "#f59e0b") : "#e5e7eb" }} />
          ))}
        </div>
        <div style={{ fontWeight: 600 }}>
          {data.integrityStrikes} of {data.maxStrikes} strikes{data.disqualified ? " — candidate disqualified" : ""}
        </div>
        {data.integrity.length === 0 ? (
          <div style={{ color: "#6b7280", marginTop: 4 }}>No integrity events recorded.</div>
        ) : (
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.integrity.map((e) => (
              <span key={e.label} style={{ padding: "2px 8px", borderRadius: 999, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                {e.label}: {e.count}
              </span>
            ))}
          </div>
        )}
      </div>
    ),
    errorLog: (
      <div data-pdf-block style={card}>
        <H>Error log</H>
        {!errorLog || errorLog.summary.total === 0 ? (
          <div style={{ color: "#6b7280" }}>No errors recorded.</div>
        ) : (
          <>
            <div style={{ marginBottom: 6 }}>
              {errorLog.summary.total} errors · {errorLog.summary.rateLimitHits} rate-limit hits · impact: <b>{errorLog.summary.impact}</b>
            </div>
            {errorLog.entries.slice(0, 15).map((e, i) => (
              <div key={e.id ?? i} style={{ fontSize: fs - 1.5, display: "flex", gap: 8, borderTop: "1px solid #f3f4f6", padding: "3px 0" }}>
                <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>{e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : ""}</span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{e.category}</span>
                <span style={{ color: "#374151" }}>{e.message}</span>
              </div>
            ))}
          </>
        )}
      </div>
    ),
    candidate: (
      <div data-pdf-block style={card}>
        <H>Candidate details</H>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {([
              ["Name", data.participantName],
              ["Email", data.participantEmail],
              ["Interview", data.title],
              ["Date", data.createdAt ? new Date(data.createdAt).toLocaleString() : null],
              ["Duration", data.durationMinutes != null ? `${data.durationMinutes} min` : null],
              ["Status", data.status],
              ["Objective", data.objective],
            ] as const)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "3px 10px 3px 0", color: "#6b7280", width: 110, verticalAlign: "top" }}>{k}</td>
                  <td style={{ padding: "3px 0" }}>{v}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    ),
  };

  return (
    <div
      ref={ref}
      style={{ width: widthPx, background: "#ffffff", color: "#111827", fontFamily: font, fontSize: fs, lineHeight: 1.4, padding: compact ? 20 : 32, boxSizing: "border-box" }}
    >
      {/* Branded header + hero */}
      <div data-pdf-block style={{ marginBottom: gap }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 12, borderBottom: `3px solid ${accent}` }}>
          {branding.logoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoDataUrl} alt="Logo" style={{ maxHeight: 44, maxWidth: 160, objectFit: "contain" }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: fs + 7, fontWeight: 800, color: classic ? "#111827" : accent }}>
              {branding.headerText || `${data.title} — Session report`}
            </div>
            {(branding.subheaderText || branding.headerText) && (
              <div style={{ color: "#6b7280" }}>{branding.subheaderText || `${data.title} — Session report`}</div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14, ...(classic ? {} : { background: `${accent}0d`, borderRadius: 12, padding: 14 }) }}>
          {data.overallScore !== null && (
            <svg width="96" height="96" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="9" />
              <circle
                cx="50" cy="50" r="42" fill="none" stroke={scoreColor(data.overallScore)} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={`${(data.overallScore / 10) * 263.9} 263.9`} transform="rotate(-90 50 50)"
              />
              <text x="50" y="52" textAnchor="middle" fontSize="24" fontWeight="700" fill="#111827" dominantBaseline="middle">
                {data.overallScore.toFixed(1)}
              </text>
              <text x="50" y="72" textAnchor="middle" fontSize="9" fill="#6b7280">out of 10</text>
            </svg>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: fs + 5, fontWeight: 700 }}>{data.participantName}</div>
            {data.recommendation && (
              <span style={{ display: "inline-block", marginTop: 4, padding: "3px 10px", borderRadius: 999, fontWeight: 700, color: REC_COLOR[data.recommendation], border: `1px solid ${REC_COLOR[data.recommendation]}`, background: `${REC_COLOR[data.recommendation]}14` }}>
                {REC_TEXT[data.recommendation]}
              </span>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              {([
                ["Duration", data.durationMinutes != null ? `${data.durationMinutes} min` : "—"],
                ["Questions", String(data.questionsAnswered)],
                ["Integrity strikes", `${data.integrityStrikes}/${data.maxStrikes}`],
                ["Date", data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "—"],
              ] as const).map(([k, v]) => (
                <div key={k} style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 10px", minWidth: 90 }}>
                  <div style={{ fontSize: fs - 2.5, color: "#6b7280" }}>{k}</div>
                  <div style={{ fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {template.sections
          .filter((s) => s.enabled && sections[s.id])
          .map((s) => <div key={s.id}>{sections[s.id]}</div>)}
      </div>
    </div>
  );
});
