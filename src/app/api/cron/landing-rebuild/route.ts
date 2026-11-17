import { createLogger } from '@/lib/logger'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { maybeDispatchDueRebuild } from '@landing/server/rebuild'

const log = createLogger('cron/landing-rebuild')

/**
 * Durable wake for landing publish rebuilds.
 * scheduleRebuild writes rebuildAfter to the DB; this cron claims due work and
 * dispatches GitHub Actions even if the publishing Node process is gone.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const state = await maybeDispatchDueRebuild(supabaseAdmin)
    log.info('landing rebuild tick', {
      status: state.status,
      rebuildAfter: state.rebuildAfter,
      runId: state.runId,
    })
    return Response.json({
      ok: true,
      status: state.status,
      rebuildAfter: state.rebuildAfter,
      runId: state.runId,
      detail: state.detail,
    })
  } catch (err) {
    log.error('landing rebuild tick failed', err)
    return Response.json({ error: 'Rebuild dispatch failed' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return POST(req)
}
