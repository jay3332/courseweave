// WebCrypto helpers shared by sessions and OIDC. Runs in Workers and in Node (tests).

const encoder = new TextEncoder()

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function decodeBase64urlText(text: string): string {
  return new TextDecoder().decode(fromBase64url(text))
}

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(text: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

/** PKCE S256 challenge for a code verifier (RFC 7636). */
export function pkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier)
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** `<base64url(json)>.<base64url(hmac)>`, for short-lived cookies such as the OIDC login state. */
export async function signPayload(payload: unknown, secret: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return `${body}.${base64url(sig)}`
}

/** The payload of a value made by signPayload, or null if it's malformed or the signature doesn't match. */
export async function verifyPayload<T>(value: string | null | undefined, secret: string): Promise<T | null> {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  let sig: Uint8Array
  try {
    sig = fromBase64url(value.slice(dot + 1))
  } catch {
    return null
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode(body))
  if (!ok) return null
  try {
    return JSON.parse(decodeBase64urlText(body)) as T
  } catch {
    return null
  }
}

/** Constant-time string comparison (for state values and the like). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
