// Security behavior: rate limits, write caps, sign-in hardening, headers, body limits, sessions.
import { describe, expect, it, vi } from 'vitest'
import { SYNC_MAX_BYTES } from '../src/lib/api-types.ts'
import { base64url, sha256 } from './crypto.ts'
import { MAX_SESSIONS_PER_USER, utcDay } from './db.ts'
import type { Env } from './env.ts'
import { csrfCheck, safeReturnTo } from './http.ts'
import { cleanup } from './index.ts'
import { allowedEmail, discover, type Jwk } from './oidc.ts'
import type { RateLimiter } from './ratelimit.ts'
import { handle } from './router.ts'
import { readSession, SESSION_REFRESH_AFTER, SESSION_TTL } from './session.ts'
import { putDoc, syncStateText } from './sync.ts'
import { memoryStore } from './testing.ts'

const ORIGIN = 'https://courseweave.example'
const GOOGLE = 'https://accounts.google.com'

/** A Workers Rate Limiting stand-in: `limit` calls per key, never resetting. */
function limiter(limit: number): RateLimiter & { calls: string[] } {
  const counts = new Map<string, number>()
  const calls: string[] = []
  return {
    calls,
    async limit({ key }) {
      calls.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= limit }
    },
  }
}

const assets = (files: Record<string, string>) => ({
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (request.headers.get('If-None-Match') === '"v1"' && path in files) return new Response(null, { status: 304, headers: { ETag: '"v1"' } })
    if (path in files) return new Response(files[path], { headers: { 'Content-Type': 'application/json', ETag: '"v1"' } })
    return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  },
})

function setup(extra: Partial<Env> = {}) {
  const store = memoryStore()
  const env: Env = {
    ASSETS: assets({ '/data/fce/summary.json': '{"ok":true}' }),
    DB: {} as Env['DB'],
    OIDC_CLIENT_ID: 'client',
    OIDC_CLIENT_SECRET: 'secret',
    SESSION_SECRET: 'session-secret',
    ...extra,
  }
  const signIn = async (email = 'jdoe@andrew.cmu.edu') => {
    const user = await store.upsertUser({ email, name: 'J Doe', picture: null }, Date.now())
    const token = `token-${email}-${Math.random()}`
    await store.createSession(await sha256(token), user.id, Date.now(), Date.now() + SESSION_TTL)
    return { user, token, cookie: `__Host-cw_session=${token}` }
  }
  const call = (path: string, init: RequestInit & { cookie?: string; ip?: string } = {}, fetcher?: typeof fetch) => {
    const headers = new Headers(init.headers)
    if (init.cookie) headers.set('Cookie', init.cookie)
    headers.set('CF-Connecting-IP', init.ip ?? '203.0.113.7')
    return handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, { store, fetcher })
  }
  const put = (key: string, body: unknown, cookie: string, headers: Record<string, string> = {}) => {
    const text = JSON.stringify(body)
    return call(`/api/sync/${key}`, {
      method: 'PUT',
      cookie,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Content-Length': String(new TextEncoder().encode(text).length), ...headers },
      body: text,
    })
  }
  return { store, env, signIn, call, put }
}

