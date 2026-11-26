import { defaultSiteDocument } from './defaults'
import { SCHEMA_VERSION, siteDocumentSchema, type SiteDocument } from './schema'
import { validateSectionProps } from './validate-props'

function mergeWithDefaults(raw: Partial<SiteDocument> & { schemaVersion?: number }): SiteDocument {
  const base = defaultSiteDocument()
  const merged: SiteDocument = {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    nav: { ...base.nav, ...(raw.nav ?? {}) },
    footer: { ...base.footer, ...(raw.footer ?? {}) },
    pages: Array.isArray(raw.pages) && raw.pages.length > 0 ? raw.pages : base.pages,
  }
  merged.settings.socials = { ...base.settings.socials, ...(raw.settings?.socials ?? {}) }
  merged.settings.seo = { ...base.settings.seo, ...(raw.settings?.seo ?? {}) }
  return merged
}

/**
 * Bring a stored document up to the current schema version.
 * Malformed documents fall back to built-in defaults (never return invalid data).
 */
export function migrateSiteDocument(raw: unknown): SiteDocument {
  if (!raw || typeof raw !== 'object') return defaultSiteDocument()

  const doc = raw as Partial<SiteDocument> & { schemaVersion?: number }
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0

  if (version > SCHEMA_VERSION) {
    throw new Error(`Landing document schema ${version} is newer than this build (${SCHEMA_VERSION})`)
  }

  const merged = mergeWithDefaults(doc)
  const parsed = siteDocumentSchema.safeParse(merged)
  if (!parsed.success) return defaultSiteDocument()

  try {
    return validateSectionProps(parsed.data, { strict: false })
  } catch {
    return defaultSiteDocument()
  }
}

/** Strict parse used by the admin save/publish path. Throws with a readable path. */
export function parseSiteDocument(raw: unknown): SiteDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('(root): Document is required')
  }

  const doc = raw as Partial<SiteDocument> & { schemaVersion?: number }
  const version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0
  if (version > SCHEMA_VERSION) {
    throw new Error(`Landing document schema ${version} is newer than this build (${SCHEMA_VERSION})`)
  }

  const merged = mergeWithDefaults(doc)
  const result = siteDocumentSchema.safeParse(merged)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path?.join('.') || '(root)'
    throw new Error(`${path}: ${issue?.message ?? 'Invalid document'}`)
  }
  return validateSectionProps(result.data, { strict: true })
}
