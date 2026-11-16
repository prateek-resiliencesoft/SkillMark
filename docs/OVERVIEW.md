# SkillMark — simple overview

Product name in the UI: **ResilienceSoft Interview**.  
Repo folder: **SkillMark**. Same app.

---

## What it is

Open-source **AI interview platform**.

1. Recruiter designs an interview (questions, chat / voice / video).
2. Shares a link with a candidate.
3. AI runs the interview, asks follow-ups, then writes scores and a report.

---

## How it works (big picture)

One **Next.js** app serves two sides:

| Who | What they do | Where |
|-----|----------------|-------|
| **Recruiter** | Login, build interviews, invite people, read reports | `/dashboard`, `/interviews`, … |
| **Candidate** | No account — open link and take interview | `/i/<slug>` or `/i/invite/<token>` |

Stack in short:

```text
Browser
  → Next.js (UI + API)     port 3000
       → PostgREST         port 3001
            → Postgres     port 5433
```

- **Auth:** own cookie/JWT login (not Supabase).
- **DB:** Postgres in Docker; app talks via PostgREST.
- **Files:** local `./storage` (or S3 / Backblaze if configured).
- **AI:** keys in Settings → AI, or in `.env` (Gemini / OpenAI / Anthropic / etc.).

Voice interviews need an extra relay process. Chat works without it.

---

## How to run (step by step)

### Need first

- Node.js **18+** and npm  
- **Docker** + Docker Compose  
- At least one **LLM API key** (for real interviews)

### Step 1 — Install packages

```bash
cd SkillMark
npm install
```

### Step 2 — Env file

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `POSTGRES_PASSWORD` — any strong password  
- `AUTH_SECRET` — 32+ chars (e.g. `openssl rand -hex 32`)  
- One AI key, e.g. `GEMINI_API_KEY=...` or `OPENAI_API_KEY=...`  
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

### Step 3 — Start database

```bash
npm run db:up
```

(same as `docker compose up -d`)

Starts **Postgres** + **PostgREST**. First boot applies SQL under `db/init/`.

If Docker fails with a permission error, your user may need the `docker` group, or run:

```bash
sudo docker compose up -d
```

### Step 4 — Start the app

```bash
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

- Register: `/register`  
- Login: `/login`

### Step 5 (optional) — Voice

Only if you want voice interviews (chat works without this):

```bash
npm run dev:voice
# or: npm run dev:openai-voice
# or: npm run dev:voice:gemini
```

---

## First use flow

1. Register → create account.  
2. Create an **organization** (company).  
3. Create an **interview** (manual or AI-generated).  
4. Share public link or invite a candidate.  
5. Candidate finishes → open results / report.

---

## Useful commands

| Command | What it does |
|---------|----------------|
| `npm run db:up` | Start Postgres + PostgREST |
| `npm run db:down` | Stop them |
| `npm run dev` | Start Next.js |
| `npm run typecheck` | TypeScript check |
| `npm run test:web` | Unit tests |

---

## Want more detail?

See [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) for deeper architecture (auth, tRPC, roles, etc.).
