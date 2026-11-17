# Landing page connection

Shared schema, server handlers and sync tooling that link the SkillMark
superadmin panel (`/admin/landing`) to the marketing site
(`SkillMark-LandingPage` → resiliencesoftinterview.com).

## Layout

```
landingpage_connection/
  shared/     zod schema, presets, blocks, defaults, fetch client, preview protocol
              → copied into SkillMark-LandingPage/src/cms/shared
  server/     repository, tRPC router, public handlers, media, rebuild
  scripts/    sync-to-landing.mjs
```

## Env (SkillMark app)

| Variable | Purpose |
| --- | --- |
| `LANDING_DEPLOY_GITHUB_TOKEN` | GitHub token with `actions:write` on the landing repo |
| `LANDING_DEPLOY_REPO` | `owner/name` of the landing repo |
| `LANDING_DEPLOY_WORKFLOW` | Workflow file name (default `deploy-landing.yml`) |
| `LANDING_DEPLOY_REF` | Branch to dispatch (default `main`) |

Without these, Publish still goes live via the public API; only the background
rebuild is skipped.

## Env (landing site)

| Variable | Purpose |
| --- | --- |
| `VITE_LANDING_API_URL` | Public content API (default `…/api/public/landing`) |
| `VITE_ADMIN_ORIGIN` | Allowed postMessage origin for the admin iframe preview |
| `VITE_APP_URL` | Existing — default Get started URL |

## Sync

From the SkillMark repo:

```bash
node landingpage_connection/scripts/sync-to-landing.mjs
node landingpage_connection/scripts/sync-to-landing.mjs --check   # CI: fail on drift
```

Copies `shared/` → `../SkillMark-LandingPage/src/cms/shared` and writes
`.sync-hash`.

## Public endpoints

- `GET /api/public/landing` — published document (CORS `*`, ETag, rate limited)
- `GET /api/public/landing/preview?token=` — draft for “Preview in new tab”
- `GET /api/public/landing/media/:id` — uploaded images
- `POST /api/admin/landing/media` — multipart upload (platform admin)

## Migration

Apply `db/init/32-landing-content.sql` (or `npm run db:migrate`).
