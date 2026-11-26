const windowMs = 60_000;
const maxRequests = 60;

const hits = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  hits.forEach((entry, key) => {
    if (entry.resetAt <= now) hits.delete(key);
  });
}, 60_000).unref();

export function checkRateLimit(identifier: string, max: number = maxRequests, window: number = windowMs): Response | null {
  const now = Date.now();
  const limit = max > 0 ? max : maxRequests;
  let entry = hits.get(identifier);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + (window > 0 ? window : windowMs) };
    hits.set(identifier, entry);
    return null;
  }

  entry.count++;

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Retry after ${retryAfter}s.`,
          retry_after: retryAfter,
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return null;
}

export const PASSWORD_ATTEMPTS_PER_ACCOUNT = 10;
export const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Per-account cap on password checks (login + invite-join share it), so rotating
 * client IPs cannot brute-force one account.
 */
export function checkPasswordAttemptLimit(email: string): Response | null {
  return checkRateLimit(
    `auth:password:${email.trim().toLowerCase()}`,
    PASSWORD_ATTEMPTS_PER_ACCOUNT,
    PASSWORD_ATTEMPT_WINDOW_MS,
  );
}
