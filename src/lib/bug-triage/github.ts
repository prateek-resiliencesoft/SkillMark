/**
 * Dual GitHub auth: App installation token first, fine-grained PAT fallback.
 */
import { createLogger } from "@/lib/logger";
import { SignJWT, importPKCS8 } from "jose";

const log = createLogger("bug-triage/github");

export type GithubIssueRef = { number: number; htmlUrl: string };

type AuthMode = "app" | "pat";

function repoSlug(): string | null {
  const raw = (process.env.GITHUB_REPO || process.env.BUG_TRIAGE_GITHUB_REPO || "").trim();
  return raw.includes("/") ? raw : null;
}

async function appInstallationToken(): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const installId = process.env.GITHUB_APP_INSTALLATION_ID?.trim();
  let pk = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !installId || !pk) return null;
  pk = pk.replace(/\\n/g, "\n");
  try {
    const key = await importPKCS8(pk, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(appId)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(key);
    const res = await fetch(`https://api.github.com/app/installations/${installId}/access_tokens`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      log.warn(`GitHub App token failed: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch (err) {
    log.warn("GitHub App JWT failed", err);
    return null;
  }
}

async function resolveTokens(): Promise<{ token: string; mode: AuthMode }[]> {
  const out: { token: string; mode: AuthMode }[] = [];
  const app = await appInstallationToken();
  if (app) out.push({ token: app, mode: "app" });
  const pat = (process.env.GITHUB_TOKEN || process.env.BUG_TRIAGE_GITHUB_TOKEN || "").trim();
  if (pat) out.push({ token: pat, mode: "pat" });
  return out;
}

async function ghFetch(
  path: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`https://api.github.com${path}`, {
    ...rest,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(rest.headers || {}),
    },
  });
}

/** Try App then PAT for a mutating call. */
async function withAuthFallback<T>(fn: (token: string, mode: AuthMode) => Promise<T>): Promise<T> {
  const tokens = await resolveTokens();
  if (!tokens.length) throw new Error("No GitHub auth configured (App or GITHUB_TOKEN)");
  let lastErr: unknown;
  for (const t of tokens) {
    try {
      return await fn(t.token, t.mode);
    } catch (err) {
      lastErr = err;
      log.warn(`GitHub ${t.mode} failed — trying next`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function createGithubIssue(opts: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<GithubIssueRef> {
  const repo = repoSlug();
  if (!repo) throw new Error("GITHUB_REPO not set (owner/name)");
  return withAuthFallback(async (token, mode) => {
    const res = await ghFetch(`/repos/${repo}/issues`, {
      method: "POST",
      token,
      body: JSON.stringify({
        title: opts.title.slice(0, 200),
        body: opts.body,
        labels: opts.labels ?? ["auto-triage"],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`create issue ${mode} ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { number: number; html_url: string };
    return { number: data.number, htmlUrl: data.html_url };
  });
}

export async function commentGithubIssue(opts: {
  issueNumber: number;
  body: string;
}): Promise<void> {
  const repo = repoSlug();
  if (!repo) throw new Error("GITHUB_REPO not set (owner/name)");
  await withAuthFallback(async (token, mode) => {
    const res = await ghFetch(`/repos/${repo}/issues/${opts.issueNumber}/comments`, {
      method: "POST",
      token,
      body: JSON.stringify({ body: opts.body }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`comment issue ${mode} ${res.status}: ${text.slice(0, 300)}`);
    }
  });
}

export function githubConfigured(): boolean {
  return !!repoSlug() && !!(process.env.GITHUB_TOKEN || process.env.BUG_TRIAGE_GITHUB_TOKEN || process.env.GITHUB_APP_ID);
}

/** Exported for unit tests — order App then PAT. */
export async function listAuthModesForTest(): Promise<AuthMode[]> {
  return (await resolveTokens()).map((t) => t.mode);
}
