# SkillMark project guide

A plain-language map of this repo, written for someone who already knows Flutter.

The product name in the UI is **ResilienceSoft Interview**. The repo folder is **SkillMark**. Same app.

Supabase is gone. The app uses Postgres, PostgREST, its own cookie login, and local disk (or S3) for files.

---

## 1. What this app is

A company designs an interview. They share a link. An AI asks the questions, follows up, and writes a score when the candidate finishes.

One Next.js process serves two experiences:

- **Recruiter app.** Login required. Build interviews, invite people, read reports.
- **Candidate app.** No account. Open a link and take the interview.

There is a third area, **platform admin** (`/admin`), for the people who operate the whole installation, not one company.

Flutter picture: one codebase that contains the company dashboard and the candidate exam screen, plus the server that both talk to. The database is a separate program.

---

## 2. Flutter mental model

| Flutter | This project |
|---|---|
| `Widget` | A React component. Most live in `src/components/`. |
| Screen in `GoRouter` | A file named `page.tsx`. The folder path is the URL. |
| `ShellRoute` (wrapper, not in the URL) | A folder whose name is in parentheses, like `(dashboard)`. |
| `redirect` / auth guard | `src/middleware.ts`, plus checks inside layouts. |
| `StatefulWidget` that runs on the device | A file whose first line is `"use client"`. |
| A screen built on the server before paint | A `page.tsx` without `"use client"`. |
| Retrofit / Chopper generated client | **tRPC**. UI calls `trpc.interview.list`, not a handwritten URL. |
| Riverpod `FutureProvider` + cache | **React Query**, wired up inside tRPC. |
| Token in secure storage | An **httpOnly cookie**. Page JavaScript cannot read it. The browser attaches it to every request. |
| Drift / sqflite | **Postgres**, running in Docker. |
| A thin REST API generated from the tables | **PostgREST** at `http://127.0.0.1:3001`. |
| Firebase Auth | This app’s own `/api/auth/*` routes. |

The UI and the API ship together. `npm run dev` starts both. Docker starts only the database and PostgREST.

---

## 3. The two people

### Recruiter (logged in)

Signs up, creates a company (“organization”), builds an interview, invites candidates, reads results.

Screens live under `src/app/(dashboard)/`. The `(dashboard)` part is not in the URL. `src/app/(dashboard)/interviews/page.tsx` is served at `/interviews`.

### Candidate (no account)

Opens `/i/<public-slug>` or `/i/invite/<token>`. Middleware does not send them to login.

Screens live under `src/app/i/`.

---

## 4. Recruiter story, step by step

1. Open `/register`. Submit email, password, and a display name (`full_name`).
2. The server inserts a row in `auth.users` and a matching row in `public.profiles`. Signup does **not** create a company. That rule is in `db/init/14-signup-no-auto-org.sql`.
3. The server sets a session cookie and the browser goes to `/dashboard`.
4. The dashboard layout loads memberships. Zero companies means redirect to `/org/new`.
5. The user names a company. They become `OWNER` of that organization.
6. If they belong to more than one company, `/organizations` asks which one is active. The choice is the cookie `sm_active_org`.
7. They create an interview: title, questions, AI tone, language, chat / voice / video, optional anti-cheat.
8. They share a public link (`/i/<publicSlug>`) or invite specific people. Invites can be typed in, imported from a spreadsheet, or parsed from PDF resumes.
9. The candidate finishes. The server asks the configured AI provider for a summary and scores.
10. The recruiter opens the interview results page.

Inside one company the roles are `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`. Higher includes lower. A viewer can look. An owner can manage the company. This is **not** the same as platform admin (`profiles.role = ADMIN`), which unlocks `/admin`.

---

## 5. Candidate story, step by step

1. Open the public link or the personal invite link.
2. Enter name and email when the interview asks for them. Invite-only interviews check the token or the email list.
3. A **session** row is created (`public.sessions`). Status starts as `IN_PROGRESS`. The browser remembers the session id in `localStorage` under `aural_session_<slug>` so a refresh can resume.
4. Optional checklist: camera photo, microphone, screen share. Anti-cheat, when enabled, watches tab switches, paste, and extra monitors, and appends those events to `sessions.antiCheatingLog`.
5. The interview runs in chat, voice, or video.
   - **Chat** stays inside Next.js. Messages go to `public.messages`. The model reply comes from `/api/ai/chat`.
   - **Voice** opens a WebSocket to a separate Node process (`server/voice-relay.ts`, or the OpenAI / Gemini variants). Next.js only issues a short-lived token from `/api/voice/token`.
