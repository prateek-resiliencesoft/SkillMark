/**
 * The public results API, described once. Route handlers, the OpenAPI
 * document, the docs page and the MCP tools all read from this list.
 */
import type { z } from "zod";
import type { ApiKeyScope } from "@/lib/api-scopes";
import {
  Candidate,
  CreateInviteBody,
  IdParams,
  Interview,
  Invite,
  ListCandidatesQuery,
  ListInterviewsQuery,
  ListSessionsQuery,
  Result,
  Session,
  Transcript,
  listOf,
  one,
} from "./schemas";

export type EndpointId =
  | "listSessions"
  | "getSession"
  | "getResult"
  | "getTranscript"
  | "listInterviews"
  | "listCandidates"
  | "createInvite";

export type EndpointDef = {
  id: EndpointId;
  method: "GET" | "POST";
  path: string;
  tag: "Sessions" | "Results" | "Transcripts" | "Interviews" | "Candidates" | "Invites";
  summary: string;
  description: string;
  scope: ApiKeyScope;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodObject;
  response: z.ZodType;
  componentName: string;
  successStatus: 200 | 201;
  /** Example values for path/query parameters (illustrative). */
  paramExamples?: Record<string, string | number>;
  /** Example request body (illustrative). */
  bodyExample?: unknown;
  /** Illustrative values only (not real data). */
  example: unknown;
  /** MCP tool name, if this endpoint is exposed as an MCP tool. */
  mcpTool?: string;
};

const SID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const IID = "0b9e8d7c-6b5a-4f49-8382-7160f5e4d3c2";
const CID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const exampleSession = {
  id: SID,
  interview_id: IID,
  interview_title: "Frontend Developer",
  candidate_id: CID,
  candidate_name: "Example Candidate",
  candidate_email: "candidate@example.com",
  status: "COMPLETED",
  end_reason: "COMPLETED",
  report_status: "ready",
  overall_score: 7.4,
  duration_seconds: 1260,
  started_at: "2026-11-10T09:00:00.000Z",
  completed_at: "2026-11-10T09:21:00.000Z",
  created_at: "2026-11-10T08:59:41.000Z",
};

