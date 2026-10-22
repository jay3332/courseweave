// Request routing. wrangler.jsonc sends /api/*, /auth/* and /data/fce/* here first; everything else is served as static
// assets (with the SPA fallback) without running the Worker.
import { SYNC_MAX_BYTES, type Me, type SyncConflict } from '../src/lib/api-types.ts'
import * as auth from './auth.ts'
import { d1Store, type Store } from './db.ts'
import { authConfig, devOrigins, type Env } from './env.ts'
import { apiError, csrfCheck, json } from './http.ts'
import type { Fetcher } from './oidc.ts'
import { clearSessionCookie, readSession, withCookies } from './session.ts'
import { putDoc, syncState } from './sync.ts'

export interface Deps {
  /** Overrides for tests. */
  store?: Store
  fetcher?: Fetcher
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
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
  if (isSpaFallback(asset)) return apiError(404, 'not_found', 'No such data file.')
  return asset
}

function storeFor(env: Env, deps: Deps): Store | null {
  return deps.store ?? (env.DB ? d1Store(env.DB) : null)
}

async function handleAuth(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url)
  const cfg = authConfig(env)
  const store = storeFor(env, deps)
  if (pathname === '/auth/login' && request.method === 'GET') return cfg && store ? auth.login(request, cfg, deps.fetcher) : auth.unavailable()
  if (pathname === '/auth/callback' && request.method === 'GET') return cfg && store ? auth.callback(request, cfg, store, deps.fetcher) : auth.unavailable()
  if (pathname === '/auth/logout') {
    if (request.method !== 'POST') return apiError(405, 'bad_request', 'Use POST to sign out.', { Allow: 'POST' })
    return csrfCheck(request, devOrigins(env)) ?? auth.logout(request, store)
  }
  return apiError(404, 'not_found', 'No such route.')
}

async function handleApi(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url)
  const blocked = csrfCheck(request, devOrigins(env))
  if (blocked) return blocked

  const store = storeFor(env, deps)
  if (!authConfig(env) || !store) return apiError(503, 'unavailable', 'Accounts aren’t set up on this deployment.')
  const session = await readSession(store, request)
  if (!session) return apiError(401, 'auth', 'Sign in with your CMU account.')
  const done = (res: Response) => withCookies(res, [session.setCookie])

  if (pathname === '/api/me') {
    if (request.method !== 'GET') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'GET' })
    const me: Me = { email: session.user.email, name: session.user.name, picture: session.user.picture }
    return done(json(me))
  }

  if (pathname === '/api/sync') {
    if (request.method !== 'GET') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'GET' })
    return done(json(await syncState(store, session.user.id)))
  }

  const syncMatch = /^\/api\/sync\/([a-z]+)$/.exec(pathname)
  if (syncMatch) {
    if (request.method !== 'PUT') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'PUT' })
    // Generous framing allowance over the document limit; the document itself is checked exactly in putDoc.
    const limit = SYNC_MAX_BYTES + 4096
    if (Number(request.headers.get('Content-Length') ?? 0) > limit) return apiError(413, 'too_large', `Documents are limited to ${SYNC_MAX_BYTES} bytes.`)
    const text = await request.text()
    if (new TextEncoder().encode(text).length > limit) return apiError(413, 'too_large', `Documents are limited to ${SYNC_MAX_BYTES} bytes.`)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return apiError(400, 'bad_request', 'Body must be JSON.')
    }
    const result = await putDoc(store, session.user.id, syncMatch[1], body)
    if (result.status === 200) return done(json(result.doc))
    if (result.status === 409) {
      const conflict: SyncConflict = { code: 'conflict', current: result.current }
      return done(json(conflict, 409))
    }
    const code = result.status === 404 ? 'not_found' : result.status === 413 ? 'too_large' : 'bad_request'
    return done(apiError(result.status, code, result.message))
  }

  if (pathname === '/api/account') {
    if (request.method !== 'DELETE') return apiError(405, 'bad_request', 'Method not allowed.', { Allow: 'DELETE' })
    await store.deleteUser(session.user.id)
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', clearSessionCookie(new URL(request.url)))
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
  // A missing file comes back as the SPA's index.html; report it as missing instead.
  if (isSpaFallback(asset)) {
    return withCookies(apiError(404, 'not_found', 'Course evaluation data isn’t deployed.', { 'Cache-Control': 'private, no-store' }), [session.setCookie])
  }
  const out = new Response(asset.body, asset)
  out.headers.set('Cache-Control', 'private, max-age=300')
  out.headers.append('Vary', 'Cookie')
  return withCookies(out, [session.setCookie])
}
