import { describe, expect, it } from 'vitest'
import { SYNC_MAX_BYTES } from '../src/lib/api-types.ts'
import { sha256 } from './crypto.ts'
import type { Env } from './env.ts'
import { handle } from './router.ts'
import { readSession, SESSION_REFRESH_AFTER, SESSION_TTL } from './session.ts'
import { putDoc } from './sync.ts'
import { memoryStore } from './testing.ts'

const ORIGIN = 'https://courseweave.example'

/** Assets stub: serves known paths, otherwise the SPA's index.html (like not_found_handling = SPA). */
const assets = (files: Record<string, string>) => ({
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path in files) return new Response(files[path], { headers: { 'Content-Type': 'application/json' } })
    return new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  },
})

function setup(configured = true) {
  const store = memoryStore()
  const env: Env = {
    ASSETS: assets({ '/data/fce/summary.json': '{"ok":true}', '/data/S27.json': '{}' }),
    DB: configured ? ({} as Env['DB']) : undefined,
    ...(configured ? { OIDC_CLIENT_ID: 'client', OIDC_CLIENT_SECRET: 'secret', SESSION_SECRET: 'session-secret' } : {}),
  }
  const signIn = async (email = 'jdoe@andrew.cmu.edu', expiresAt = Date.now() + SESSION_TTL) => {
    const user = await store.upsertUser({ email, name: 'J Doe', picture: null }, Date.now())
    const token = `token-${email}`
    await store.createSession(await sha256(token), user.id, Date.now(), expiresAt)
    return { user, cookie: `__Host-cw_session=${token}` }
  }
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (init.cookie) headers.set('Cookie', init.cookie)
    return handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, { store })
  }
  const write = (path: string, method: string, body: unknown, cookie?: string) =>
    call(path, { method, cookie, headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) })
  return { store, env, signIn, call, write }
}

describe('FCE gate', () => {
  it('locks FCE files for signed-out visitors without caching', async () => {
    const { call } = setup()
    const res = await call('/data/fce/summary.json')
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(((await res.json()) as { code: string }).code).toBe('auth')
  })

  it('serves FCE files privately to signed-in users and 404s missing ones', async () => {
    const { call, signIn } = setup()
    const { cookie } = await signIn()
    const ok = await call('/data/fce/summary.json', { cookie })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect((await call('/data/fce/courses/15.json', { cookie })).status).toBe(404)
  })

  it('never serves FCE when sign-in isn’t configured', async () => {
    const { call } = setup(false)
    expect((await call('/data/fce/summary.json', { cookie: '__Host-cw_session=anything' })).status).toBe(401)
  })

  it('serves public data files, 404s missing ones, and passes everything else to assets', async () => {
    const { call } = setup()
    expect((await call('/data/S27.json')).status).toBe(200)
    expect((await call('/data/nope.json')).status).toBe(404)
    expect(await (await call('/S27/schedule')).text()).toBe('<!doctype html>')
  })
})