export const ENDPOINTS: EndpointDef[] = [
  {
    id: "listSessions",
    method: "GET",
    path: "/sessions",
    paramExamples: { status: "COMPLETED", interview_id: IID, candidate_email: "candidate@example.com", from: "2026-11-01", to: "2026-11-30", limit: 20 },
    tag: "Sessions",
    summary: "List sessions",
    description:
      "Interview sessions in your organization, newest first. A session is one candidate's attempt at an interview. Use `next_cursor` to get the next page.",
    scope: "sessions:read",
    query: ListSessionsQuery,
    response: listOf(Session),
    componentName: "Session",
    successStatus: 200,
    example: { data: [exampleSession], next_cursor: "eyJ0IjoiMjAyNi0xMS0xMFQwODo1OTo0MS4wMDBaIn0" },
    mcpTool: "list_sessions",
  },
  {
    id: "getSession",
    method: "GET",
    path: "/sessions/{id}",
    paramExamples: { id: SID },
    tag: "Sessions",
    summary: "Get a session",
    description: "One session with its status, timing and report state.",
    scope: "sessions:read",
    params: IdParams,
    response: one(Session),
    componentName: "Session",
    successStatus: 200,
    example: { data: exampleSession },
    mcpTool: "get_session",
  },
  {
    id: "getResult",
    method: "GET",
    path: "/sessions/{id}/result",
    paramExamples: { id: SID },
    tag: "Results",
    summary: "Get a session result",
    description:
      "Scores, summary, recommendation, strengths and weaknesses from the session report. While the report is being made, `report_status` is `pending` or `generating` and the score fields are null.",
    scope: "results:read",
    params: IdParams,
    response: one(Result),
    componentName: "Result",
    successStatus: 200,
    example: {
      data: {
        session_id: SID,
        status: "COMPLETED",
        report_status: "ready",
        overall_score: 7.4,
        recommendation: "hire",
        summary: "Clear explanations of React state and testing. Less depth on performance tuning.",
        strengths: ["Explains trade-offs clearly", "Good testing habits"],
        weaknesses: ["Limited profiling experience"],
        key_insights: ["Has led a component library migration"],
        themes: ["React", "Testing"],
        criteria: [{ name: "Communication", score: 8, reasoning: "Structured, concise answers." }],
        questions: [
          {
            question: "How do you avoid unnecessary re-renders?",
            score: 7,
            evaluation: "Knows memoisation; did not mention profiling.",
            highlights: ["Mentioned useMemo and React.memo"],
            improvements: ["Measure before optimising"],
          },
        ],
        integrity: { disqualified: false, strikes: 0, events: [] },
      },
    },
    mcpTool: "get_result",
  },
  {
    id: "getTranscript",
    method: "GET",
    path: "/sessions/{id}/transcript",
    paramExamples: { id: SID },
    tag: "Transcripts",
    summary: "Get a session transcript",
    description: "The conversation in order, with `interviewer` and `candidate` roles.",
    scope: "transcripts:read",
    params: IdParams,
    response: one(Transcript),
    componentName: "Transcript",
    successStatus: 200,
    example: {
      data: {
        session_id: SID,
        messages: [
          { role: "interviewer", content: "Hi, thanks for joining. Shall we start?", timestamp: "2026-11-10T09:00:05.000Z" },
          { role: "candidate", content: "Yes, ready.", timestamp: "2026-11-10T09:00:09.000Z" },
        ],
      },
    },
    mcpTool: "get_transcript",
  },
  {
    id: "listInterviews",
    method: "GET",
    path: "/interviews",
    paramExamples: { active: "true", limit: 20 },
    tag: "Interviews",
    summary: "List interviews",
    description: "Interviews in your organization with session counts, newest first.",
    scope: "interviews:read",
    query: ListInterviewsQuery,
    response: listOf(Interview),
    componentName: "Interview",
    successStatus: 200,
    example: {
      data: [
        {
          id: IID,
          title: "Frontend Developer",
          description: null,
          mode: "VOICE",
          is_active: true,
          time_limit_minutes: 30,
          session_count: 12,
          completed_count: 9,
          created_at: "2026-11-01T10:00:00.000Z",
          updated_at: "2026-11-05T10:00:00.000Z",
        },
      ],
      next_cursor: null,
    },
    mcpTool: "list_interviews",
  },
  {
    id: "listCandidates",
    method: "GET",
    path: "/candidates",
    paramExamples: { interview_id: IID, email: "candidate@example.com", limit: 20 },
    tag: "Candidates",
    summary: "List candidates",
    description: "Invited candidates and where they are: invited, in progress, completed, abandoned or disqualified.",
    scope: "candidates:read",
    query: ListCandidatesQuery,
    response: listOf(Candidate),
    componentName: "Candidate",
    successStatus: 200,
    example: {
      data: [
        {
          id: CID,
          interview_id: IID,
          name: "Example Candidate",
          email: "candidate@example.com",
          phone: null,
          status: "completed",
          session_id: SID,
          invite_expires_at: "2026-11-17T08:00:00.000Z",
          created_at: "2026-11-09T08:00:00.000Z",
        },
      ],
      next_cursor: null,
    },
    mcpTool: "list_candidates",
  },
  {
    id: "createInvite",
    method: "POST",
    path: "/invites",
    bodyExample: {
      interview_id: IID,
      name: "Example Candidate",
      email: "candidate@example.com",
      phone: "+919876543210",
      send: { email: false, whatsapp: false },
    },
    tag: "Invites",
    summary: "Invite a candidate",
    description:
      "Creates a candidate and their personal interview link. Nothing is sent unless you set `send.email` or `send.whatsapp`; when set, the candidate really gets an email or WhatsApp message using your organization's delivery settings.",
    scope: "invites:write",
    body: CreateInviteBody,
    response: one(Invite),
    componentName: "Invite",
    successStatus: 201,
    example: {
      data: {
        candidate_id: CID,
        interview_id: IID,
        invite_url: "https://your-host.example/i/invite/abc123def456",
        expires_at: "2026-11-23T08:00:00.000Z",
        delivery: {},
      },
    },
  },
];

export function endpointById(id: EndpointId): EndpointDef {
  const e = ENDPOINTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown endpoint ${id}`);
  return e;
}
