import { describe, expect, it } from 'vitest'
import { base64url, pkceChallenge } from './crypto.ts'
import { allowedEmail, authorizeUrl, checkClaims, verifyIdToken, type IdTokenClaims, type Jwk } from './oidc.ts'

const ISSUER = 'https://accounts.google.com'
const CLIENT = 'client-123.apps.googleusercontent.com'

async function makeSigner() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk
  const sign = async (claims: Partial<IdTokenClaims>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) => {
    const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)))
    const input = `${enc(header)}.${enc(claims)}`
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input))
    return `${input}.${base64url(sig)}`
  }
  return { jwk: { ...jwk, kid: 'k1' }, sign }
}

const now = Date.UTC(2026, 9, 21)
const good: IdTokenClaims = {
  iss: ISSUER,
  aud: CLIENT,
  sub: '1234',
  exp: now / 1000 + 3600,
  iat: now / 1000,
  nonce: 'n-1',
  email: 'jdoe@andrew.cmu.edu',
  email_verified: true,
  name: 'J Doe',
}

describe('PKCE', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('authorizeUrl', () => {
  it('requests code + PKCE and sends the hosted-domain hint for Google', () => {
    const url = new URL(
      authorizeUrl(
        { issuer: ISSUER, authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth', token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs' },
        { clientId: CLIENT, redirectUri: 'https://cw.example/auth/callback', state: 's', nonce: 'n', challenge: 'c', hostedDomain: 'andrew.cmu.edu' },
      ),
    )
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: CLIENT,
      redirect_uri: 'https://cw.example/auth/callback',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      hd: 'andrew.cmu.edu',
    })
  })
})

describe('allowedEmail', () => {
  const domains = ['andrew.cmu.edu', 'cmu.edu']
  it('accepts verified CMU addresses, case-insensitively', () => {
    expect(allowedEmail({ email: 'JDoe@Andrew.CMU.edu', email_verified: true }, domains)).toEqual({ email: 'jdoe@andrew.cmu.edu' })
    expect(allowedEmail({ email: 'prof@cmu.edu', email_verified: true }, domains)).toEqual({ email: 'prof@cmu.edu' })
  })
  it('rejects other domains, look-alikes and unverified emails', () => {
    expect(allowedEmail({ email: 'x@gmail.com', email_verified: true }, domains)).toEqual({ reason: 'domain' })
    expect(allowedEmail({ email: 'x@evilcmu.edu', email_verified: true }, domains)).toEqual({ reason: 'domain' })
    expect(allowedEmail({ email: 'x@cmu.edu.evil.com', email_verified: true }, domains)).toEqual({ reason: 'domain' })
    expect(allowedEmail({ email: 'x@sub.andrew.cmu.edu', email_verified: true }, domains)).toEqual({ reason: 'domain' })
    expect(allowedEmail({ email: 'x@andrew.cmu.edu', email_verified: false }, domains)).toEqual({ reason: 'unverified' })
    expect(allowedEmail({ email: 'x@andrew.cmu.edu', email_verified: 'true' }, domains)).toEqual({ reason: 'unverified' })
    expect(allowedEmail({ email_verified: true }, domains)).toEqual({ reason: 'unverified' })
  })
})

describe('checkClaims', () => {
  const opts = { issuer: ISSUER, clientId: CLIENT, nonce: 'n-1', now }
  it('accepts good claims, including Google’s bare issuer', () => {
    expect(checkClaims(good, opts)).toBeNull()
    expect(checkClaims({ ...good, iss: 'accounts.google.com' }, opts)).toBeNull()
    expect(checkClaims({ ...good, aud: [CLIENT, 'other'], azp: CLIENT }, opts)).toBeNull()
  })
  it('rejects the wrong issuer, audience, nonce, or an expired token', () => {
    expect(checkClaims({ ...good, iss: 'https://evil.example' }, opts)).toBe('issuer')
    expect(checkClaims({ ...good, aud: 'other' }, opts)).toBe('audience')
    expect(checkClaims({ ...good, aud: [CLIENT, 'other'], azp: 'other' }, opts)).toBe('authorized party')
    expect(checkClaims({ ...good, exp: now / 1000 - 3600 }, opts)).toBe('expired')
    expect(checkClaims({ ...good, iat: now / 1000 + 3600 }, opts)).toBe('issued in the future')
    expect(checkClaims({ ...good, nonce: 'other' }, opts)).toBe('nonce')
    expect(checkClaims({ ...good, nonce: undefined }, opts)).toBe('nonce')
  })
})

describe('verifyIdToken', () => {
  it('verifies the RS256 signature with the issuer’s keys', async () => {
    const { jwk, sign } = await makeSigner()
    const claims = await verifyIdToken(await sign(good), { issuer: ISSUER, clientId: CLIENT, nonce: 'n-1', now, keys: async () => [jwk] })
    expect(claims.email).toBe('jdoe@andrew.cmu.edu')
  })

  it('refetches keys once when the key id is unknown (rotation)', async () => {
    const { jwk, sign } = await makeSigner()
    const calls: boolean[] = []
    const keys = async (refresh: boolean) => {
      calls.push(refresh)
      return refresh ? [jwk] : [{ ...jwk, kid: 'old' }]
    }
    await verifyIdToken(await sign(good), { issuer: ISSUER, clientId: CLIENT, nonce: 'n-1', now, keys })
    expect(calls).toEqual([false, true])
  })

  it('rejects forged signatures, other algorithms and bad claims', async () => {
    const real = await makeSigner()
    const other = await makeSigner()
    const opts = { issuer: ISSUER, clientId: CLIENT, nonce: 'n-1', now, keys: async () => [real.jwk] }
    await expect(verifyIdToken(await other.sign(good), opts)).rejects.toThrow(/signature/)
    await expect(verifyIdToken(await real.sign(good, { alg: 'none', kid: 'k1' }), opts)).rejects.toThrow(/algorithm/)
    await expect(verifyIdToken(await real.sign({ ...good, nonce: 'replayed' }), opts)).rejects.toThrow(/nonce/)
    await expect(verifyIdToken('a.b', opts)).rejects.toThrow(/Malformed/)
  })
})
