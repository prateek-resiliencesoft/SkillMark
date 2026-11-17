import { defaultSiteDocument } from './defaults'
import { migrateSiteDocument } from './migrate'
import type { SiteDocument } from './schema'

export type FetchSiteOptions = {
  /** Public API URL, e.g. https://app.../api/public/landing */
  url: string
  /** Optional If-None-Match from a previous fetch. */
  etag?: string | null
  /** Abort / timeout in ms. Default 4000. */
  timeoutMs?: number
  /** Built-in snapshot used when the network fails or returns nothing. */
  snapshot?: SiteDocument | null
  signal?: AbortSignal
}

export type FetchSiteResult = {
  document: SiteDocument
  etag: string | null
  /** Where the document came from. */
  source: 'live' | 'not-modified' | 'snapshot' | 'defaults'
  status: number
}

/**
 * Fetch the published landing document. Falls back to snapshot, then defaults.
 * Never throws for network/API failures — the landing site must not go blank.
 */
export async function fetchSiteDocument(opts: FetchSiteOptions): Promise<FetchSiteResult> {
  const snapshot = opts.snapshot ?? null
  const fallback = (): FetchSiteResult => ({
    document: snapshot ? migrateSiteDocument(snapshot) : defaultSiteDocument(),
    etag: null,
    source: snapshot ? 'snapshot' : 'defaults',
    status: 0,
  })

  if (!opts.url) return fallback()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.etag) headers['If-None-Match'] = opts.etag

    const res = await fetch(opts.url, {
      credentials: 'omit',
      headers,
      signal: controller.signal,
    })

    if (res.status === 304 && snapshot) {
      return { document: migrateSiteDocument(snapshot), etag: opts.etag ?? null, source: 'not-modified', status: 304 }
    }

    if (!res.ok) return fallback()

    const json = (await res.json()) as { data?: unknown }
    if (!json?.data) return fallback()

    return {
      document: migrateSiteDocument(json.data),
      etag: res.headers.get('ETag'),
      source: 'live',
      status: res.status,
    }
  } catch {
    return fallback()
  } finally {
    clearTimeout(timeout)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