6. Coding questions use a Monaco editor. Whiteboard questions use Excalidraw. Code can be executed through the OnlineCompiler API when `CODE_RUNNER_API_KEY` is set.
7. On finish, `/api/session/complete` marks the session `COMPLETED`. `/api/ai/summarize` writes `summary` and `insights` on the session.
8. Recordings, if any, are stored on disk or S3. A later cron (`/api/cron/purge-media`) can delete media after the review window.

The candidate never gets a `skillmark_session` cookie. Their access is the interview slug, the invite token, and the session id.

---

## 6. What must be running

```text
Browser
  → Next.js                         npm run dev          (port 3000)
       → PostgREST                  docker compose       (127.0.0.1:3001)
            → Postgres              docker compose       (127.0.0.1:5433)
```

| Process | How it starts | What breaks if it is down |
|---|---|---|
| Next.js | `npm run dev` | The website itself. |
| Postgres | `docker compose up -d` (service `db`) | Every read and write. |
| PostgREST | same compose file (service `rest`) | Next.js is up, but login and every query fail with `TypeError: fetch failed`. |
| Voice relay | `npm run dev:voice` (also `dev:openai-voice`, `dev:voice:gemini`) | Chat still works. Voice interviews cannot connect. |

`npm run dev` does **not** start Docker. `package.json` also exposes `npm run db:up`, which is `docker compose up -d`.

PostgREST is only bound to `127.0.0.1`. The browser never calls it. Only the Next.js server does. The URL is `POSTGREST_URL` in `.env`, default `http://127.0.0.1:3001`.

Files: `STORAGE_DIR` (default `./storage`) unless `S3_*` is set, in which case uploads go to S3-compatible storage such as Backblaze B2.

---

## 7. How a click becomes a database row

There are three styles of request. Learn these and the rest of the repo is navigation.

### A. Auth routes (handwritten HTTP)

Used for login, register, logout, “who am I”.

```text
Register form  (src/components/auth/register-form.tsx)
  → createClient().auth.signUp()          src/lib/supabase/client.ts
  → POST /api/auth/register                src/app/api/auth/register/route.ts
  → createUser()                           src/lib/users.ts
  → PostgREST insert into auth.users
  → Postgres trigger handle_new_user() inserts public.profiles
  → signSession() writes cookie skillmark_session
  → browser navigates to /dashboard
```

The body you send looks like:

```json
{
  "email": "user@user.com",
  "password": "12345678",
  "data": { "full_name": "ashwani" }
}
```

`full_name` is stored in `auth.users.raw_user_meta_data` and copied into `profiles.name`. The password is a bcrypt hash in `encrypted_password`. It is never stored as plain text.

`{"error":"TypeError: fetch failed"}` means step “PostgREST insert” never connected. The JSON shape is valid. The database proxy on port 3001 was not listening. Start Docker, then retry.

Login is the same path through `POST /api/auth/login`, except it compares the password with bcrypt instead of inserting a user.

The cookie:

- Name: `skillmark_session`
- Contents: an HS256 JWT signed with `AUTH_SECRET` (`src/lib/auth-session.ts`)
- Lifetime: 30 days
- `httpOnly`, so client JavaScript cannot read it
- `Secure` only when `NEXT_PUBLIC_APP_URL` starts with `https://`

Middleware (`src/middleware.ts`) reads that cookie on every page navigation (not on `/api` calls). No valid cookie on `/dashboard`, `/interviews`, `/settings`, and the other protected prefixes means redirect to `/login?next=...`.

### B. tRPC (almost every dashboard screen)

```text
Widget calls trpc.interview.list.useQuery()
  → POST /api/trpc/interview.list          cookie is sent automatically
  → src/app/api/trpc/[trpc]/route.ts
  → createContext() reads the cookie       src/server/context.ts
  → src/server/routers/interview.ts
  → supabase.from("interviews").select()   this is PostgREST, not Supabase
  → JSON back into the React Query cache
```

`src/components/providers.tsx` creates one tRPC client for the whole tree and points it at `/api/trpc`. That is the app-wide repository, like a Riverpod `ProviderScope`.

Procedure kinds in `src/server/trpc.ts`:

| Kind | Who can call it |
|---|---|
| `publicProcedure` | Anyone, including the candidate. |
| `protectedProcedure` | A valid session cookie. |
| `platformProcedure` | Session plus `profiles.role = ADMIN`. |

Org-scoped mutations also call `requireOrgAccess` in `src/server/tenant.ts`. That checks membership and blocks writes when the organization is paused.

Routers (one file each) are registered in `src/server/routers/_app.ts`:

`auth`, `interview`, `question`, `questionBank`, `session`, `code`, `analysis`, `organization`, `orgMember`, `project`, `apiKey`, `webhook`, `user`, `candidate`, `usage`, `batch`, `integration`, `interviewForm`, `aiSettings`, `platform`, `billing`, `status`.

### C. Public REST (`/api/v1`)

For other software (an ATS, a careers site), not for the React screens. Callers send an API key. Routes live under `src/app/api/v1/`. There is an OpenAPI document at `/api/v1/openapi.json`. MCP access for agents is `/api/mcp`.

---

## 8. Login, company, and the two cookies

Two different cookies. Mixing them up causes “why am I on the org picker again?”.

| Cookie | Set by | Holds | Cleared when |
|---|---|---|---|
| `skillmark_session` | Server, on login and register | Signed user id | Logout, or when the JWT fails verification |
| `sm_active_org` | Browser, when the user picks or creates a company | Organization id | Login, register, logout |

`sm_active_org` is readable by JavaScript on purpose. The server still checks that this user is a member of that id. A forged id does not grant access.

Dashboard layout (`src/app/(dashboard)/layout.tsx`) on every full page load:

1. No session → `/login`.
2. Session but zero organizations → `/org/new`.
3. Has organizations, but the active-org cookie is missing or stale → `/organizations?pick=1`.
4. Cookie matches a real membership → render the page inside the sidebar shell.

`/org/new` after the user already has a company requires `?create=1`. Otherwise they are sent back to the picker.

Client-side, `OrgProvider` loads the membership list and `OrgRequireGate` also bounces a user with zero orgs to `/org/new`. The layout is the one that matters on a full refresh. The gate covers client navigations.

Projects are folders inside an organization (`public.projects`). An interview can point at a `projectId`. Project membership is a second, finer access list.

---

## 9. Folder map

```text
src/app/                         screens. page.tsx = one URL.
  (auth)/                        /login  /register
  (dashboard)/                   recruiter app
  (admin)/admin/                 platform operator
  (docs)/docs/                   in-app help pages
  i/[slug]/                      public interview
  i/invite/[token]/              personal invite
  f/[formId]/                    public apply form
  api/                           HTTP endpoints
src/components/                  widgets
  auth/                          login and register forms
  layout/                        sidebar shell
  ui/                            buttons, cards, dialogs (the design system)
  session/                       live interview UI
src/server/                      backend that is not a page
  routers/                       tRPC feature modules
  tenant.ts                      org membership and platform-admin checks
  context.ts                     “who is calling” for every tRPC request
src/lib/                         shared helpers
  auth-session.ts                cookie JWT
  users.ts                       create / find / delete users
  supabase/admin.ts              PostgREST client (name is historical)
  supabase/client.ts             browser auth helper (calls /api/auth)
  ai/                            model providers and prompts
  voice/                         which voice relay to dial
server/                          voice WebSocket processes (not Next pages)
db/init/                         SQL applied the first time Postgres starts
docker-compose.yml               Postgres + PostgREST
tests/                           node:test files
```

Route groups in parentheses are layouts. They do not appear in the URL.

`(dashboard)` layout = “must be logged in, must have a company, wrap with sidebar.”

`(auth)` layout = the split login / register screen.

`(admin)` layout = platform admin chrome.

---

## 10. URL map

### Recruiter

| URL | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Middleware sends this to `/dashboard` or `/login`. |
| `/login`, `/register` | `src/app/(auth)/` | Sign in, sign up. |
| `/dashboard` | `(dashboard)/dashboard` | Home after login. |
| `/org/new` | `(dashboard)/org/new` | Name the first company. |
| `/organizations` | `(dashboard)/organizations` | Pick the active company. |
| `/interviews` | `(dashboard)/interviews` | List interviews. |
| `/interviews/new` | `(dashboard)/interviews/new` | Create one, including AI draft. |
| `/interviews/[id]/edit` | edit layout | Questions and content. |
| `/interviews/[id]/edit/settings` | settings page | Link, AI persona, channels, anti-cheat. |
| `/interviews/[id]/edit/sessions` | sessions page | Candidates and their sessions. |
| `/interviews/[id]/results` | results page | Scores and report. |
| `/candidates` | candidates page | People across interviews. |
| `/questions` | questions page | Question bank. |
| `/projects`, `/projects/[id]` | projects | Folders inside the company. |
| `/batches`, `/batches/[id]` | batches | Bulk invite groups. |
| `/integrations` | integrations | API keys, forms, webhooks. |
| `/settings` | settings | Company and personal settings. |
| `/account` | account | Password, profile, delete account. |
| `/usage` | usage | Quotas. |