describe('API', () => {
  it('reports the signed-in user, 401 otherwise, 503 when unconfigured', async () => {
    const { call, signIn } = setup()
    expect((await call('/api/me')).status).toBe(401)
    const { cookie } = await signIn()
    const me = await call('/api/me', { cookie })
    expect(await me.json()).toEqual({ email: 'jdoe@andrew.cmu.edu', name: 'J Doe', picture: null })
    expect((await setup(false).call('/api/me')).status).toBe(503)
    expect((await setup(false).call('/auth/login')).status).toBe(503)
  })

  it('rejects cross-site and non-JSON writes before touching data', async () => {
    const { call, signIn } = setup()
    const { cookie } = await signIn()
    const noOrigin = await call('/api/sync/plan', { method: 'PUT', cookie, headers: { 'Content-Type': 'application/json' }, body: '{"data":1,"baseRev":0}' })
    expect(noOrigin.status).toBe(403)
    const form = await call('/api/sync/plan', { method: 'PUT', cookie, headers: { 'Content-Type': 'text/plain', Origin: ORIGIN }, body: '{"data":1,"baseRev":0}' })
    expect(form.status).toBe(403)
  })

  it('syncs documents with optimistic concurrency', async () => {
    const { write, call, signIn } = setup()
    const { cookie } = await signIn()
    const created = await write('/api/sync/schedules', 'PUT', { data: { a: 1 }, baseRev: 0 }, cookie)
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({ data: { a: 1 }, rev: 1 })

    const stale = await write('/api/sync/schedules', 'PUT', { data: { a: 2 }, baseRev: 0 }, cookie)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'conflict', current: { data: { a: 1 }, rev: 1 } })

    expect((await write('/api/sync/schedules', 'PUT', { data: { a: 3 }, baseRev: 1 }, cookie)).status).toBe(200)
    const state = (await (await call('/api/sync', { cookie })).json()) as { docs: Record<string, { rev: number; data: unknown }> }
    expect(state.docs.schedules).toMatchObject({ rev: 2, data: { a: 3 } })

    expect((await write('/api/sync/secrets', 'PUT', { data: 1, baseRev: 0 }, cookie)).status).toBe(404)
    expect((await write('/api/sync/plan', 'PUT', { data: 1, baseRev: -1 }, cookie)).status).toBe(400)
    expect((await write('/api/sync/plan', 'PUT', { data: 'x'.repeat(SYNC_MAX_BYTES + 10_000), baseRev: 0 }, cookie)).status).toBe(413)
  })

  it('keeps users’ documents apart', async () => {
    const { write, call, signIn } = setup()
    const a = await signIn('a@andrew.cmu.edu')
    const b = await signIn('b@andrew.cmu.edu')
    await write('/api/sync/record', 'PUT', { data: 'mine', baseRev: 0 }, a.cookie)
    const theirs = (await (await call('/api/sync', { cookie: b.cookie })).json()) as { docs: Record<string, unknown> }
    expect(theirs.docs).toEqual({})
  })

  it('deletes the account, its sessions and documents', async () => {
    const { write, call, signIn, store } = setup()
    const { cookie, user } = await signIn()
    await write('/api/sync/plan', 'PUT', { data: 1, baseRev: 0 }, cookie)
    const res = await write('/api/account', 'DELETE', {}, cookie)
    expect(res.status).toBe(204)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(store.users.has(user.id)).toBe(false)
    expect(store.docs.size).toBe(0)
    expect((await call('/api/me', { cookie })).status).toBe(401)
  })

  it('signs out', async () => {
    const { write, call, signIn, store } = setup()
    const { cookie } = await signIn()
    expect((await write('/auth/logout', 'POST', {}, cookie)).status).toBe(204)
    expect(store.sessions.size).toBe(0)
    expect((await call('/api/me', { cookie })).status).toBe(401)
  })
})

describe('sessions', () => {
  it('expires old sessions and slides active ones at most daily', async () => {
    const store = memoryStore()
    const user = await store.upsertUser({ email: 'a@cmu.edu', name: null, picture: null }, 0)
    const now = Date.UTC(2026, 9, 21)
    const req = (token: string) => new Request(`${ORIGIN}/api/me`, { headers: { Cookie: `__Host-cw_session=${token}` } })

    await store.createSession(await sha256('fresh'), user.id, now, now + SESSION_TTL)
    expect((await readSession(store, req('fresh'), now))?.setCookie).toBeUndefined()

    await store.createSession(await sha256('aging'), user.id, now, now + SESSION_TTL - SESSION_REFRESH_AFTER - 1)
    const aged = await readSession(store, req('aging'), now)
    expect(aged?.setCookie).toContain('Max-Age=2592000')
    expect(store.sessions.get(await sha256('aging'))?.expiresAt).toBe(now + SESSION_TTL)

    await store.createSession(await sha256('old'), user.id, now, now - 1)
    expect(await readSession(store, req('old'), now)).toBeNull()
    expect(store.sessions.has(await sha256('old'))).toBe(false)
  })

  it('uses the unprefixed cookie on plain-http localhost', async () => {
    const store = memoryStore()
    const user = await store.upsertUser({ email: 'a@cmu.edu', name: null, picture: null }, 0)
    await store.createSession(await sha256('t'), user.id, 0, Date.now() + SESSION_TTL)
    const local = new Request('http://localhost:8787/api/me', { headers: { Cookie: 'cw_session=t' } })
    expect((await readSession(store, local))?.user.email).toBe('a@cmu.edu')
    const prefixedOnLocal = new Request('http://localhost:8787/api/me', { headers: { Cookie: '__Host-cw_session=t' } })
    expect(await readSession(store, prefixedOnLocal)).toBeNull()
  })
})

describe('putDoc', () => {
  it('reports a missing doc as rev 0 when the client expected one', async () => {
    const store = memoryStore()
    expect(await putDoc(store, 'u', 'plan', { data: 1, baseRev: 3 }, 5)).toEqual({ status: 409, current: { data: null, rev: 0, updatedAt: 0 } })
  })
})
