/**
 * Trigger the landing-site GitHub Actions deploy workflow after publish.
 * Debounce is durable: we store rebuildAfter in the DB so serverless / multi-
 * instance deployments still fire exactly once when due. Claiming uses a
 * conditional update + lease so concurrent pollers cannot double-dispatch and
 * abandoned claims can be retried.
 */
import type { Context } from '@/server/context'
import {
  claimDueRebuild,
  getRebuildState,
  setRebuildState,
  type RebuildState,
} from './repository'

const DEBOUNCE_MS = 30_000

export type RebuildConfig = {
  token: string
  repo: string // owner/name
  workflow: string
  ref: string
}

export function readRebuildConfig(): RebuildConfig | null {
  const token = process.env.LANDING_DEPLOY_GITHUB_TOKEN?.trim()
  const repo = process.env.LANDING_DEPLOY_REPO?.trim()
  if (!token || !repo) return null
  return {
    token,
    repo,
    workflow: process.env.LANDING_DEPLOY_WORKFLOW?.trim() || 'deploy-landing.yml',
    ref: process.env.LANDING_DEPLOY_REF?.trim() || 'main',
  }
}

async function dispatchWorkflow(cfg: RebuildConfig): Promise<{ runId: string | null; detail: string }> {
  const url = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: cfg.ref }),
  })

  if (res.status !== 204) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub workflow_dispatch failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const runId = await findLatestRunId(cfg).catch(() => null)
  return { runId, detail: `Dispatched ${cfg.workflow}@${cfg.ref}` }
}

async function findLatestRunId(cfg: RebuildConfig): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/runs?per_page=1&event=workflow_dispatch`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) return null
  const json = (await res.json()) as { workflow_runs?: { id: number }[] }
  const id = json.workflow_runs?.[0]?.id
  return id != null ? String(id) : null
}

/**
 * Write dispatch progress / outcome without erasing a newer rebuildAfter that
 * another publish may have scheduled while this dispatch was in flight.
 * Only clear the claim lease on terminal outcomes so abandoned claims stay reclaimable.
 */
async function setDispatchOutcome(
  db: Context['supabase'],
  patch: {
    runId: string | null
    status: string
    startedAt: string
    detail: string
  },
  opts: { clearClaim: boolean },
): Promise<void> {
  const current = await getRebuildState(db)
  const pending =
    current.rebuildAfter != null && Date.parse(current.rebuildAfter) > Date.now()
      ? current.rebuildAfter
      : null

  await setRebuildState(db, {
    runId: patch.runId,
    status: pending ? 'scheduled' : patch.status,
    startedAt: patch.startedAt,
    detail: pending
      ? `${patch.detail} Another rebuild is scheduled for ${pending}.`
      : patch.detail,
    rebuildAfter: pending,
    ...(opts.clearClaim ? { claimExpiresAt: null } : {}),
  })
}

async function runDispatch(db: Context['supabase']) {
  const cfg = readRebuildConfig()
  if (!cfg) {
    await setDispatchOutcome(
      db,
      {
        runId: null,
        status: 'skipped',
        startedAt: new Date().toISOString(),
        detail: 'LANDING_DEPLOY_GITHUB_TOKEN / LANDING_DEPLOY_REPO not set — runtime fetch still works.',
      },
      { clearClaim: true },
    )
    return
  }

  try {
    // Keep the claim lease while the GitHub call is in flight.
    await setDispatchOutcome(
      db,
      {
        runId: null,
        status: 'requested',
        startedAt: new Date().toISOString(),
        detail: 'Dispatching deploy workflow…',
      },
      { clearClaim: false },
    )
    const { runId, detail } = await dispatchWorkflow(cfg)
    await setDispatchOutcome(
      db,
      {
        runId,
        status: runId ? 'queued' : 'requested',
        startedAt: new Date().toISOString(),
        detail,
      },
      { clearClaim: true },
    )
  } catch (err) {
    await setDispatchOutcome(
      db,
      {
        runId: null,
        status: 'error',
        startedAt: new Date().toISOString(),
        detail: err instanceof Error ? err.message : String(err),
      },
      { clearClaim: true },
    )
  }
}

/**
 * Schedule a rebuild by writing rebuildAfter = now + debounce (durable).
 *
 * Dispatch is woken by, in order of reliability:
 * 1. `/api/cron/landing-rebuild` (GitHub Actions / external cron) — production path
 * 2. Admin `rebuildStatus` polling (while the editor is open)
 * 3. Best-effort in-process setTimeout (lost on restart / scale-to-zero)
 *
 * The DB row + atomic claim are the source of truth; timers never own the work.
 */
export async function scheduleRebuild(db: Context['supabase']): Promise<RebuildState> {
  const after = new Date(Date.now() + DEBOUNCE_MS).toISOString()
  const state = await setRebuildState(db, {
    status: 'scheduled',
    detail: `Rebuild scheduled for ${after}`,
    rebuildAfter: after,
  })
  // Opportunistic local wake only — durable path is cron + poll.
  setTimeout(() => {
    void maybeDispatchDueRebuild(db)
  }, DEBOUNCE_MS + 100)
  return state
}

/** If a scheduled rebuild is due (or an abandoned claim expired), claim and dispatch. */
export async function maybeDispatchDueRebuild(db: Context['supabase']): Promise<RebuildState> {
  const claimed = await claimDueRebuild(db)
  if (!claimed) return getRebuildState(db)
  await runDispatch(db)
  return getRebuildState(db)
}

export async function pollRebuildStatus(db: Context['supabase']): Promise<RebuildState> {
  let state = await maybeDispatchDueRebuild(db)

  const cfg = readRebuildConfig()
  if (!cfg || !state.runId || !['queued', 'in_progress', 'requested'].includes(state.status)) {
    return state
  }

  const url = `https://api.github.com/repos/${cfg.repo}/actions/runs/${state.runId}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) return state

  const json = (await res.json()) as { status?: string; conclusion?: string | null }
  const status = json.conclusion
    ? json.conclusion
    : json.status === 'completed'
      ? 'success'
      : (json.status ?? state.status)

  return setRebuildState(db, {
    runId: state.runId,
    status,
    startedAt: state.startedAt,
    detail: state.detail,
    rebuildAfter: state.rebuildAfter,
  })
}

export const REBUILD_DEBOUNCE_MS = DEBOUNCE_MS
