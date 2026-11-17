import { defaultSiteDocument } from './defaults'
import { SCHEMA_VERSION, siteDocumentSchema, type SiteDocument } from './schema'

/**
 * Bring a stored document up to the current schema version.
 * Unknown future versions are rejected so the site falls back to defaults/snapshot.
 */
export function migrateSiteDocument(raw: unknown): SiteDocument {
  if (!raw || typeof raw !== 'object') return defaultSiteDocument()

  const doc = raw as Partial<SiteDocument> & { schemaVersion?: number }
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0

  if (version > SCHEMA_VERSION) {
    throw new Error(`Landing document schema ${version} is newer than this build (${SCHEMA_VERSION})`)
  }

  // v0 / missing → wrap with defaults for any missing top-level keys.
  const base = defaultSiteDocument()
  const merged: SiteDocument = {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...(doc.settings ?? {}) },
    nav: { ...base.nav, ...(doc.nav ?? {}) },
    footer: { ...base.footer, ...(doc.footer ?? {}) },
    pages: Array.isArray(doc.pages) && doc.pages.length > 0 ? doc.pages : base.pages,
  }

  // Fill missing nested objects that older drafts may omit.
  merged.settings.socials = { ...base.settings.socials, ...(doc.settings?.socials ?? {}) }
  merged.settings.seo = { ...base.settings.seo, ...(doc.settings?.seo ?? {}) }

  const parsed = siteDocumentSchema.safeParse(merged)
  if (!parsed.success) {
    // Soft-fail: return merged defaults rather than blanking the site.
    // Callers that need strict validation should use siteDocumentSchema.parse.
    return merged
  }
  return parsed.data
}

/** Strict parse used by the admin save/publish path. Throws with a readable path. */
export function parseSiteDocument(raw: unknown): SiteDocument {
  const migrated = migrateSiteDocument(raw)
  const result = siteDocumentSchema.safeParse(migrated)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path?.join('.') || '(root)'
    throw new Error(`${path}: ${issue?.message ?? 'Invalid document'}`)
  }
  return result.data
}
