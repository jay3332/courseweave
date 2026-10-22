// OpenID Connect: discovery, authorization URL, code exchange, ID token verification.
// Works with any issuer; Google limited to CMU domains is the default (see env.ts).
import { decodeBase64urlText, fromBase64url, safeEqual } from './crypto.ts'

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

/** The JWK fields used for RS256 verification. */
export interface Jwk {
  kty?: string
  kid?: string
  n?: string
  e?: string
  alg?: string
  use?: string
}

export interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

const HOUR = 60 * 60 * 1000
const discoveryCache = new Map<string, { value: Discovery; expires: number }>()
const jwksCache = new Map<string, { keys: Jwk[]; expires: number }>()

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export async function discover(issuer: string, fetcher: Fetcher = fetch, now = Date.now()): Promise<Discovery> {
  const cached = discoveryCache.get(issuer)
  if (cached && cached.expires > now) return cached.value
  const res = await fetcher(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OIDC discovery failed (HTTP ${res.status})`)
  const doc = (await res.json()) as Partial<Discovery>
  if (!isHttpsUrl(doc.authorization_endpoint) || !isHttpsUrl(doc.token_endpoint) || !isHttpsUrl(doc.jwks_uri) || typeof doc.issuer !== 'string') {
    throw new Error('OIDC discovery document is missing endpoints')
  }
  const value: Discovery = { issuer: doc.issuer, authorization_endpoint: doc.authorization_endpoint, token_endpoint: doc.token_endpoint, jwks_uri: doc.jwks_uri }
  discoveryCache.set(issuer, { value, expires: now + HOUR })
  return value
}

/** Signing keys from the issuer's JWKS, cached for an hour; `refresh` refetches (key rotation). */
export async function fetchJwks(uri: string, refresh = false, fetcher: Fetcher = fetch, now = Date.now()): Promise<Jwk[]> {
  const cached = jwksCache.get(uri)
  if (!refresh && cached && cached.expires > now) return cached.keys
  const res = await fetcher(uri, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status})`)
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? []
  jwksCache.set(uri, { keys, expires: now + HOUR })
  return keys
}

export interface AuthorizeParams {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
  /** Google only: hosted-domain hint for the account chooser. Never trusted; claims are checked after. */
  hostedDomain?: string
}

export function authorizeUrl(d: Discovery, p: AuthorizeParams): string {
  const url = new URL(d.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', p.state)
  url.searchParams.set('nonce', p.nonce)
  url.searchParams.set('code_challenge', p.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (p.hostedDomain) {
    url.searchParams.set('hd', p.hostedDomain)
    url.searchParams.set('prompt', 'select_account')
  }
  return url.toString()
}

export function isGoogle(issuer: string): boolean {
  return issuer === 'https://accounts.google.com'
}

export interface TokenRequest {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  verifier: string
}

export async function exchangeCode(d: Discovery, t: TokenRequest, fetcher: Fetcher = fetch): Promise<{ idToken: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: t.code,
    redirect_uri: t.redirectUri,
    client_id: t.clientId,
    client_secret: t.clientSecret,
    code_verifier: t.verifier,
  })
  const res = await fetcher(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status})`)
  const json = (await res.json()) as { id_token?: unknown }
  if (typeof json.id_token !== 'string') throw new Error('Token response has no id_token')
  return { idToken: json.id_token }
}

// ---------------------------------------------------------------------------
// ID tokens

export interface IdTokenClaims {
  iss: string
  aud: string | string[]
  azp?: string
  sub: string
  exp: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  picture?: string
  hd?: string
}

export interface VerifyOptions {
  issuer: string
  clientId: string
  nonce: string
  /** Signing keys; called again with refresh=true when the token's key id isn't found. */
  keys(refresh: boolean): Promise<Jwk[]>
  now?: number
}

const CLOCK_SKEW = 60 * 1000

/** Null when the claims are acceptable, else the reason they aren't. */
export function checkClaims(claims: Partial<IdTokenClaims>, opts: { issuer: string; clientId: string; nonce: string; now?: number }): string | null {
  const now = opts.now ?? Date.now()
  const issuerOk = claims.iss === opts.issuer || (isGoogle(opts.issuer) && claims.iss === 'accounts.google.com')
  if (!issuerOk) return 'issuer'
  const aud = claims.aud
  const audOk = typeof aud === 'string' ? aud === opts.clientId : Array.isArray(aud) && aud.includes(opts.clientId)
  if (!audOk) return 'audience'
  if (Array.isArray(aud) && aud.length > 1 && claims.azp !== opts.clientId) return 'authorized party'
  if (typeof claims.exp !== 'number' || claims.exp * 1000 + CLOCK_SKEW < now) return 'expired'
  if (typeof claims.iat === 'number' && claims.iat * 1000 - 5 * 60 * 1000 > now) return 'issued in the future'
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, opts.nonce)) return 'nonce'
  if (typeof claims.sub !== 'string' || !claims.sub) return 'subject'
  return null
}

/** Verifies an RS256 ID token's signature and claims; returns the claims or throws. */
export async function verifyIdToken(token: string, opts: VerifyOptions): Promise<IdTokenClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed ID token')
  const [headerB64, payloadB64, sigB64] = parts
  let header: { alg?: string; kid?: string }
  let claims: Partial<IdTokenClaims>
  try {
    header = JSON.parse(decodeBase64urlText(headerB64))
    claims = JSON.parse(decodeBase64urlText(payloadB64))
  } catch {
    throw new Error('Malformed ID token')
  }
  if (header.alg !== 'RS256') throw new Error(`Unsupported ID token algorithm ${header.alg}`)

  const pick = (keys: Jwk[]) =>
    keys.find((k) => k.kty === 'RSA' && (header.kid ? k.kid === header.kid : true))
  let jwk = pick(await opts.keys(false))
  if (!jwk) jwk = pick(await opts.keys(true))
  if (!jwk) throw new Error('No matching signing key')

  const { kty, n, e } = jwk
  const key = await crypto.subtle.importKey('jwk', { kty, n, e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`))
  if (!valid) throw new Error('Bad ID token signature')

  const problem = checkClaims(claims, opts)
  if (problem) throw new Error(`ID token rejected: ${problem}`)
  return claims as IdTokenClaims
}

/** The verified, allowed email (lowercase), or why it isn't acceptable. */
export function allowedEmail(claims: Pick<IdTokenClaims, 'email' | 'email_verified'>, domains: string[]): { email: string } | { reason: 'unverified' | 'domain' } {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!email || claims.email_verified !== true) return { reason: 'unverified' }
  const at = email.lastIndexOf('@')
  const domain = at > 0 ? email.slice(at + 1) : ''
  if (!domain || !domains.includes(domain)) return { reason: 'domain' }
  return { email }
}
