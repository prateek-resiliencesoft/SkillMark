import { nanoid } from '@/lib/id'
import { storage } from '@/lib/storage'
import type { Context } from '@/server/context'
import { deleteMedia, getMedia, insertMedia, type LandingMediaRow } from './repository'

export const LANDING_MEDIA_BUCKET = 'landing'
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024

const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

export function isAllowedMediaMime(mime: string): boolean {
  return mime in ALLOWED_MIME
}

/** Read PNG/JPEG width×height from the first few KB. Returns nulls when unknown. */
export function peekImageSize(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      // IHDR chunk: width/height are big-endian at bytes 16..23
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break
        const marker = buf[i + 1]!
        const len = buf.readUInt16BE(i + 2)
        // SOF0 / SOF2
        if (marker === 0xc0 || marker === 0xc2) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
        }
        i += 2 + len
      }
    }
  } catch {
    /* ignore */
  }
  return { width: null, height: null }
}

export async function uploadLandingMedia(
  db: Context['supabase'],
  file: { buffer: Buffer; mime: string; fileName: string; alt?: string },
  userId: string,
): Promise<LandingMediaRow> {
  if (!isAllowedMediaMime(file.mime)) {
    throw new Error('Only PNG, JPEG, WebP, AVIF and GIF images are allowed.')
  }
  if (file.buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('Image must be 5 MB or smaller.')
  }
  if (file.buffer.length === 0) {
    throw new Error('Empty file.')
  }

  const ext = ALLOWED_MIME[file.mime]!
  const id = crypto.randomUUID()
  const storageKey = `media/${id}.${ext}`
  const { width, height } = peekImageSize(file.buffer, file.mime)

  const { error } = await storage.from(LANDING_MEDIA_BUCKET).upload(storageKey, file.buffer, {
    contentType: file.mime,
    upsert: false,
  })
  if (error) throw new Error(error.message)

  return insertMedia(db, {
    id,
    storageKey,
    mime: file.mime,
    size: file.buffer.length,
    width,
    height,
    alt: (file.alt ?? '').slice(0, 300),
    fileName: (file.fileName || `${nanoid(8)}.${ext}`).slice(0, 200),
    createdBy: userId,
  })
}

export async function removeLandingMedia(
  db: Context['supabase'],
  id: string,
): Promise<LandingMediaRow | null> {
  const row = await deleteMedia(db, id)
  if (!row) return null
  await storage.from(LANDING_MEDIA_BUCKET).remove([row.storageKey])
  return row
}

export async function readLandingMediaBytes(
  db: Context['supabase'],
  id: string,
): Promise<{ row: LandingMediaRow; data: Buffer } | null> {
  const row = await getMedia(db, id)
  if (!row) return null
  const { data, error } = await storage.from(LANDING_MEDIA_BUCKET).download(row.storageKey)
  if (error || !data) return null
  const ab = await data.arrayBuffer()
  return { row, data: Buffer.from(ab) }
}

/** Public URL path the landing site and admin use in <img src>. */
export function publicMediaPath(id: string): string {
  return `/api/public/landing/media/${id}`
}