describe('rate limits', () => {
  it('limits each IP across Worker routes, with Retry-After, before reading the session', async () => {
    const RL_IP = limiter(2)
    const { call, store } = setup({ RL_IP })
    const findSession = vi.spyOn(store, 'findSession')
    expect((await call('/api/me', { cookie: '__Host-cw_session=x' })).status).toBe(401)
    expect((await call('/data/fce/summary.json', { cookie: '__Host-cw_session=x' })).status).toBe(401)
    const limited = await call('/api/me', { cookie: '__Host-cw_session=x' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(((await limited.json()) as { code: string }).code).toBe('too_many')
    expect(findSession).toHaveBeenCalledTimes(2)
    // Another IP is unaffected.
    expect((await call('/api/me', { ip: '198.51.100.1' })).status).toBe(401)
  })

  it('limits sign-in starts per IP before calling the provider', async () => {
    const fetcher = vi.fn(async () => new Response('{}'))
    const { call } = setup({ RL_AUTH: limiter(0) })
    const res = await call('/auth/login', {}, fetcher as unknown as typeof fetch)
    expect(res.status).toBe(429)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('limits writes per account', async () => {
    const RL_WRITE = limiter(1)
    const { put, signIn } = setup({ RL_WRITE })
    const a = await signIn('a@andrew.cmu.edu')
    const b = await signIn('b@andrew.cmu.edu')
    expect((await put('plan', { data: 1, baseRev: 0 }, a.cookie)).status).toBe(200)
    expect((await put('plan', { data: 2, baseRev: 1 }, a.cookie)).status).toBe(429)
    expect((await put('plan', { data: 1, baseRev: 0 }, b.cookie)).status).toBe(200)
    expect(RL_WRITE.calls).toEqual([`user:${a.user.id}`, `user:${a.user.id}`, `user:${b.user.id}`])
  })

  it('lets requests through when a binding is missing or errors', async () => {
    const broken: RateLimiter = { limit: async () => Promise.reject(new Error('down')) }
    const { call } = setup({ RL_IP: broken })
    expect((await call('/api/me')).status).toBe(401)
  })
})

describe('daily write cap', () => {
  it('caps writes per document per UTC day and tells it apart from conflicts', async () => {
    const store = memoryStore()
    const day = Date.UTC(2026, 9, 21, 12)
    expect((await putDoc(store, 'u', 'plan', { data: 1, baseRev: 0 }, day, 3)).status).toBe(200)
    expect((await putDoc(store, 'u', 'plan', { data: 2, baseRev: 1 }, day + 1, 3)).status).toBe(200)
    expect((await putDoc(store, 'u', 'plan', { data: 3, baseRev: 2 }, day + 2, 3)).status).toBe(200)
    const capped = await putDoc(store, 'u', 'plan', { data: 4, baseRev: 3 }, day + 3, 3)
    expect(capped).toEqual({ status: 429, retryAfter: 12 * 3600 })
    // A stale rev is still a conflict, not the cap.
    expect((await putDoc(store, 'u', 'plan', { data: 4, baseRev: 1 }, day + 4, 3)).status).toBe(409)
    // The next UTC day starts a new count.
    const tomorrow = Date.UTC(2026, 9, 22, 0, 0, 1)
    expect((await putDoc(store, 'u', 'plan', { data: 4, baseRev: 3 }, tomorrow, 3)).status).toBe(200)
    expect(store.docs.get('u/plan')).toMatchObject({ day: utcDay(tomorrow), dayWrites: 1 })
  })

  it('returns 429 from the API when the cap is reached', async () => {
    const { put, signIn, store } = setup()
    const { cookie, user } = await signIn()
    expect((await put('plan', { data: 1, baseRev: 0 }, cookie)).status).toBe(200)
    store.docs.set(`${user.id}/plan`, { ...store.docs.get(`${user.id}/plan`)!, dayWrites: 10_000 })
    const res = await put('plan', { data: 2, baseRev: 1 }, cookie)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('request bodies', () => {
  it('requires a Content-Length and refuses oversized bodies before reading them', async () => {
    const { call, signIn } = setup()
    const { cookie } = await signIn()
    const headers = { 'Content-Type': 'application/json', Origin: ORIGIN }
    const body = '{"data":1,"baseRev":0}'
    expect((await call('/api/sync/plan', { method: 'PUT', cookie, headers, body })).status).toBe(411)
    expect((await call('/api/sync/plan', { method: 'PUT', cookie, headers: { ...headers, 'Content-Length': 'abc' }, body })).status).toBe(411)
    const huge = await call('/api/sync/plan', { method: 'PUT', cookie, headers: { ...headers, 'Content-Length': String(SYNC_MAX_BYTES + 10_000) }, body })
    expect(huge.status).toBe(413)
  })

  it('returns 400, not a crash, for documents that can’t be serialized', async () => {
    const store = memoryStore()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(await putDoc(store, 'u', 'plan', { data: circular, baseRev: 0 })).toMatchObject({ status: 400 })
  })

  it('splices stored JSON into the sync state as valid JSON', async () => {
    const store = memoryStore()
    await putDoc(store, 'u', 'plan', { data: { plans: { a: { name: 'x"y' } } }, baseRev: 0 }, 5)
    await putDoc(store, 'u', 'record', { data: [1, 2], baseRev: 0 }, 6)
    expect(JSON.parse(await syncStateText(store, 'u'))).toEqual({
      docs: { plan: { data: { plans: { a: { name: 'x"y' } } }, rev: 1, updatedAt: 5 }, record: { data: [1, 2], rev: 1, updatedAt: 6 } },
    })
    expect(JSON.parse(await syncStateText(store, 'nobody'))).toEqual({ docs: {} })
  })
})

describe('security headers', () => {
  it('adds nosniff, framing, HSTS and a deny-all CSP to Worker responses', async () => {
    const { call, signIn } = setup()
    const { cookie } = await signIn()
    for (const res of [await call('/api/me'), await call('/data/fce/summary.json', { cookie }), await call('/auth/nope')]) {
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('X-Frame-Options')).toBe('DENY')
      expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    }
  })

  it('skips HSTS on plain-http localhost', async () => {
    const env: Env = { ASSETS: assets({}) }
    const res = await handle(new Request('http://localhost:8787/api/me'), env)
    expect(res.headers.get('Strict-Transport-Security')).toBeNull()
  })
})

describe('FCE caching', () => {
  it('passes "not modified" through privately instead of reporting the file missing', async () => {
    const { call, signIn } = setup()
    const { cookie } = await signIn()
    const res = await call('/data/fce/summary.json', { cookie, headers: { 'If-None-Match': '"v1"' } })
    expect(res.status).toBe(304)
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(res.headers.get('Vary')).toContain('Cookie')
  })
})

describe('return paths', () => {
  it('rejects paths that normalize into protocol-relative or backslash URLs', () => {
    for (const bad of ['/.//evil.com', '/./\\evil.com', '/\\\\evil.com', '/a/..//evil.com', '/x\t/evil', '/x\n/evil', '/x\r\n']) {
      expect(safeReturnTo(bad)).toBe('/')
    }
    // Encoded slashes stay a same-site path.
    expect(safeReturnTo('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com')
  })
})

describe('dev origins', () => {
  it('are honoured only for local http requests', () => {
    const json = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }
    const local = new Request('http://localhost:5173/api/sync/plan', { method: 'PUT', headers: json, body: '{}' })
    expect(csrfCheck(local, ['http://localhost:5173'])).toBeNull()
    // The router passes [] for anything that isn't local http, so the deployed site never trusts them.
    const deployed = new Request(`${ORIGIN}/api/sync/plan`, { method: 'PUT', headers: json, body: '{}' })
    expect(csrfCheck(deployed, [])?.status).toBe(403)
  })
})

describe('Google hosted domain', () => {
  const base = { email: 'jdoe@andrew.cmu.edu', email_verified: true as const }
  const domains = ['andrew.cmu.edu', 'cmu.edu']
  it('requires an allowed hd claim for Google accounts', () => {
    expect(allowedEmail(base, domains, { requireHostedDomain: true })).toEqual({ reason: 'domain' })
    expect(allowedEmail({ ...base, hd: 'gmail.com' }, domains, { requireHostedDomain: true })).toEqual({ reason: 'domain' })
    expect(allowedEmail({ ...base, hd: 'ANDREW.CMU.EDU' }, domains, { requireHostedDomain: true })).toEqual({ email: 'jdoe@andrew.cmu.edu' })
    // Other issuers rely on the verified email alone.
    expect(allowedEmail(base, domains)).toEqual({ email: 'jdoe@andrew.cmu.edu' })
  })
})

describe('discovery', () => {
  it('refuses a document for a different issuer', async () => {
    const fetcher = async () =>
      Response.json({ issuer: 'https://evil.example', authorization_endpoint: 'https://a/x', token_endpoint: 'https://a/t', jwks_uri: 'https://a/j' })
    await expect(discover('https://issuer-mismatch.example', fetcher)).rejects.toThrow(/issuer/)
  })
})

describe('sign-in', () => {
  async function provider(claims: (nonce: string) => Record<string, unknown>) {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    // A fresh key id per provider: JWKS are cached per process, as in the Worker.
    const kid = `k-${Math.random().toString(36).slice(2)}`
    const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk), kid }
    const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)))
    let nonce = ''
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/.well-known/openid-configuration')) {
        return Response.json({ issuer: GOOGLE, authorization_endpoint: `${GOOGLE}/auth`, token_endpoint: `${GOOGLE}/token`, jwks_uri: `${GOOGLE}/jwks` })
      }
      if (input === `${GOOGLE}/jwks`) return Response.json({ keys: [jwk] })
      if (input === `${GOOGLE}/token` && init?.method === 'POST') {
        const head = enc({ alg: 'RS256', kid })
        const body = enc({ iss: GOOGLE, aud: 'client', sub: '1', exp: Date.now() / 1000 + 600, iat: Date.now() / 1000, nonce, ...claims(nonce) })
        const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
        return Response.json({ id_token: `${head}.${body}.${base64url(sig)}` })
      }
      return new Response('not found', { status: 404 })
    })
    return { fetcher, setNonce: (n: string) => (nonce = n) }
  }

  async function startLogin(call: ReturnType<typeof setup>['call'], fetcher: typeof fetch) {
    const res = await call('/auth/login?returnTo=/S27/schedule', {}, fetcher)
    const location = new URL(res.headers.get('Location')!)
    const setCookie = res.headers.get('Set-Cookie')!
    return { res, location, cookie: setCookie.split(';')[0], setCookie }
  }

  it('uses a __Host- state cookie scoped to the whole site', async () => {
    const { call } = setup()
    const { fetcher } = await provider(() => ({}))
    const { setCookie } = await startLogin(call, fetcher as unknown as typeof fetch)
    expect(setCookie).toMatch(/^__Host-cw_oidc=/)
    expect(setCookie).toContain('Path=/;')
    expect(setCookie).toContain('Secure')
  })

  it('rejects oversized callback parameters before any provider call', async () => {
    const { call } = setup()
    const fetcher = vi.fn()
    const res = await call(`/auth/callback?code=${'a'.repeat(600)}&state=s`, {}, fetcher as unknown as typeof fetch)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('auth_error=failed')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('signs in a CMU Workspace account, replacing the browser’s previous session', async () => {
    const { call, store, signIn } = setup({ OIDC_ISSUER: GOOGLE })
    const { fetcher, setNonce } = await provider(() => ({ email: 'jdoe@andrew.cmu.edu', email_verified: true, hd: 'andrew.cmu.edu' }))
    const old = await signIn('jdoe@andrew.cmu.edu')
    const { location, cookie } = await startLogin(call, fetcher as unknown as typeof fetch)
    setNonce(location.searchParams.get('nonce')!)
    const res = await call(`/auth/callback?code=c&state=${location.searchParams.get('state')}`, { cookie: `${cookie}; ${old.cookie}` }, fetcher as unknown as typeof fetch)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/S27/schedule')
    expect(store.sessions.has(await sha256(old.token))).toBe(false)
    expect(store.sessions.size).toBe(1)
  })

  it('turns away a personal Google account using a CMU address (no hd)', async () => {
    const { call, store } = setup({ OIDC_ISSUER: GOOGLE })
    const { fetcher, setNonce } = await provider(() => ({ email: 'alum@andrew.cmu.edu', email_verified: true }))
    const { location, cookie } = await startLogin(call, fetcher as unknown as typeof fetch)
    setNonce(location.searchParams.get('nonce')!)
    const res = await call(`/auth/callback?code=c&state=${location.searchParams.get('state')}`, { cookie }, fetcher as unknown as typeof fetch)
    expect(res.headers.get('Location')).toContain('auth_error=domain')
    expect(store.users.size).toBe(0)
  })
})

describe('sessions', () => {
  it('keeps at most the newest sessions per user', async () => {
    const store = memoryStore()
    const user = await store.upsertUser({ email: 'a@cmu.edu', name: null, picture: null }, 0)
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i++) await store.createSession(`h${i}`, user.id, i, 1e15)
    expect(store.sessions.size).toBe(MAX_SESSIONS_PER_USER)
    expect(store.sessions.has('h0')).toBe(false)
    expect(store.sessions.has(`h${MAX_SESSIONS_PER_USER + 2}`)).toBe(true)
  })

  it('still signs the request in when extending the session fails', async () => {
    const store = memoryStore()
    const user = await store.upsertUser({ email: 'a@cmu.edu', name: null, picture: null }, 0)
    const now = Date.UTC(2026, 9, 21)
    await store.createSession(await sha256('t'), user.id, now, now + SESSION_TTL - SESSION_REFRESH_AFTER - 1)
    store.touchSession = async () => {
      throw new Error('D1 write limit')
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await readSession(store, new Request(`${ORIGIN}/api/me`, { headers: { Cookie: '__Host-cw_session=t' } }), now)
    expect(session?.user.email).toBe('a@cmu.edu')
    expect(session?.setCookie).toBeUndefined()
    error.mockRestore()
  })

  it('cleans up expired sessions on the daily schedule, quietly', async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }))
    const db = { prepare: () => ({ bind: () => ({ run, first: async () => null, all: async () => ({ results: [] }) }) }), batch: async () => [] }
    await cleanup({ ASSETS: assets({}), DB: db as unknown as Env['DB'] }, 123)
    expect(run).toHaveBeenCalledTimes(1)
    const failing = { prepare: () => ({ bind: () => ({ run: async () => Promise.reject(new Error('x')) }) }) }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(cleanup({ ASSETS: assets({}), DB: failing as unknown as Env['DB'] })).resolves.toBeUndefined()
    error.mockRestore()
    await expect(cleanup({ ASSETS: assets({}) })).resolves.toBeUndefined()
  })
})
