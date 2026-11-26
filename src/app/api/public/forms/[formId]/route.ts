import { checkRateLimit } from "@/lib/api-rate-limit";
import { clientIp } from "@/lib/client-ip";
import {
  appBaseUrl,
  createApplication,
  getFormByPublicId,
  parseSubmissionRequest,
  serializeFormSchema,
  submissionErrorResponse,
} from "@/server/integrations/applications";

export const runtime = "nodejs";

const SUBMIT_WINDOW_MS = 10 * 60_000;
const SUBMIT_MAX = 5;
const SUBMIT_KEYS_MAX = 10_000;
const FORM_ID_RE = /^frm_[a-z0-9]{8,40}$/;
const submits = new Map<string, number[]>();

function pruneSubmits(now: number) {
  submits.forEach((arr, key) => {
    if (!arr.length || now - arr[arr.length - 1] >= SUBMIT_WINDOW_MS) submits.delete(key);
  });
  // Still full of live keys: drop the oldest (Map keeps insertion order).
  for (const key of submits.keys()) {
    if (submits.size < SUBMIT_KEYS_MAX) break;
    submits.delete(key);
  }
}

function submitLimited(ip: string, formId: string): Response | null {
  const key = `${ip}|${formId}`;
  const now = Date.now();
  if (!submits.has(key) && submits.size >= SUBMIT_KEYS_MAX) pruneSubmits(now);
  const arr = (submits.get(key) ?? []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (arr.length >= SUBMIT_MAX) {
    const retry = Math.ceil((SUBMIT_WINDOW_MS - (now - arr[0])) / 1000);
    return Response.json(
      { error: { code: "RATE_LIMITED", message: `Too many submissions. Retry after ${retry}s.`, retry_after: retry } },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }
  arr.push(now);
  submits.set(key, arr);
  return null;
}

/** Public schema of a published form (no secrets, publishable id only). */
export async function GET(request: Request, { params }: { params: { formId: string } }) {
  const limited = checkRateLimit(`pubform:${clientIp(request)}`);
  if (limited) return limited;
  const form = await getFormByPublicId(params.formId);
  if (!form || form.status !== "published") {
    return Response.json({ error: { code: "NOT_FOUND", message: "Form not found or not published" } }, { status: 404 });
  }
  const schema = serializeFormSchema(form, appBaseUrl(request));
  return Response.json({
    data: {
      ...schema,
      endpoint: undefined,
      fields: form.fields.filter((f) => !f.hidden),
      settings: { successMessage: (form.settings as { successMessage?: string })?.successMessage ?? null, redirectToInterview: (form.settings as { redirectToInterview?: boolean })?.redirectToInterview !== false },
      interview: { title: (form.config as { title?: string })?.title ?? form.name, durationMinutes: (form.config as { durationMinutes?: number })?.durationMinutes ?? null },
    },
  });
}

/** Hosted-form submission (multipart). Rate limited per IP. */
export async function POST(request: Request, { params }: { params: { formId: string } }) {
  const ip = clientIp(request);
  const ipLimited = checkRateLimit(`pubform:${ip}`);
  if (ipLimited) return ipLimited;
  if (!FORM_ID_RE.test(params.formId)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "Form not found or not published" } }, { status: 404 });
  }
  const limited = submitLimited(ip, params.formId);
  if (limited) return limited;
  const form = await getFormByPublicId(params.formId);
  if (!form || form.status !== "published") {
    return Response.json({ error: { code: "NOT_FOUND", message: "Form not found or not published" } }, { status: 404 });
  }
  try {
    const input = await parseSubmissionRequest(request);
    // honeypot
    if (typeof input.answers["_hp"] === "string" && input.answers["_hp"]) {
      return Response.json({ error: { code: "REJECTED", message: "Submission rejected" } }, { status: 400 });
    }
    delete input.answers["_hp"];
    const app = await createApplication({ form, input, source: "hosted", ip, baseUrl: appBaseUrl(request) });
    return Response.json({
      data: {
        id: app.id,
        status: app.status,
        interview_url: app.interview_url,
        delivery: app.delivery,
      },
    }, { status: 201 });
  } catch (err) {
    return submissionErrorResponse(err);
  }
}
