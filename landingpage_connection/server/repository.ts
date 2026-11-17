/**
 * Landing CMS persistence: draft, versions, media, rebuild status.
 * Uses the same PostgREST client as the rest of the platform admin.
 */
import { defaultSiteDocument } from '@landing/shared/defaults'
import { parseSiteDocument } from '@landing/shared/migrate'
import type { SiteDocument } from '@landing/shared/schema'
import type { Context } from '@/server/context'

type Db = Context['supabase']

export type LandingVersionRow = {
  id: string
  version: number
  content: SiteDocument
  note: string
  publishedAt: string
  publishedBy: string | null
  rebuildRunId: string | null
  rebuildStatus: string | null
}

export type LandingMediaRow = {
  id: string
  storageKey: string
  mime: string
  size: number
  width: number | null
  height: number | null
  alt: string
  fileName: string
  createdAt: string
  createdBy: string | null
}

export type RebuildState = {
  runId: string | null
  status: string
  startedAt: string | null
  updatedAt: string
  detail: string | null
}

export async function getDraft(db: Db): Promise<{ content: SiteDocument; updatedAt: string | null; updatedBy: string | null }> {
  const { data, error } = await db
    .from('landing_draft')
    .select('content, updatedAt, updatedBy')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) {
    return { content: defaultSiteDocument(), updatedAt: null, updatedBy: null }
  }

  const raw = data.content
  const empty = !raw || (typeof raw === 'object' && Object.keys(raw as object).length === 0)
  return {
    content: empty ? defaultSiteDocument() : parseSiteDocument(raw),
    updatedAt: (data.updatedAt as string) ?? null,
    updatedBy: (data.updatedBy as string) ?? null,
  }
}

export async function saveDraft(db: Db, content: SiteDocument, userId: string): Promise<SiteDocument> {
  const parsed = parseSiteDocument(content)
  const { error } = await db.from('landing_draft').upsert(
    {
      id: 1,
      content: parsed as never,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    },
    { onConflict: 'id' },
  )
  if (error) throw error
  return parsed
}

export async function discardDraft(db: Db, userId: string): Promise<SiteDocument> {
  const published = await getPublished(db)
  const content = published?.content ?? defaultSiteDocument()
  return saveDraft(db, content, userId)
}

export async function getPublished(db: Db): Promise<LandingVersionRow | null> {
  const { data, error } = await db
    .from('landing_versions')
    .select('id, version, content, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id as string,
    version: data.version as number,
    content: parseSiteDocument(data.content),
    note: (data.note as string) ?? '',
    publishedAt: data.publishedAt as string,
    publishedBy: (data.publishedBy as string) ?? null,
    rebuildRunId: (data.rebuildRunId as string) ?? null,
    rebuildStatus: (data.rebuildStatus as string) ?? null,
  }
}

export type LandingVersionMeta = Omit<LandingVersionRow, 'content'>

export async function listVersions(db: Db, limit = 50): Promise<LandingVersionMeta[]> {
  const { data, error } = await db
    .from('landing_versions')
    .select('id, version, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
    .order('version', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id as string,
    version: r.version as number,
    note: (r.note as string) ?? '',
    publishedAt: r.publishedAt as string,
    publishedBy: (r.publishedBy as string) ?? null,
    rebuildRunId: (r.rebuildRunId as string) ?? null,
    rebuildStatus: (r.rebuildStatus as string) ?? null,
  }))
}

export async function getVersion(db: Db, version: number): Promise<LandingVersionRow | null> {
  const { data, error } = await db
    .from('landing_versions')
    .select('id, version, content, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
    .eq('version', version)
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id as string,
    version: data.version as number,
    content: parseSiteDocument(data.content),
    note: (data.note as string) ?? '',
    publishedAt: data.publishedAt as string,
    publishedBy: (data.publishedBy as string) ?? null,
    rebuildRunId: (data.rebuildRunId as string) ?? null,
    rebuildStatus: (data.rebuildStatus as string) ?? null,
  }
}

