# Fix notes: interview start failures + abandoned-link reuse

Branch: `fix/interview-start-abandoned-links` (nothing committed, pushed or deployed; `.env*` untouched).

## 1. Interview fails after pre-flight ("could not start" + Retry)

### Root causes found

1. **`POST /api/session/start` was not idempotent.** The first call sets `interviewBeganAt`. Any second call returned `409 expired`. That covers a lost or timed-out response, a transient error after the write committed, or the Retry button. So a single hiccup turned into "This link has expired" on retry.
2. **The start write was unchecked.** If the update failed, the route still answered `ok`. The interview then ran "not begun", so heartbeats were ignored for staleness. The preflight-idle check (30 min since `lastActivityAt`) later marked it ABANDONED mid-interview on the next `getByToken` / `getById` / list read.
3. **No heartbeat between the start request and success.** The link guard only started after a successful start. If the start landed but the client saw an error, the session went heartbeat-stale after 20 s and was abandoned. The Retry button then could not recover it.
4. **The Retry button did not retry.** It cleared the error and re-mounted onboarding at step 1 (camera, mic and screen share again), then called start again, which hit cause 1.
5. **Rate-limit responses crashed the page.** A `429` from `checkRateLimit` has the body `{ error: { code, message } }`. The page put that object into state and rendered it, which threw "Objects are not valid as a React child" and showed the global "Something went wrong / Try again" boundary, again on every reset. Start was also limited at 60/min **per IP**, and batch drives often have many candidates behind one NAT IP.
6. **AI key chain (production logs).**
   - `GEMINI_API_KEY` held six comma-joined keys. `credentials.ts` and `registry.ts` treated the whole string as one key, so it failed with a 400 "empty body". The Gemini Live relay (`server/gemini-voice-relay.ts`) reads the same env var directly and had the same bug.
   - When every key failed, the error showed the **last** failure (that misleading 400) even though the org keys had failed with 429 quota.
   - On the interview screen, this shows up as the voice relay sending `Gemini connection failed: …` and the "Start Voice Interview" retry failing every time. Batch generation (`batch.generateCandidate`) hit the same chain.
7. **Hypothesis checked: "batch interviews with lazily or partially generated questions". Not confirmed.** `batch.generateCandidate` generates questions synchronously (3 attempts) **before** inserting the candidate. It deletes the interview if the question insert fails, and never creates an invite without questions. Nothing generates questions at start. The batch link is the AI key chain failing during generation and voice connect, plus batch drives being concurrent (same IP) and scheduled. A candidate who opens the link early and comes back more than 30 min later was preflight-stale, then ABANDONED, then "expired" (see part 2).

### Fixes

- `src/lib/session-link.ts`
  - New pure `decideStart(session, { retry })`:
    - not begun → `start`
    - begun, heartbeat fresh, `retry: true`, within `START_RETRY_WINDOW_MS` (10 min) → `resume` (idempotent)
    - begun with a stale heartbeat → `abandon_stale`
    - anything else → `expired` with its status. A **fresh tab** on a running interview is still refused, so the link stays one-time for everyone else.
  - New client helper `startSessionWithRetry()`:
    - Backs off 1 s / 2 s / 4 s on network errors, 5xx and 429, honouring `Retry-After` (capped at 10 s).
    - Flags every call after the first as `retry`.
    - Turns nested error bodies into a string.
    - Stops on `expired` and other 4xx.
- `src/app/api/session/start/route.ts`
  - Uses `decideStart`.
  - The first write is conditional (`interviewBeganAt IS NULL`) and checked. On failure or a lost race it returns 503, and the client retry re-reads the state.
  - A `resume` refreshes the heartbeat.
  - A stale session is abandoned and reported as `expired: ABANDONED`, so the client restarts it through part 2.
  - Rate limit is now per session (20/min) plus a generous per-IP limit (600/min).
- `src/app/i/invite/[token]/session/page.tsx`
  - The heartbeat guard is active from the **first start request**.
  - Start goes through `startSessionWithRetry`.
  - "Try again" re-calls start for the **same session** with `retry: true` instead of going back to onboarding.
  - A start that comes back `expired: ABANDONED` goes to the invite page for a fresh attempt.
