// Request routing. wrangler.jsonc sends /api/*, /auth/* and /data/fce/* here first; everything else is served as static
// assets (with the SPA fallback) without running the Worker.
import { SYNC_MAX_BYTES, type Me, type SyncConflict } from '../src/lib/api-types.ts'
import * as auth from './auth.ts'
import { d1Store, type Store } from './db.ts'
import { authConfig, devOrigins, type Env } from './env.ts'
import { apiError, csrfCheck, json, withSecurityHeaders } from './http.ts'
import type { Fetcher } from './oidc.ts'
import { allow, clientIp, tooMany } from './ratelimit.ts'
import { clearSessionCookie, readSession, withCookies } from './session.ts'
import { putDoc, syncStateText } from './sync.ts'

export interface Deps {
  /** Overrides for tests. */
  store?: Store
  fetcher?: Fetcher
}

/** Room for the `{ "data": …, "baseRev": n }` wrapper around a document of SYNC_MAX_BYTES. */
const PUT_BODY_LIMIT = SYNC_MAX_BYTES + 4096

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url)
  return withSecurityHeaders(await route(request, url, env, deps), url)
}

async function route(request: Request, url: URL, env: Env, deps: Deps): Promise<Response> {
  const path = url.pathname
  const dynamic = path.startsWith('/auth/') || path.startsWith('/api/') || path.startsWith('/data/fce/')
  // Per-IP burst limit on everything that runs Worker logic, before any database read or provider call.
  if (dynamic && !(await allow(env.RL_IP, `ip:${clientIp(request)}`))) return tooMany(60)
  if (path.startsWith('/auth/')) return handleAuth(request, env, deps)
  if (path.startsWith('/api/')) return handleApi(request, env, deps)
  if (path.startsWith('/data/fce/')) return handleFce(request, env, deps)
  if (path.startsWith('/data/')) return handleData(request, env)
  return env.ASSETS.fetch(request)
}

/** True when the assets binding fell back to the SPA's index.html because no file matched. */
const isSpaFallback = (res: Response) => !res.ok || (res.headers.get('Content-Type') ?? '').includes('text/html')

/** Public data files; a missing one must 404 instead of falling back to index.html. */
async function handleData(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  if (asset.status === 304) return asset
  if (isSpaFallback(asset)) return apiError(404, 'not_found', 'No such data file.')
  return asset
}

function storeFor(env: Env, deps: Deps): Store | null {
  return deps.store ?? (env.DB ? d1Store(env.DB) : null)
}

async function handleAuth(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const cfg = authConfig(env)
  const store = storeFor(env, deps)
  if ((pathname === '/auth/login' || pathname === '/auth/callback') && request.method === 'GET') {
    // Sign-in starts and finishes call the provider (discovery, token exchange): a tighter per-IP limit.
    if (!(await allow(env.RL_AUTH, `auth:${clientIp(request)}`))) return tooMany(60, 'Too many sign-in attempts; try again in a minute.')
    if (!cfg || !store) return auth.unavailable()
    return pathname === '/auth/login' ? auth.login(request, cfg, deps.fetcher) : auth.callback(request, cfg, store, deps.fetcher)
  }
  if (pathname === '/auth/logout') {
    if (request.method !== 'POST') return apiError(405, 'bad_request', 'Use POST to sign out.', { Allow: 'POST' })
    return csrfCheck(request, devOrigins(env, url)) ?? auth.logout(request, store)
  }
  return apiError(404, 'not_found', 'No such route.')
}

async function handleApi(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const blocked = csrfCheck(request, devOrigins(env, url))
  if (blocked) return blocked

  const store = storeFor(env, deps)
  if (!authConfig(env) || !store) return apiError(503, 'unavailable', 'Accounts aren’t set up on this deployment.')
  const session = await readSession(store, request)
  if (!session) return apiError(401, 'auth', 'Sign in with your CMU account.')
  const done = (res: Response) => withCookies(res, [session.setCookie])

  // Writes are limited per account as well as per IP.
  if (request.method === 'PUT' || request.method === 'DELETE') {
    if (!(await allow(env.RL_WRITE, `user:${session.user.id}`))) return done(tooMany(60, 'Too many changes at once; syncing will resume shortly.'))
  }

  if (pathname === '/api/me') {
    if (request.method !== 'GET') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'GET' })
    const me: Me = { email: session.user.email, name: session.user.name, picture: session.user.picture }
    return done(json(me))
  }

  if (pathname === '/api/sync') {
    if (request.method !== 'GET') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'GET' })
    const body = await syncStateText(store, session.user.id)
    return done(new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }))
  }

  const syncMatch = /^\/api\/sync\/([a-z]+)$/.exec(pathname)
  if (syncMatch) {
    if (request.method !== 'PUT') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'PUT' })
    // Require a declared length so an oversized (or chunked) body is refused before it's read into memory.
    const declared = request.headers.get('Content-Length')
    if (declared === null || !/^\d+$/.test(declared)) return done(apiError(411, 'bad_request', 'Content-Length is required.'))
    if (Number(declared) > PUT_BODY_LIMIT) return done(apiError(413, 'too_large', `Documents are limited to ${SYNC_MAX_BYTES} bytes.`))
    const text = await request.text()
    if (new TextEncoder().encode(text).length > PUT_BODY_LIMIT) return done(apiError(413, 'too_large', `Documents are limited to ${SYNC_MAX_BYTES} bytes.`))
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return done(apiError(400, 'bad_request', 'Body must be JSON.'))
    }
    const result = await putDoc(store, session.user.id, syncMatch[1], body)
    if (result.status === 200) return done(json(result.doc))
    if (result.status === 409) {
      const conflict: SyncConflict = { code: 'conflict', current: result.current }
      return done(json(conflict, 409))
    }
    if (result.status === 429) return done(tooMany(result.retryAfter, 'This document has reached today’s sync limit; it will sync again tomorrow (UTC).'))
    const code = result.status === 404 ? 'not_found' : result.status === 413 ? 'too_large' : 'bad_request'
    return done(apiError(result.status, code, result.message))
  }

  if (pathname === '/api/account') {
    if (request.method !== 'DELETE') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'DELETE' })
    await store.deleteUser(session.user.id)
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', clearSessionCookie(url))
    return new Response(null, { status: 204, headers })
  }

  return apiError(404, 'not_found', 'No such route.')
}

/** FCE results are CMU-internal: only signed-in CMU users get them, and never from a shared cache. */
async function handleFce(request: Request, env: Env, deps: Deps): Promise<Response> {
  const locked = () => apiError(401, 'auth', 'Sign in with your CMU account to see course evaluations.', { 'Cache-Control': 'private, no-store' })
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'GET, HEAD' })
  const store = storeFor(env, deps)
  if (!authConfig(env) || !store) return locked()
  const session = await readSession(store, request)
  if (!session) return locked()

  const asset = await env.ASSETS.fetch(request)
  const privately = (res: Response) => {
    const out = new Response(res.body, res)
    out.headers.set('Cache-Control', 'private, max-age=300')
    out.headers.append('Vary', 'Cookie')
    return withCookies(out, [session.setCookie])
  }
  // The browser revalidating a cached file (If-None-Match): pass "not modified" through.
  if (asset.status === 304) return privately(asset)
  // A missing file comes back as the SPA's index.html; report it as missing instead.
  if (isSpaFallback(asset)) {
    return withCookies(apiError(404, 'not_found', 'Course evaluation data isn’t deployed.', { 'Cache-Control': 'private, no-store' }), [session.setCookie])
  }
  return privately(asset)
}
