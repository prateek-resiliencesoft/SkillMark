/**
 * Trigger the landing-site GitHub Actions deploy workflow after publish.
 * Debounces rapid publishes so only one workflow runs.
 */
import type { Context } from '@/server/context'
import { getRebuildState, setRebuildState, type RebuildState } from './repository'

const DEBOUNCE_MS = 30_000

type Timer = ReturnType<typeof setTimeout>

let pending: Timer | null = null
let pendingDb: Context['supabase'] | null = null

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

  // workflow_dispatch returns 204 with no run id. Best-effort: look up the newest run.
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

export async function pollRebuildStatus(db: Context['supabase']): Promise<RebuildState> {
  const state = await getRebuildState(db)
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
  })
}

async function runDispatch(db: Context['supabase']) {
  const cfg = readRebuildConfig()
  if (!cfg) {
    await setRebuildState(db, {
      runId: null,
      status: 'skipped',
      startedAt: new Date().toISOString(),
      detail: 'LANDING_DEPLOY_GITHUB_TOKEN / LANDING_DEPLOY_REPO not set — runtime fetch still works.',
    })
    return
  }

  try {
    await setRebuildState(db, {
      runId: null,
      status: 'requested',
      startedAt: new Date().toISOString(),
      detail: 'Dispatching deploy workflow…',
    })
    const { runId, detail } = await dispatchWorkflow(cfg)
    await setRebuildState(db, {
      runId,
      status: runId ? 'queued' : 'requested',
      startedAt: new Date().toISOString(),
      detail,
    })
  } catch (err) {
    await setRebuildState(db, {
      runId: null,
      status: 'error',
      startedAt: new Date().toISOString(),
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Schedule a rebuild. Multiple calls within 30s collapse into one dispatch. */
export function scheduleRebuild(db: Context['supabase']): void {
  pendingDb = db
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    const d = pendingDb
    pendingDb = null
    if (d) void runDispatch(d)
  }, DEBOUNCE_MS)
}

/** Test helper — expose debounce constant. */
export const REBUILD_DEBOUNCE_MS = DEBOUNCE_MS
