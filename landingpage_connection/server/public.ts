import { createHash } from 'crypto'
import { checkRateLimit } from '@/lib/api-rate-limit'
import { defaultSiteDocument } from '@landing/shared/defaults'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getDraft, getPublished } from './repository'
import { readLandingMediaBytes } from './media'
import { verifyPreviewToken } from './preview-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, If-None-Match',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
}

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function etagFor(payload: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 16)
  return `"${hash}"`
}

export function landingOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

/** GET /api/public/landing — latest published SiteDocument (or defaults). */
export async function getPublishedLanding(request: Request): Promise<Response> {
  const limited = checkRateLimit(`publanding:${clientIp(request)}`)
  if (limited) {
    for (const [k, v] of Object.entries(CORS)) limited.headers.set(k, v)
    return limited
  }

  const published = await getPublished(supabaseAdmin)
  const document = published?.content ?? defaultSiteDocument()
  const body = {
    data: document,
    meta: {
      version: published?.version ?? 0,
      publishedAt: published?.publishedAt ?? null,
    },
  }
  const etag = etagFor(body.data)
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ...CORS, ETag: etag } })
  }

  return Response.json(body, {
    status: 200,
    headers: { ...CORS, ETag: etag },
  })
}

/** GET /api/public/landing/preview?token= — draft for "open in new tab". */
export async function getPreviewLanding(request: Request): Promise<Response> {
  const limited = checkRateLimit(`publandingpreview:${clientIp(request)}`, 30)
  if (limited) {
    for (const [k, v] of Object.entries(CORS)) limited.headers.set(k, v)
    return limited
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  const verified = token ? await verifyPreviewToken(token) : null
  if (!verified) {
    return Response.json({ error: 'Invalid or expired preview link' }, { status: 401, headers: CORS })
  }

  const draft = await getDraft(supabaseAdmin)
  return Response.json(
    { data: draft.content, meta: { preview: true, updatedAt: draft.updatedAt } },
    {
      status: 200,
      headers: {
        ...CORS,
        'Cache-Control': 'private, no-store',
      },
    },
  )
}

/** GET /api/public/landing/media/:id */
export async function getLandingMedia(
  _request: Request,
  params: { id: string },
): Promise<Response> {
  const limited = checkRateLimit(`publandingmedia:${clientIp(_request)}`, 120)
  if (limited) return limited

  const id = params.id?.trim()
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response('Not found', { status: 404 })
  }

  const result = await readLandingMediaBytes(supabaseAdmin, id)
  if (!result) return new Response('Not found', { status: 404 })

  return new Response(new Uint8Array(result.data), {
    status: 200,
    headers: {
      'Content-Type': result.row.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