### Candidate and public

| URL | Purpose |
|---|---|
| `/i/[slug]` | Landing: name, email, start or resume. |
| `/i/[slug]/session` | The live interview. |
| `/i/invite/[token]` | Same flow, locked to one invited person. |
| `/f/[formId]` | Hosted apply form (careers-site style). |
| `/docs/...` | Product docs rendered by the app. |

### Operator

| URL | Purpose |
|---|---|
| `/admin` | Platform home. |
| `/admin/organizations` | Every company on this installation. |
| `/admin/people` | Users. |
| `/admin/activity` | Audit. |
| `/admin/config` | Platform settings. |
| `/admin/status`, `/admin/server-logs` | Uptime and logs, when those integrations are configured. |

---

## 11. Data model

Postgres has two schemas.

### `auth` schema

`auth.users` is the login table: `id`, `email`, `encrypted_password`, `raw_user_meta_data` (JSON, holds `full_name`).

Defined in `db/init/00-auth.sql`.

A trigger `handle_new_user` copies `id`, `email`, and `full_name` into `public.profiles`. It does not create an organization.

### `public` schema

Core tables from `db/init/01-schema.sql`, plus later files in `db/init/` for billing, forms, question bank, and so on.

```text
auth.users
  └── profiles                      display name, platform role (USER / ADMIN / ENTERPRISE)

organizations
  └── organization_members          userId + role (OWNER / ADMIN / MEMBER / VIEWER)
  └── projects
        └── project_members
  └── interviews                    belongs to a user, optional project
        └── questions               ordered, typed
        └── candidates              invited people, inviteToken
        └── sessions                one attempt
              └── messages          USER / ASSISTANT / SYSTEM
```

Important interview fields:

- `mode`: `CHAT`, `VOICE`, or `HYBRID`
- `publicSlug`: the `/i/<slug>` link
- `requireInvite`: when true, a random visitor cannot start
- `aiPersona`, `aiName`, `aiTone` (`CASUAL`, `PROFESSIONAL`, `FORMAL`, `FRIENDLY`)
- `followUpDepth`: `LIGHT`, `MODERATE`, `DEEP`
- `llmProvider`, `llmModel`: which model runs this interview
- `antiCheatingEnabled`

Question types: `OPEN_ENDED`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `CODING`, `WHITEBOARD`, `RESEARCH`.

Session status: `IN_PROGRESS`, `COMPLETED`, `ABANDONED`.

Message content types: `TEXT`, `AUDIO`, `FILE`, `IMAGE`, `WHITEBOARD`, `CODE`.

Later tables worth knowing:

| Table | Why it exists |
|---|---|
| `interview_forms`, `applications` | Hosted apply forms and the submissions. |
| `interview_batches` | A group of invites sent together. |
| `question_bank_sections`, `question_bank_items` | Reusable questions, not tied to one interview. |
| `api_keys` | Keys for `/api/v1`. |
| `webhooks`, `org_integrations` | Outbound events, email, WhatsApp. |
| `organization_invites` | Invite a teammate into the company. |
| `session_error_logs` | Client errors during an interview. |
| `platform_settings` | Installation-wide flags. |

The Next.js code does not open a Postgres connection itself. `src/lib/supabase/admin.ts` builds a `PostgrestClient` pointed at `POSTGREST_URL`. Calls look like:

```ts
authDb.from("users").insert({ email, encrypted_password, raw_user_meta_data })
db.from("interviews").select("*").eq("id", id)
```

`authDb` is the same server with the schema set to `auth`. `db` / `supabaseAdmin.from` uses `public`.

SQL files in `db/init/` run only when the Docker volume is first created. Editing them later does nothing to an existing database. New changes need a migration, or a fresh volume.

---

## 12. AI, voice, files

### Which model answers

`src/lib/ai/` holds providers (OpenAI, Gemini, Anthropic, NVIDIA, and an OpenAI-compatible custom base URL). Keys come from the organization AI settings first, then from `.env` (`GEMINI_API_KEY`, `OPENAI_API_KEY`, and the others).

HTTP endpoints:

| Route | Job |
|---|---|
| `/api/ai/generate` | Draft an interview from a plain-language description. |
| `/api/ai/chat` | Next interviewer message during a session. |
| `/api/ai/summarize` | End-of-session report. |
| `/api/ai/refine` | Edit a draft. |
| `/api/ai/parse-resume` | Pull name, email, skills from a CV. |
| `/api/ai/extract-text` | Text from an uploaded document. |

Prompts live in `src/lib/ai/prompts/` (`interviewer`, `generator`, `summary`).

