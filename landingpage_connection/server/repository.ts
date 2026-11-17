/**
 * Landing CMS persistence: draft, versions, media, rebuild status.
 * Uses the same PostgREST client as the rest of the platform admin.
 */
import { defaultSiteDocument } from '@landing/shared/defaults'
import { parseSiteDocument } from '@landing/shared/migrate'
import type { SiteDocument } from '@landing/shared/schema'
import type { Context } from '@/server/context'

type Db = Context['supabase']

export class LandingDbError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'LandingDbError'
  }
}

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
  /** When set and <= now, a rebuild dispatch is due (durable debounce). */
  rebuildAfter: string | null
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
  let content: SiteDocument
  try {
    const published = await getPublished(db)
    content = published?.content ?? defaultSiteDocument()
  } catch (err) {
    if (err instanceof LandingDbError) throw err
    throw err
  }
  return saveDraft(db, content, userId)
}

function mapVersionRow(data: Record<string, unknown>): LandingVersionRow {
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

/**
 * Latest published version, or null when none exist.
 * Throws LandingDbError on query failure so callers don't treat outages as "no publish".
 */
export async function getPublished(db: Db): Promise<LandingVersionRow | null> {
  const { data, error } = await db
    .from('landing_versions')
    .select('id, version, content, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new LandingDbError(error.message, error)
  if (!data) return null
  return mapVersionRow(data as Record<string, unknown>)
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

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '23505' || /duplicate key|unique/i.test(error.message ?? '')
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

  const noteText = note.trim().slice(0, 500)
  // Retry on version collisions from concurrent publishes.
  for (let attempt = 0; attempt < 5; attempt++) {
    const latest = await getPublished(db)
    const nextVersion = (latest?.version ?? 0) + 1

    const { data, error } = await db
      .from('landing_versions')
      .insert({
        version: nextVersion,
        content: parsed as never,
        note: noteText,
        publishedAt: new Date().toISOString(),
        publishedBy: userId,
      })
      .select('id, version, content, note, publishedAt, publishedBy, rebuildRunId, rebuildStatus')
      .single()

    if (!error && data) return mapVersionRow(data as Record<string, unknown>)
    if (!isUniqueViolation(error)) throw error
  }
  throw new Error('Could not allocate a publish version — please try again')
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

function mapRebuild(data: Record<string, unknown> | null | undefined): RebuildState {
  return {
    runId: (data?.runId as string) ?? null,
    status: (data?.status as string) ?? 'idle',
    startedAt: (data?.startedAt as string) ?? null,
    updatedAt: (data?.updatedAt as string) ?? new Date().toISOString(),
    detail: (data?.detail as string) ?? null,
    rebuildAfter: (data?.rebuildAfter as string) ?? null,
  }
}

export async function getRebuildState(db: Db): Promise<RebuildState> {
  const { data } = await db
    .from('landing_rebuild')
    .select('runId, status, startedAt, updatedAt, detail, rebuildAfter')
    .eq('id', 1)
    .maybeSingle()

  return mapRebuild(data as Record<string, unknown> | null)
}

export async function setRebuildState(
  db: Db,
  patch: Partial<Omit<RebuildState, 'updatedAt'>>,
): Promise<RebuildState> {
  const current = await getRebuildState(db)
  const { data, error } = await db
    .from('landing_rebuild')
    .upsert(
      {
        id: 1,
        runId: patch.runId !== undefined ? patch.runId : current.runId,
        status: patch.status !== undefined ? patch.status : current.status,
        startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
        detail: patch.detail !== undefined ? patch.detail : current.detail,
        rebuildAfter: patch.rebuildAfter !== undefined ? patch.rebuildAfter : current.rebuildAfter,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('runId, status, startedAt, updatedAt, detail, rebuildAfter')
    .single()

  if (error) throw error
  return mapRebuild(data as Record<string, unknown>)
}

/**
 * Atomically claim a due rebuild. Returns the claimed row, or null if nothing
 * is due / another caller already claimed it (conditional update).
 */
export async function claimDueRebuild(db: Db): Promise<RebuildState | null> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('landing_rebuild')
    .update({
      rebuildAfter: null,
      status: 'requested',
      detail: 'Dispatching due rebuild…',
      updatedAt: now,
    })
    .eq('id', 1)
    .not('rebuildAfter', 'is', null)
    .lte('rebuildAfter', now)
    .select('runId, status, startedAt, updatedAt, detail, rebuildAfter')
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapRebuild(data as Record<string, unknown>)
}

/** True if draft or latest published document references this media id/URL. */
export async function mediaIsReferenced(db: Db, mediaId: string): Promise<boolean> {
  const needle = `/api/public/landing/media/${mediaId}`
  const draft = await getDraft(db)
  const haystacks: string[] = [JSON.stringify(draft.content)]
  try {
    const published = await getPublished(db)
    if (published) haystacks.push(JSON.stringify(published.content))
  } catch {
    /* ignore — still check draft */
  }
  return haystacks.some((h) => h.includes(needle) || h.includes(mediaId))
}
