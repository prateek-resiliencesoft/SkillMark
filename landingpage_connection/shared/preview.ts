/**
 * postMessage protocol between the admin editor iframe parent and the landing
 * site running with ?lp_preview=1. Both sides check origin.
 *
 * Preview-in-new-tab contract (not the iframe):
 * 1. Admin opens buildPreviewTabUrl(...) on the marketing origin
 *    (`?lp_preview_token=<jwt>`).
 * 2. Landing ContentProvider reads that query param and fetches
 *    buildPreviewApiUrl(...) → GET /api/public/landing/preview?token=<jwt>.
 * 3. SkillMark verifies the JWT and returns the draft SiteDocument as JSON.
 *
 * Do not open the API URL in a browser tab — it returns JSON, not HTML.
 */
import type { SiteDocument } from './schema'

export const PREVIEW_SOURCE = 'skillmark-landing-preview' as const
/** Query param on the marketing site for "Preview tab". */
export const PREVIEW_TAB_TOKEN_PARAM = 'lp_preview_token' as const
/** Query param the public preview API expects. */
export const PREVIEW_API_TOKEN_PARAM = 'token' as const

/** Marketing-site URL that loads the draft via the public preview API. */
export function buildPreviewTabUrl(opts: {
  landingOrigin: string
  token: string
  /** Page slug without leading slash; empty/undefined → home. */
  slug?: string
}): string {
  const base = opts.landingOrigin.replace(/\/$/, '')
  const path = opts.slug?.replace(/^\/+|\/+$/g, '')
  const pathname = path ? `/${path}` : '/'
  return `${base}${pathname}?${PREVIEW_TAB_TOKEN_PARAM}=${encodeURIComponent(opts.token)}`
}

/**
 * Absolute URL for GET draft JSON.
 * `apiBase` should be like `https://app.example/api/public/landing` (no trailing slash).
 */
export function buildPreviewApiUrl(opts: { apiBase: string; token: string }): string {
  const base = opts.apiBase.replace(/\/$/, '')
  return `${base}/preview?${PREVIEW_API_TOKEN_PARAM}=${encodeURIComponent(opts.token)}`
}

export type PreviewOutbound =
  | { source: typeof PREVIEW_SOURCE; type: 'lp:ready' }
  | { source: typeof PREVIEW_SOURCE; type: 'lp:select'; sectionId: string; pageId: string }
  | { source: typeof PREVIEW_SOURCE; type: 'lp:scroll'; sectionId: string }

export type PreviewInbound =
  | { source: typeof PREVIEW_SOURCE; type: 'lp:document'; document: SiteDocument; pageSlug?: string }
  | { source: typeof PREVIEW_SOURCE; type: 'lp:theme'; theme: 'light' | 'dark' }
  | { source: typeof PREVIEW_SOURCE; type: 'lp:highlight'; sectionId: string | null }
  | { source: typeof PREVIEW_SOURCE; type: 'lp:ping' }

export function isPreviewMessage(data: unknown): data is PreviewInbound | PreviewOutbound {
  return !!data && typeof data === 'object' && (data as { source?: string }).source === PREVIEW_SOURCE
}

/** Landing → admin */
export function postToParent(
  msg: { type: PreviewOutbound['type'] } & Record<string, unknown>,
  parentOrigin: string,
) {
  if (typeof window === 'undefined' || !window.parent || window.parent === window) return
  window.parent.postMessage({ source: PREVIEW_SOURCE, ...msg }, parentOrigin)
}

/** Admin → landing iframe */
export function postToFrame(
  frame: HTMLIFrameElement | null,
  msg: { type: PreviewInbound['type'] } & Record<string, unknown>,
  targetOrigin: string,
) {
  frame?.contentWindow?.postMessage({ source: PREVIEW_SOURCE, ...msg }, targetOrigin)
}
