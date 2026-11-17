/**
 * Trigger the landing-site GitHub Actions deploy workflow after publish.
 * Debounce is durable: we store rebuildAfter in the DB so serverless / multi-
 * instance deployments still fire exactly once when due.
 */
import type { Context } from '@/server/context'
import { getRebuildState, setRebuildState, type RebuildState } from './repository'

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

async function runDispatch(db: Context['supabase']) {
  const cfg = readRebuildConfig()
  if (!cfg) {
    await setRebuildState(db, {
      runId: null,
      status: 'skipped',
      startedAt: new Date().toISOString(),
      detail: 'LANDING_DEPLOY_GITHUB_TOKEN / LANDING_DEPLOY_REPO not set — runtime fetch still works.',
      rebuildAfter: null,
    })
    return
  }

  try {
    await setRebuildState(db, {
      runId: null,
      status: 'requested',
      startedAt: new Date().toISOString(),
      detail: 'Dispatching deploy workflow…',
      rebuildAfter: null,
    })
    const { runId, detail } = await dispatchWorkflow(cfg)
    await setRebuildState(db, {
      runId,
      status: runId ? 'queued' : 'requested',
      startedAt: new Date().toISOString(),
      detail,
      rebuildAfter: null,
    })
  } catch (err) {
    await setRebuildState(db, {
      runId: null,
      status: 'error',
      startedAt: new Date().toISOString(),
      detail: err instanceof Error ? err.message : String(err),
      rebuildAfter: null,
    })
  }
}

/**
 * Schedule a rebuild by writing rebuildAfter = now + debounce.
 * Any instance that later polls (rebuildStatus / publish) will dispatch when due.
 */
export async function scheduleRebuild(db: Context['supabase']): Promise<RebuildState> {
  const after = new Date(Date.now() + DEBOUNCE_MS).toISOString()
  return setRebuildState(db, {
    status: 'scheduled',
    detail: `Rebuild scheduled for ${after}`,
    rebuildAfter: after,
  })
}

/** If a scheduled rebuild is due, dispatch it. Safe to call on every status poll. */
export async function maybeDispatchDueRebuild(db: Context['supabase']): Promise<RebuildState> {
  const state = await getRebuildState(db)
  if (!state.rebuildAfter) return state
  if (Date.parse(state.rebuildAfter) > Date.now()) return state
  // Claim the slot so concurrent pollers don't double-dispatch.
  await setRebuildState(db, {
    ...state,
    rebuildAfter: null,
    status: 'requested',
    detail: 'Dispatching due rebuild…',
  })
  await runDispatch(db)
  return getRebuildState(db)
}

export async function pollRebuildStatus(db: Context['supabase']): Promise<RebuildState> {
  // Fire any due durable rebuild first.
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
