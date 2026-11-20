import { hkdfSync } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const PURPOSE = 'landing-preview'

/**
 * Fail closed — never fall back to a known default (that would let anyone forge preview tokens).
 * Derived subkey: session JWTs are signed with AUTH_SECRET itself, so preview tokens must never
 * share that key or they would verify as login sessions.
 */
function key() {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be set (32+ chars) to sign landing preview tokens')
  }
  return new Uint8Array(hkdfSync('sha256', secret, 'skillmark', 'landing-preview-token/v1', 32))
}

/** Short-lived token so "Preview in new tab" can read the draft without admin cookies. */
export async function signPreviewToken(userId: string, expiresInSec = 30 * 60): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSec)
    .sign(key())
}

export async function verifyPreviewToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    if (payload.purpose !== PURPOSE || typeof payload.sub !== 'string') return null
    return { userId: payload.sub }
  } catch {
    return null
  }
}
