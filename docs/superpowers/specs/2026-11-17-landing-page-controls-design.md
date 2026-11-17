# Landing Page Controls design

Superadmins edit the marketing site (resiliencesoftinterview.com, repo `SkillMark-LandingPage`)
from `/admin/landing` in the SkillMark app.

## Goals

- **Simple mode:** show or hide, reorder, duplicate and delete sections; edit their text, images, links and lists; add sections from the library of existing landing components.
- **Advanced mode:** custom sections built from blocks, per-section and per-block styles, device visibility, scoped CSS, pages (create, rename, SEO, delete), global settings (brand, contact, nav, footer, SEO, accent), and a raw JSON editor.
- **Workflow:** an autosaved draft, a live preview of the real site, Publish with a note, and version history with restore.
- **Delivery:** the site fetches published content at runtime, and Publish also triggers the landing deploy workflow so the content is baked into the build.

## Data model

One JSON `SiteDocument` (zod schema in `landingpage_connection/shared/schema.ts`):

```
SiteDocument { schemaVersion, settings, nav, footer, pages[] }
Page        { id, slug ('' = home), title, seo, sections[] }
Section     { id, type, hidden, props, style, blocks[] }   type = preset key | 'custom'
Block       { id, type, props, style, children[] }
```

- **Presets.** Each preset declares a field list (`text`, `textarea`, `url`, `image`, `icon`, `number`, `boolean`, `select`, `list`, `stringList`). That one list drives both the zod props schema and the admin form, so the two cannot drift apart.
- **Defaults.** `defaults.ts` holds today's hardcoded landing content. A fresh install renders exactly like the current site.
- **Built-in pages.** About, Contact, Privacy, Terms and Status are pages whose main section is a non-editable preset. Custom sections can be added around them, the preset can be hidden, and SEO is editable.

Tables (`db/init/32-landing-content.sql`):

- `landing_draft`: one row with `content`, `updatedAt` and `updatedBy`.
- `landing_versions`: append-only, one row per publish with `version`, `content`, `note`, `publishedAt` and `publishedBy`.
- `landing_media`: one row per uploaded image (metadata only; the bytes live in app storage).

## Connection (`SkillMark/landingpage_connection/`)

- `shared/`: schema, field descriptors, presets, blocks, defaults, the fetch client and the preview message protocol. It is copied into `SkillMark-LandingPage/src/cms/shared` by `scripts/sync-to-landing.mjs`, which writes a hash file so drift can be detected (`--check`).
- `server/`: repository, the tRPC `landing` router (platform admins only), public handlers, media upload, preview tokens and the rebuild trigger.

App endpoints:

| Route | Purpose |
| --- | --- |
| `GET /api/public/landing` | Latest published document. CORS `*`, rate limited, ETag. |
| `GET /api/public/landing/preview?token=` | The draft, for "Preview in new tab" (signed token, expires after 30 minutes). |
| `GET /api/public/landing/media/:id` | Serves uploaded images (immutable cache). |
| `POST /api/admin/landing/media` | Multipart upload. Platform admins only. png, jpg, webp, avif or gif, up to 5 MB. |

## Landing site

- `ContentProvider` starts from `src/cms/snapshot.json` (written by `npm run cms:snapshot` at deploy time), falling back to the shared defaults. It then fetches the live document and swaps it in if it is newer.
- In preview mode (`?lp_preview=1` inside the admin iframe), the site never fetches. It renders the drafts that the admin posts, applies the admin's theme toggle, and reports section clicks back. Messages are accepted only from `VITE_ADMIN_ORIGIN`.
- `PageRenderer` maps section types to components. Hidden sections, and sections hidden on the current device, are skipped. Rich text and HTML blocks are sanitized with DOMPurify. Scoped CSS has `<` removed and is wrapped in `[data-lp-section="id"]`.
- A Vite plugin writes the snapshot's SEO title, description and Open Graph tags into `index.html`.

## Rebuild

Publishing schedules a GitHub `workflow_dispatch` of `deploy-landing.yml` after a 30-second debounce, so several quick publishes cause only one deploy. Settings come from env:

- `LANDING_DEPLOY_GITHUB_TOKEN`
- `LANDING_DEPLOY_REPO`
- `LANDING_DEPLOY_WORKFLOW` (default `deploy-landing.yml`)
- `LANDING_DEPLOY_REF` (default `main`)

The admin shows the status of the latest run. If the env vars are not set, rebuilds are skipped and the runtime fetch still delivers content.

## Error handling

- The server validates every draft save and publish. Errors report the path of the bad field.
- The site never goes blank: it tries live content, then the snapshot, then the defaults.
- Invalid live documents are ignored on the client.

## Testing

`tests/landing-*.test.ts` cover:

- schema validation and generating props schemas from field lists;
- migrating stored documents;
- the public handler's response shape, CORS and ETag;
- preview tokens;
- the rebuild debounce;
- scoped CSS cleaning.

Both repositories must pass typecheck.
