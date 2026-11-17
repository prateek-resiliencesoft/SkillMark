import { SignJWT, jwtVerify } from 'jose'

const PURPOSE = 'landing-preview'

function key() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET || 'resiliencesoft-default-storage-auth-secret-key-32',
  )
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