- `src/lib/ai/key-chain.ts` (new, pure): `splitKeyList` (split, trim, dedupe), `isQuotaError` (moved from `registry.ts`, still re-exported there), and `keyChainExhaustedError`.
- `src/lib/ai/credentials.ts`: `envKeys()` replaces `envKey()`. Each comma-separated key in env key vars (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`, …) becomes its own chain entry. Same in `registry.ts`'s env-only resolver.
- `src/lib/ai/registry.ts`: `FailoverProvider` tracks quota failures per call. When the chain is exhausted and any key hit 429 / RESOURCE_EXHAUSTED, it throws `AI quota exhausted: …` with `status 429` instead of the last error.
- `server/gemini-voice-relay.ts`: env Gemini keys are split into separate failover entries. When Live connect exhausts the keys, it reports the same quota-aware message (`Gemini connection failed: AI quota exhausted …`).

## 2. Abandoned sessions: link stays usable

**Choice: restart cleanly, not resume.** Reopening the link creates a **fresh session for the same candidate record**:

- The abandoned session is kept for audit. It keeps `candidateId` and gets `supersededAt`, which is the same mechanism the recruiter's "Send new link" already uses.
- `candidates.sessionId` points at the new attempt.

Resume was rejected because the voice relay state, timer and transcript context are gone after an abandon. The abandoned attempt also already has its own (delayed) report scheduled.

The result:

- No duplicate candidate rows.
- The candidate shows the latest attempt's status everywhere (filters, batch counts, public API).
- The old attempt is still queryable by `candidateId`.

### Behaviour

| Linked session status | Before | After |
|---|---|---|
| ABANDONED (tab closed, heartbeat lost, idle during setup) | "This link has expired" | Same link starts a fresh attempt |
| COMPLETED | Thank-you / used | unchanged |
| DISQUALIFIED | Disqualified screen | unchanged |
| IN_PROGRESS and begun (another tab running) | "already used" | unchanged |
| Past recruiter `expiresAt` deadline (any non-completed status, including ABANDONED) | Expired | unchanged: deadline still applies |

### Fixes

- `src/lib/session-link.ts`: `canRestartFromLink(status)` (true only for ABANDONED) and `inviteSessionAction(status)` (`create` / `restart` / `reuse`). Header doc updated.
- `src/server/routers/session.ts` `createFromInvite`:
  - Runs `expireIfStale` on the linked session.
  - If it is ABANDONED, `supersedeAbandonedAttempt()` marks it `supersededAt` and clears `candidates.sessionId`. The clear is conditional on the old id, so two tabs can't both detach it.
  - The existing `create_invite_session` path then creates the new session, sets its media prefix and logs `link_opened`.
  - Every other status returns the existing session as before.
- `src/app/i/invite/[token]/page.tsx`: an ABANDONED session triggers `createFromInvite` instead of the expired screen. Past the deadline it shows the dated "expired" screen.
- `src/app/i/invite/[token]/session/page.tsx`: landing on an ABANDONED session (for example a reload after the pagehide abandon beacon) redirects to the invite page for a fresh attempt. An in-tab interruption shows "Your interview was interrupted" with a "Start the interview again" button.
- `src/components/session/candidate-end-screens.tsx`: optional `onRestart` on `LinkExpiredScreen`.
- `src/server/routers/candidate.ts` (org-wide candidates list): the walk-in query now excludes sessions with a `candidateId`. Superseded attempts (retakes and "Send new link") no longer appear as extra walk-in rows. The per-interview list already did this.

Not changed: recruiter "Send new link" still works for abandoned candidates (`needsFreshInviteLink` still returns true for ABANDONED). That is now optional, because the existing link also works.

## Tests and checks

- New `tests/session-start.test.ts` covers:
  - abandoned-link reuse vs. other statuses
  - `decideStart`: start, same-tab resume, fresh-tab refused, outside the window, stale, ended statuses
  - `startSessionWithRetry`: network/5xx retries with the retry flag, 429 with `Retry-After` and nested error text, expired stop, 4xx stop, Retry button
- New `tests/ai-env-keys.test.ts` covers:
  - `splitKeyList`
  - a six-key `GEMINI_API_KEY` becoming six env entries
  - the quota-aware exhaustion message
  - `FailoverProvider` over a 429 → 403 → 400 chain reporting quota with status 429
  - `isQuotaError`
- Both added to `test:web` in `package.json`.
- `npm run test:web`: **426 pass, 0 fail**.
- `npm run typecheck` (`tsc --noEmit`, includes `server/`): **clean**.
- `npm run lint`: **0 errors**. Only warnings that were already there in untouched code; touched files lint clean.

## Manual verification

1. **Multi-key env:** set `GEMINI_API_KEY=k1,k2,k3` locally. Start a generation (batch "Generate" or AI interview generator). Logs show `gemini/env#1 → #2 → #3` as separate chain entries. With quota-exhausted keys, the error reads `AI quota exhausted: …` and the Error Log shows status 429.
2. **Voice relay:** run `npm run dev:voice:gemini` with comma-joined env keys and an org with no Gemini key. Each env key is tried in order (`Gemini Live (env key) failed … trying next key`).
3. **Idempotent start:** in DevTools, set the network to Offline right after clicking "Start interview" at the end of onboarding, then go back Online.
   - The page retries automatically, or shows "Could not start interview". Clicking "Try again" enters the **same** session (same `sessionId` in the network tab, `resumed: true` if the first call had landed). It does not show "expired" and does not repeat onboarding.
4. **One-time link still holds:** while an interview runs in tab A, open the same invite link in tab B. Tab B shows "already been used".
5. **Abandoned reuse:**
   - Start an interview, answer a question, close the tab. The session becomes ABANDONED via the beacon or after 20 s without a heartbeat.
   - Reopen the link. Onboarding starts again on a new session.
   - In the DB, the old session has `status = ABANDONED`, `supersededAt` set and `candidateId` = the same candidate. `candidates.sessionId` = the new session, and there is still exactly one candidate row.
6. **Deadline still applies:** set the candidate's `expiresAt` in the past on an abandoned candidate and open the link. You get "This link has expired … expired on <date>".
7. **Admin:** the candidates page "Abandoned" / "In progress" filters, batch counts and the candidate drawer show the latest attempt. There are no duplicate walk-in rows for superseded attempts, and reports still open for both attempts.

---

# Pass 2: session status rules (pre-flight, abandon, quit)

Still nothing committed, pushed or deployed; `.env*` untouched.

## Rules now enforced

| Moment | Event | Result |
|---|---|---|
| Pre-flight (link opened, info, photo, mic / screen checks). No `interviewBeganAt`. | Leave, close tab, reload, network loss, idle for hours | Session stays `IN_PROGRESS`, `interviewBeganAt` null (pending). Never `ABANDONED`. Same link keeps working. |
| Interview begun (`/api/session/start` set `interviewBeganAt`) | Tab closed (`pagehide` beacon), heartbeat lost (20 s), idle sweep | `ABANDONED` (link reusable, previous pass) |
| Interview begun | Candidate presses End Interview | `COMPLETED` + `endReason = "QUIT"` (link not reusable) |

**Signal used for "interview started":** `sessions.interviewBeganAt` (migration 18, set once by `/api/session/start`). No new column.

## Changes

### Pre-flight can't abandon
- `src/lib/session-link.ts`: new `isInterviewBegun` and `canAbandon` (status `IN_PROGRESS` and begun).
- `src/lib/session-link-server.ts`:
  - `abandonSession()` now refuses a session that is not begun. Every caller (abandon beacon, heartbeat, start, lazy expiry) goes through it.
  - `expireIfStale()` no longer uses `isPreflightStale`. That check used to abandon a setup session after 30 minutes of quiet. That was the pre-flight → Abandoned path.
- `src/lib/session-report-server.ts` `closeIdleSessions()`:
  - The query only takes sessions with `interviewBeganAt` set. Quiet setup sessions also no longer fill the 50-row batch.
  - Per-row guard for old DBs without the column: skipped when there is no `interviewBeganAt` and no messages.
- `src/lib/preflight.ts`: a quiet setup session is labelled "Not Started" (was "Abandoned"). `isPreflightStale` is display-only now.
- `src/lib/session-link.ts` `needsFreshInviteLink`: a quiet setup session no longer needs a new link.
- `src/server/new-invite-link.ts`: "Send new link" only flips a session to `ABANDONED` when the interview had begun. A pre-flight session is just superseded.
- `src/app/i/invite/[token]/session/page.tsx`:
  - `isEnding` now also returns true until the start is confirmed.
  - No local "interrupted" cut-off and no abandon beacon before the interview is confirmed started. A start that landed with a lost response goes heartbeat-stale server-side and restarts cleanly.
- `src/app/(dashboard)/candidates/page.tsx`: the Not started / In progress / Abandoned filters use the displayed label.

### Quit
- **No migration.** `sessions.endReason` already exists (migration 18). Value `"QUIT"` on a `COMPLETED` session is the tag. `end_reason` is already exposed by the public API.
- Client (distinguishes quit from disconnect):
  - `voice-interface.tsx`: the End Interview dialog button calls `handleEndInterview("quit")`.
  - The timer expiry and the interviewer's goodbye (auto-close) call it without a reason, so they stay normal completions.
  - `use-voice.ts`: `completeSession("quit")` remembers the reason. Every completion path then carries `reason: "quit"`: `/api/voice/save`, the `/api/session/complete` fallback, the final beacon body, and the `pagehide` beacon.
  - `beaconBodies()` takes an optional `reason` and puts it on the final body only.
  - `beforeunload` / `pagehide` / heartbeat loss never send `quit`. They go to `/api/session/abandon` or the heartbeat path, which abandon only when begun.
- Server: `completionEndReason()` in `session-link.ts`. `/api/voice/save` (`logic.ts`) and `/api/session/complete` write `endReason: "QUIT"` for `reason: "quit"`.
  - If the interviewer had already said goodbye (`interviewReachedClosing`), it is stored as a normal `COMPLETED`.
  - A repeat completion can't overwrite an existing quit, because `COMPLETED` is terminal.
  - Reports: still scheduled via the same `scheduleSessionReport` path. `decideReport` is unchanged for `COMPLETED`, so a quit session gets a report from whatever was answered. No lines at all is skipped as before.
- Reviewer UI: new `QuitEarlyBadge` ("Quit early", `src/components/candidates/quit-early-badge.tsx`). It shows in:
  - candidates page status column (and the zh label)
  - interview candidate manager
  - candidate detail sheet
  - results/report header note (`sessionStatusNote` now takes `endReason`)
  - admin org activity list and detail
- Not shown on the batches page: its explicit session select doesn't include `endReason` and I didn't add a column that older DBs may lack.

## Left as is
- `expiresAt` deadline behaviour unchanged.
- Chat (non-voice) interviews have no End/Quit button, so no quit path there.
- Pre-flight sessions of a candidate whose link was rotated by "Send new link" stay `IN_PROGRESS` and orphaned. They are superseded and detached, and the sweep ignores them.
- `notifySessionCompleted` also fires for a quit session (it is `COMPLETED`).

## Tests and checks
- New `tests/session-statuses.test.ts` (added to `test:web`):
  - pre-flight leave / reload / idle does not abandon (`canAbandon`, heartbeat, label, link reuse, `decideStart`, `needsFreshInviteLink`)
  - started + heartbeat loss abandons
  - abandoned link reusable
  - explicit quit → `COMPLETED` + `QUIT`, report scheduled, normal completion untagged, quit after goodbye untagged, repeat completion doesn't overwrite
  - completed and quit links not reusable
  - quit tag on the final beacon body only
- Updated `tests/preflight.test.ts` (quiet setup is "Not Started" and needs no new link).
- `npm run test:web`: **441 pass, 0 fail**.
- `npx tsc --noEmit` / `npm run typecheck`: **clean**.
- `npm run lint`: **0 errors**, only warnings that were already there.
- The DB-touching sweep (`closeIdleSessions`) and API routes are not covered by automated tests (no DB harness); the guards are in the shared pure helpers they call.

## Manual verification
1. **Pre-flight leave:** open an invite link, get to the photo / mic step, close the tab. In the DB the session is `IN_PROGRESS`, `interviewBeganAt IS NULL`. Wait past 30 min (or set `lastActivityAt` back) and run the sweep. It stays `IN_PROGRESS`. The dashboard shows "Not Started" / "Setting up". Reopen the link: you continue and the interview starts normally. Same session id.
2. **Pre-flight offline / reload:** reload during the screen-share step, or toggle DevTools offline for 1 minute. No "interrupted" screen, no `ABANDONED`.
3. **Started + disconnect:** start the interview, then close the tab. Within ~20 s it becomes `ABANDONED`, `endReason TAB_CLOSED` or `DISCONNECTED`. Reopening the link starts a fresh attempt (previous pass).
4. **Quit:** during a voice interview click End Interview, then confirm.
   - The session is `COMPLETED`, `endReason = 'QUIT'`, and the link shows the thank-you / expired page, not a restart.
   - The candidates list, drawer, report header and admin org activity show a "Quit early" badge.
   - A report is generated if there are answers.
5. **Not a quit:** let the interviewer finish or the timer run out. `endReason = 'COMPLETED'`, no badge. Close the tab mid-interview. `ABANDONED`, no badge.

---

# Pass 3: left-interview WhatsApp follow-up review fixes (commit 9a3411e)

## Changes
1. **Timezone** — `followupExpiryParts(expiresAt, timeZone = "Asia/Kolkata")` in `src/lib/messaging/templates.ts`. No org/project timezone setting exists in DB or code (only per-request admin chart zones), so the default is `Asia/Kolkata`. Invalid zone falls back to the default. Narrow no-break space (U+202F) before AM/PM is replaced with a plain space. `followupBodyVariables(v, timeZone?)` passes it through. `2026-11-26T18:29:00Z` → `Nov 26, 2026` / `11:59 PM`.
2. **Wording** — body now says "Or you can restart your interview using this link: {{3}}". Same six variables, same order. **Template renamed to `left_interview_followup_v2`**: Meta delivers the text stored under the approved name, so sending the old name would still show "continue … where you left off". **Action: submit the new body to ResilioHub/Meta under `left_interview_followup_v2` and wait for approval before relying on the follow-up.** The Integrations page preview/copy text reads the constant, so it updates automatically.
3. **Dedupe** — new migration `db/init/37-followup-sent.sql` adds `candidates."followupSentAt"` and `"followupSentToken"`. New `src/server/followup-claim.ts`:
   - `claimFollowup`: one conditional `UPDATE … WHERE id AND inviteToken AND (followupSentToken IS NULL OR followupSentToken <> inviteToken) RETURNING id`. Only a returned row means "send". A rotated invite link has a new token, so it can get one more follow-up.
   - `releaseFollowup`: clears our claim when the send fails or throws, so a later abandon retries.
   - Old DB without the columns (`42703` / `PGRST204`): logs "apply 37-followup-sent.sql" and **skips the send** (chosen over sending un-deduped paid messages).
   - Claim runs after every other skip check (phone, contact number, expiry, ResilioHub config), so skipped cases never burn the claim.
4. **Phone normalisation** — `normalizeWhatsappPhone` in `templates.ts`: strip spaces/()/-; `00…` → `+…`; 10-digit `[6-9]…` → `+91…`; 12 digits starting `91` → `+…`; must end up `+` and 8-15 digits, else null (skip). Applied to candidate phone and `supportPhone` in the follow-up. `project.update` now validates and stores the normalised `supportPhone` (accepts e.g. `9876543210`). Settings page helper text: the follow-up is only sent when a contact number is set.
5. **Indentation** — fixed the misleading `.catch` in `abandonSession` (`src/lib/session-link-server.ts`).

## Migration
- Apply `db/init/37-followup-sent.sql` (idempotent, ends with `NOTIFY pgrst, 'reload schema'`). Not run by me.
- Until applied, the follow-up is skipped (logged), not sent.

## Tests and checks
- `tests/left-interview-followup.test.ts` updated: v2 name, restart wording (no "continue / left off"), Asia/Kolkata default, explicit/invalid zone, date rollover, `normalizeWhatsappPhone` cases.
- New `tests/left-interview-followup-claim.test.ts` (added to `test:web`): claim once, rotated token reclaim, release then retry, missing-column → unsupported, unsafe token refused.
- `npm run test:web` (run with `TZ=UTC`): **453 pass, 0 fail**.
- `npx tsc --noEmit`: **clean**.
- `npm run lint`: **0 errors**, only pre-existing warnings.
- Not covered: the DB-touching `notifyCandidateLeftInterview` itself (no DB harness); claim SQL semantics verified against a fake client only.

---

# Pass 4: parse-cv 504 / "Unexpected end of JSON input" (quota-exhausted AI keys)

## Root cause
- `extractCandidateProfile` looped **models × 3 prompt variants**, and every attempt was a `FailoverProvider` call that itself walked **every key**. With all Gemini keys at 429 that is keys × models × 3 calls, plus the OpenAI SDK's own 429 retries/backoff (default 2, honours `retry-after` up to 60s).
- Vision PDF extraction had a 120s fetch timeout per key, and the SDK clients had no timeout/`maxRetries` cap.
- Route `maxDuration = 120` > Caddy `response_header_timeout 90s` → Caddy sent an empty 504 → client `res.json()` threw.

## Changes
1. **Fail fast on quota/auth**
   - `src/lib/ai/key-chain.ts`: `isAuthError`, `classifyAiFailure` (→ `"quota" | "auth" | null`), `AI_QUOTA_MESSAGE` / `AI_AUTH_MESSAGE`. `keyChainExhaustedError(..., onlyQuotaOrAuth)` tags `code = AI_QUOTA_EXHAUSTED | AI_AUTH_FAILED` when **every** key failed with quota/auth (a mix with e.g. a 400 stays untagged, so retries that could help still happen).
   - `FailoverProvider` (`registry.ts`) computes that flag for `generateResponse` and `streamResponse`, and stops walking keys once the call's `signal` aborted.
   - `cv-profile.ts`: a classified quota/auth error is thrown immediately (no extra models/variants); calls pass `maxRetries: 0` + a per-call 40s signal.
   - `extract.ts`: vision clients use `maxRetries: 0`; one attempt per key; if every key was quota/auth it throws a tagged error. If a PDF has a text layer it still degrades to text + warning; with no text it throws so the route can report the real cause.
   - `resume-parse.ts` (`/api/ai/parse-resume`): a tagged exhausted chain skips the 2s/5s/10s backoff and reports `AI_QUOTA_MESSAGE`.
   - `batch.generateCandidate` (tRPC): stops its 3-attempt loop on quota/auth.
   - `GenerationParams` got `signal` and `maxRetries`; honoured by `CompatibleOpenAIProvider` and Anthropic (others ignore them, still bounded by between-attempt checks).
2. **Time budget**
   - `src/lib/ai/fail-fast.ts`: `PARSE_CV_BUDGET_MS = 75_000`, `AI_CALL_TIMEOUT_MS = 40_000`, `VISION_CALL_TIMEOUT_MS = 45_000`, `budgetSignal` (timeout + client-disconnect), `raceAbort` (response is sent at the budget even if something ignores the signal, e.g. pdf-parse), `describeAiFailure` (quota → **429**, auth → **503**, timeout → **504**, all JSON with `{ error, code, fileName }`).
   - `parse-cv/route.ts`: `maxDuration = 85`; whole file wrapped in the budget; unknown errors keep the old 502 JSON. The route takes **one file per request** (client pool = per-file isolation), so "partial results" = the other files' requests succeed independently and failed ones show their own error row.
3. **Client**: new `src/lib/fetch-json.ts` (`fetchJson`, `readJsonResponse`, `responseErrorMessage`, `HttpError`). Reads text first, tolerates empty/HTML bodies; 502/504/408 → "The server took too long…". Used in `bulk-cv-generator.tsx` (parse-cv, with "…process the CVs. Please try again with fewer files."), plus low-risk spots that did a bare `res.json()`: `ai-generator.tsx` (extract-text), `candidate-create-dialog.tsx` (parse-resume error path), `interview-results.tsx` (summarize error path).

## Other long routes behind the same proxy (noted)
- Caddy: only the `dev.` vhost sets `response_header_timeout 90s`; the main app block has no header timeout. Dev is where this showed.
- `/api/ai/generate`, `/api/ai/refine`, `/api/ai/parse-resume`: SSE, headers go out immediately → no proxy header timeout; no `maxDuration` set. Left as is.
- `/api/ai/summarize`: **mismatch remains** (`maxDuration = 300`, non-streaming JSON; `withReportTimeout` 5 min). On dev Caddy it would 504 after 90s while the report keeps generating (status polling already covers the UI; client now shows a readable message). Real fix = return 202 and generate in the background — not trivial, not done.
- `batch.generateCandidate` (tRPC, up to 3 generations of 8192 tokens): can also exceed 90s on slow providers; only the quota/auth fast-fail was added. Same for `session/retranscribe`, `storage/migration` (300).

## Tests / checks
- New `tests/ai-fail-fast.test.ts` (quota/auth classification, chain tagging incl. mixed cases, one-pass-over-chain with call counts, hung provider cut at budget → 504, signal-ignoring provider via `raceAbort`, parent abort, resume-parse no backoff) and `tests/fetch-json.test.ts` (empty 504, HTML 502, empty/non-JSON 200, server error/code, network failure). Both added to `test:web`.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (pre-existing warnings). `TZ=UTC npm run test:web`: 499 pass, 0 fail.
- Not covered automatically: `extractDocument` vision failover (`server-only` + sharp/pdf-parse imports) and the route itself (auth + DB).

## Known trade-offs
- Gemini quota is per model; the chain only tries the first model per key, so a key out of quota for `gemini-3.5-flash` is not retried on another Gemini model for this route (that retry was the main time sink).
- Vision quota/auth on a PDF with a text layer still returns text + warning, then profile extraction reports the quota error if it also fails.