export async function publish(
  db: Db,
  content: SiteDocument,
  note: string,
  userId: string,
): Promise<LandingVersionRow> {
  const parsed = parseSiteDocument(content)

  // Persist the draft first so discard/restore stays consistent.
  await saveDraft(db, parsed, userId)

  const latest = await getPublished(db)
  const nextVersion = (latest?.version ?? 0) + 1

  const { data, error } = await db
    .from('landing_versions')
    .insert({
      version: nextVersion,
      content: parsed as never,
      note: note.trim().slice(0, 500),
      publishedAt: new Date().toISOString(),
      publishedBy: userId,
    })
    .select('id, version, content, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
    .single()

  if (error) throw error

  return {
    id: data.id as string,
    version: data.version as number,
    content: parseSiteDocument(data.content),
    note: (data.note as string) ?? '',
    publishedAt: data.publishedAt as string,
    publishedBy: (data.publishedBy as string) ?? null,
    rebuildRunId: (data.rebuildRunId as string) ?? null,
    rebuildStatus: (data.rebuildStatus as string) ?? null,
  }
}

export async function restoreVersion(db: Db, version: number, userId: string): Promise<SiteDocument> {
  const row = await getVersion(db, version)
  if (!row) throw new Error(`Version ${version} not found`)
  return saveDraft(db, row.content, userId)
}

export async function listMedia(db: Db, limit = 100): Promise<LandingMediaRow[]> {
  const { data, error } = await db
    .from('landing_media')
    .select('id, storageKey, mime, size, width, height, alt, fileName, createdAt, createdBy')
    .order('createdAt', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as LandingMediaRow[]
}

export async function getMedia(db: Db, id: string): Promise<LandingMediaRow | null> {
  const { data, error } = await db
    .from('landing_media')
    .select('id, storageKey, mime, size, width, height, alt, fileName, createdAt, createdBy')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  return data as LandingMediaRow
}

export async function insertMedia(
  db: Db,
  row: Omit<LandingMediaRow, 'id' | 'createdAt'> & { id?: string },
): Promise<LandingMediaRow> {
  const { data, error } = await db
    .from('landing_media')
    .insert({
      id: row.id,
      storageKey: row.storageKey,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
      alt: row.alt,
      fileName: row.fileName,
      createdBy: row.createdBy,
    })
    .select('id, storageKey, mime, size, width, height, alt, fileName, createdAt, createdBy')
    .single()

  if (error) throw error
  return data as LandingMediaRow
}

export async function deleteMedia(db: Db, id: string): Promise<LandingMediaRow | null> {
  const existing = await getMedia(db, id)
  if (!existing) return null
  const { error } = await db.from('landing_media').delete().eq('id', id)
  if (error) throw error
  return existing
}

export async function getRebuildState(db: Db): Promise<RebuildState> {
  const { data } = await db
    .from('landing_rebuild')
    .select('runId, status, startedAt, updatedAt, detail')
    .eq('id', 1)
    .maybeSingle()

  return {
    runId: (data?.runId as string) ?? null,
    status: (data?.status as string) ?? 'idle',
    startedAt: (data?.startedAt as string) ?? null,
    updatedAt: (data?.updatedAt as string) ?? new Date().toISOString(),
    detail: (data?.detail as string) ?? null,
  }
}

export async function setRebuildState(
  db: Db,
  patch: Partial<Omit<RebuildState, 'updatedAt'>>,
): Promise<RebuildState> {
  const { data, error } = await db
    .from('landing_rebuild')
    .upsert(
      {
        id: 1,
        runId: patch.runId ?? null,
        status: patch.status ?? 'idle',
        startedAt: patch.startedAt ?? null,
        detail: patch.detail ?? null,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('runId, status, startedAt, updatedAt, detail')
    .single()

  if (error) throw error
  return {
    runId: (data.runId as string) ?? null,
    status: (data.status as string) ?? 'idle',
    startedAt: (data.startedAt as string) ?? null,
    updatedAt: data.updatedAt as string,
    detail: (data.detail as string) ?? null,
  }
}
