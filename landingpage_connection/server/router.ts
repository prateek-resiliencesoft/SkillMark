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
  listMedia,
  listVersions,
  publish,
  restoreVersion,
  saveDraft,
} from './repository'
import { removeLandingMedia } from './media'
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
    const [draft, published, rebuild] = await Promise.all([
      getDraft(ctx.supabase),
      getPublished(ctx.supabase),
      getRebuildState(ctx.supabase),
    ])
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
    await writePlatformAudit(ctx.supabase, {
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

      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: 'landing.publish',
        targetType: 'landing',
        targetId: String(version.version),
        meta: { note: input.note, version: version.version },
      })

      scheduleRebuild(ctx.supabase)
      const rebuild = await getRebuildState(ctx.supabase)

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
      await writePlatformAudit(ctx.supabase, {
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
      const row = await removeLandingMedia(ctx.supabase, input.id)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Media not found' })
      await writePlatformAudit(ctx.supabase, {
        actorId: ctx.user.id,
        action: 'landing.media_delete',
        targetType: 'landing_media',
        targetId: input.id,
        meta: { fileName: row.fileName },
      })
      return { ok: true }
    }),

  /** Signed token for opening the draft in a new tab on the landing origin. */
  createPreviewToken: platformProcedure.mutation(async ({ ctx }) => {
    const token = await signPreviewToken(ctx.user.id)
    return { token, expiresInSec: 30 * 60 }
  }),

  rebuildStatus: platformProcedure.query(async ({ ctx }) => {
    return pollRebuildStatus(ctx.supabase)
  }),
})
