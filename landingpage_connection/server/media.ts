import { nanoid } from '@/lib/id'
import { storage } from '@/lib/storage'
import type { Context } from '@/server/context'
import {
  deleteMedia,
  getMedia,
  insertMedia,
  mediaIsReferenced,
  type LandingMediaRow,
} from './repository'

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

/** Detect image type from magic bytes. Returns null when unrecognized. */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  // AVIF: ....ftypavif / avis / mif1
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii')
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'image/avif'
  }
  return null
}

/** Read PNG/JPEG width×height from the first few KB. Returns nulls when unknown. */
export function peekImageSize(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break
        const marker = buf[i + 1]!
        const len = buf.readUInt16BE(i + 2)
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
  if (file.buffer.length === 0) throw new Error('Empty file.')
  if (file.buffer.length > MAX_MEDIA_BYTES) throw new Error('Image must be 5 MB or smaller.')

  const detected = detectImageMime(file.buffer)
  if (!detected || !isAllowedMediaMime(detected)) {
    throw new Error('Only PNG, JPEG, WebP, AVIF and GIF images are allowed.')
  }
  // Declared MIME (when present) must match the bytes.
  if (file.mime && file.mime !== 'application/octet-stream' && file.mime !== detected) {
    throw new Error(`File contents look like ${detected}, not ${file.mime}.`)
  }

  const mime = detected
  const ext = ALLOWED_MIME[mime]!
  const id = crypto.randomUUID()
  const storageKey = `media/${id}.${ext}`
  const { width, height } = peekImageSize(file.buffer, mime)

  const { error } = await storage.from(LANDING_MEDIA_BUCKET).upload(storageKey, file.buffer, {
    contentType: mime,
    upsert: false,
  })
  if (error) throw new Error(error.message)

  try {
    return await insertMedia(db, {
      id,
      storageKey,
      mime,
      size: file.buffer.length,
      width,
      height,
      alt: (file.alt ?? '').slice(0, 300),
      fileName: (file.fileName || `${nanoid(8)}.${ext}`).slice(0, 200),
      createdBy: userId,
    })
  } catch (err) {
    // Don't leave an orphan object if metadata insert fails.
    await storage.from(LANDING_MEDIA_BUCKET).remove([storageKey]).catch(() => {})
    throw err
  }
}

export async function removeLandingMedia(
  db: Context['supabase'],
  id: string,
): Promise<LandingMediaRow | null> {
  if (await mediaIsReferenced(db, id)) {
    throw new Error(
      'This image is used in the draft or a published version. Remove it from the page first.',
    )
  }
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
