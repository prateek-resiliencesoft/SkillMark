/**
 * tRPC router for Landing Page Controls. Mounted as `landing` on the app router.
 * Every procedure requires profiles.role = ADMIN (platformProcedure).
 */
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { defaultSiteDocument } from '@landing/shared/defaults'
import { siteDocumentSchema, type SiteDocument } from '@landing/shared/schema'
import { parseSiteDocument } from '@landing/shared/migrate'
import { writePlatformAudit } from '@/server/tenant'
import { platformProcedure, router } from '@/server/trpc'
import {
  discardDraft,
  getDraft,
  getPublished,
  getRebuildState,
  LandingDbError,
  listMedia,
  listVersions,
  publish,
  restoreVersion,
  saveDraft,
} from './repository'
import { removeLandingMedia } from './media'
import { buildPreviewApiUrl, buildPreviewTabUrl } from '@landing/shared/preview'
import { signPreviewToken } from './preview-token'
import { pollRebuildStatus, readRebuildConfig, scheduleRebuild } from './rebuild'

const documentInput = z.custom<SiteDocument>((v) => {
  const r = siteDocumentSchema.safeParse(v)
  return r.success
}, 'Invalid site document')

function badRequest(err: unknown): never {
  const message = err instanceof Error ? err.message : 'Invalid request'
  throw new TRPCError({ code: 'BAD_REQUEST', message })
}

export const landingRouter = router({
  /** Draft + published meta for the editor shell. */
  getDraft: platformProcedure.query(async ({ ctx }) => {
    const draft = await getDraft(ctx.supabase)
    let published = null
    let dbWarning: string | null = null
    try {
      published = await getPublished(ctx.supabase)
    } catch (err) {
      if (!(err instanceof LandingDbError)) throw err
      // Missing migration (relation does not exist) or transient PostgREST outage —
      // still open the editor on defaults instead of hanging the UI on a hard failure.
      dbWarning =
        /does not exist|42P01/i.test(err.message)
          ? 'Landing tables are missing. Apply db/init/32-landing-content.sql (npm run db:migrate), then reload.'
          : `Could not load published landing content: ${err.message}`
    }
    const rebuild = await getRebuildState(ctx.supabase)
    return {
      content: draft.content,
      updatedAt: draft.updatedAt,
      updatedBy: draft.updatedBy,
      published: published
        ? { version: published.version, publishedAt: published.publishedAt, note: published.note }
        : null,
      rebuild,
      rebuildConfigured: !!readRebuildConfig(),
      defaults: defaultSiteDocument(),
      dbWarning,
    }
  }),

  saveDraft: platformProcedure
    .input(z.object({ content: documentInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const content = await saveDraft(ctx.supabase, parseSiteDocument(input.content), ctx.user.id)
        return { content, savedAt: new Date().toISOString() }
      } catch (err) {
        badRequest(err)
      }
    }),

  discardDraft: platformProcedure.mutation(async ({ ctx }) => {
    const content = await discardDraft(ctx.supabase, ctx.user.id)
    void writePlatformAudit(ctx.supabase, {
      actorId: ctx.user.id,
      action: 'landing.discard_draft',
      targetType: 'landing',
      targetId: null,
    })
    return { content }
  }),

  publish: platformProcedure
    .input(z.object({ content: documentInput, note: z.string().max(500).default('') }))
    .mutation(async ({ ctx, input }) => {
      let version
      try {
        version = await publish(
          ctx.supabase,
          parseSiteDocument(input.content),
          input.note,
          ctx.user.id,
        )
      } catch (err) {
        badRequest(err)
      }

      // Rebuild must run after a successful publish even if audit logging fails.
      const rebuild = await scheduleRebuild(ctx.supabase)

      void writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: 'landing.publish',
        targetType: 'landing',
        targetId: String(version.version),
        meta: { note: input.note, version: version.version },
      })

      return {
        version: {
          version: version.version,
          publishedAt: version.publishedAt,
          note: version.note,
        },
        rebuild,
      }
    }),

  listVersions: platformProcedure.query(async ({ ctx }) => {
    return listVersions(ctx.supabase)
  }),

  restoreVersion: platformProcedure
    .input(z.object({ version: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      let content: SiteDocument
      try {
        content = await restoreVersion(ctx.supabase, input.version, ctx.user.id)
      } catch (err) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: err instanceof Error ? err.message : 'Version not found',
        })
      }
      void writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: 'landing.restore',
        targetType: 'landing',
        targetId: String(input.version),
        meta: { version: input.version },
      })
      return { content }
    }),

  listMedia: platformProcedure.query(async ({ ctx }) => {
    return listMedia(ctx.supabase)
  }),

  deleteMedia: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      let row
      try {
        row = await removeLandingMedia(ctx.supabase, input.id)
      } catch (err) {
        badRequest(err)
      }
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Media not found' })
      void writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: 'landing.media_delete',
        targetType: 'landing_media',
        targetId: input.id,
        meta: { fileName: row.fileName },
      })
      return { ok: true }
    }),

  /**
   * Signed token + URLs for opening the draft in a new tab on the landing origin.
   * Client must open `tabUrl` (HTML). `apiUrl` is what the landing site fetches.
   */
  createPreviewToken: platformProcedure
    .input(z.object({ slug: z.string().max(200).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await signPreviewToken(ctx.user.id)
        const expiresInSec = 30 * 60
        const landingOrigin = (
          process.env.NEXT_PUBLIC_LANDING_URL || 'https://resiliencesoftinterview.com'
        ).replace(/\/$/, '')
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
        const apiBase = appUrl
          ? `${appUrl}/api/public/landing`
          : 'https://app.resiliencesoftinterview.com/api/public/landing'
        return {
          token,
          expiresInSec,
          tabUrl: buildPreviewTabUrl({ landingOrigin, token, slug: input?.slug }),
          apiUrl: buildPreviewApiUrl({ apiBase, token }),
        }
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : 'Could not create preview token',
        })
      }
    }),

  rebuildStatus: platformProcedure.query(async ({ ctx }) => {
    return pollRebuildStatus(ctx.supabase)
  }),
})
