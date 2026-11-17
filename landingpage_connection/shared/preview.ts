/**
 * postMessage protocol between the admin editor iframe parent and the landing
 * site running with ?lp_preview=1. Both sides check origin.
 */
import type { SiteDocument } from './schema'

export const PREVIEW_SOURCE = 'skillmark-landing-preview' as const

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