### Voice

The browser does not hold the provider API key. It asks `/api/voice/token` for permission, then opens a WebSocket to the relay process. `src/lib/voice/relay-routing.ts` picks the relay URL and can fail over from one relay to another.

Relay source files are in `server/`, not `src/server/`. They are started with the `dev:voice*` scripts. They are not part of `next dev`.

### Code runner

`src/server/code-runner/` sends candidate code to OnlineCompiler when `CODE_RUNNER_API_KEY` is set.

### Files

`src/lib/storage.ts` writes to disk or S3. The browser downloads through `/api/files/[bucket]/[...path]`.

---

## 13. Guards, in order

When you wonder “why did this page bounce me?”, walk this list.

1. **Middleware** (`src/middleware.ts`). Protected prefixes: `/dashboard`, `/interviews`, `/candidates`, `/questions`, `/projects`, `/organizations`, `/org`, `/settings`, `/account`, `/usage`, `/integrations`, `/admin`, `/batches`. Missing or bad cookie → `/login`. Already logged in on `/login` → `/dashboard`.
2. **Dashboard layout.** No org → `/org/new`. Org exists but no active cookie → `/organizations?pick=1`.
3. **tRPC `protectedProcedure`.** API returns “You need to sign in” if the cookie is missing. Middleware does not run on `/api`, so this check matters for data calls.
4. **`requireOrgAccess`.** Wrong company, or a role below the one the action needs, or the company is suspended.
5. **`platformProcedure`.** `/admin` data requires `profiles.role = ADMIN`.

Candidate pages skip 1–4. Their procedures are public and then check the slug, invite token, or session id inside the router.

---

## 14. Where to edit what

| You want to change… | Start here |
|---|---|
| Login or register form | `src/components/auth/` |
| Signup rules (email, password length) | `src/app/api/auth/register/route.ts` |
| How users are stored | `src/lib/users.ts` |
| Cookie lifetime or cookie name | `src/lib/auth-session.ts` |
| Who can open which page | `src/middleware.ts` |
| “Create a company first” behavior | `src/app/(dashboard)/layout.tsx` |
| Sidebar links | `src/components/layout/sidebar.tsx` |
| A recruiter screen | `src/app/(dashboard)/<same path>/page.tsx` |
| The live interview UI | `src/components/session/` and `src/app/i/` |
| A data query or mutation | `src/server/routers/<feature>.ts` |
| Role rules | `src/server/tenant.ts` and `src/server/trpc.ts` |
| Interviewer prompt | `src/lib/ai/prompts/interviewer.ts` |
| Tables | `db/init/*.sql` (only affects a new database volume) |
| Ports and secrets | `.env` (see `.env.example` for the key names) |

Button, card, input, and dialog primitives are in `src/components/ui/`. Feature screens compose those. They are the equivalent of a small design-system package inside the app.

---

## 15. Run it locally

From the repo root, after Docker is allowed to talk to your user:

```bash
docker compose up -d
npm install
npm run dev
```

App: `http://localhost:3000` (or whatever port Next prints).

`.env` in this checkout sets `NEXT_PUBLIC_APP_URL=http://localhost:3100`. The real listen port is whatever `npm run dev` binds. The URL value matters for links inside emails and for whether the session cookie is marked `Secure`.

Useful scripts in `package.json`:

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run db:up` / `db:down` | Start or stop Postgres and PostgREST. |
| `npm run db:psql` | SQL shell inside the database container. |
| `npm run typecheck` | `tsc --noEmit`. CI runs this. |
| `npm run test:web` | Unit tests under `tests/`. |
| `npm run dev:voice` | Voice WebSocket relay. |

First-time Docker failure on this machine is a permissions issue, not an app bug. The socket `/var/run/docker.sock` is `root:docker`. Your user must be in the `docker` group, or you run `sudo docker compose up -d`.

---

## 16. One request, drawn end to end

Register, the path that produced `TypeError: fetch failed`:

```text
Browser form
  POST /api/auth/register
    check email shape and password length (>= 8)
    createUser()
      find existing email via PostgREST
      bcrypt hash
      insert auth.users via PostgREST  http://127.0.0.1:3001
        Postgres trigger → public.profiles
    sign JWT
    Set-Cookie: skillmark_session
  200 { user }
Browser
  location = /dashboard
Middleware
  cookie valid → allow
Dashboard layout
  no organization_members row → redirect /org/new
```

If PostgREST is down, the insert throws `TypeError: fetch failed`. The route returns that string as `{ "error": "..." }` with status 400. Nothing was wrong with `full_name`.
