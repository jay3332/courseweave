// /auth/* routes: login (redirect to the provider), callback (create the session), logout.
import { pkceChallenge, randomToken, safeEqual, signPayload, verifyPayload } from './crypto.ts'
import type { Store } from './db.ts'
import type { AuthConfig } from './env.ts'
import { apiError, isLocalHttp, parseCookies, redirect, safeReturnTo, serializeCookie, withQuery } from './http.ts'
import { allowedEmail, authorizeUrl, discover, exchangeCode, fetchJwks, isGoogle, verifyIdToken, type Fetcher } from './oidc.ts'
import { clearSessionCookie, createSession, readSession } from './session.ts'

const LOGIN_COOKIE = 'cw_oidc'
const LOGIN_TTL = 10 * 60 * 1000

/** What survives the round trip to the provider, in a signed HttpOnly cookie scoped to /auth. */
interface LoginState {
  s: string // state
  n: string // nonce
  v: string // PKCE code verifier
  r: string // returnTo
  e: number // expires at (ms)
}

function loginCookie(url: URL, value: string, maxAgeMs: number): string {
  return serializeCookie(LOGIN_COOKIE, value, { path: '/auth', maxAge: maxAgeMs / 1000, httpOnly: true, secure: !isLocalHttp(url), sameSite: 'Lax' })
}

const callbackUri = (url: URL) => `${url.origin}/auth/callback`

export async function login(request: Request, cfg: AuthConfig, fetcher: Fetcher = fetch): Promise<Response> {
  const url = new URL(request.url)
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
  const d = await discover(cfg.issuer, fetcher)
  const state: LoginState = { s: randomToken(16), n: randomToken(16), v: randomToken(32), r: returnTo, e: Date.now() + LOGIN_TTL }
  const location = authorizeUrl(d, {
    clientId: cfg.clientId,
    redirectUri: callbackUri(url),
    state: state.s,
    nonce: state.n,
    challenge: await pkceChallenge(state.v),
    hostedDomain: isGoogle(cfg.issuer) ? cfg.domains[0] : undefined,
  })
  return redirect(location, [loginCookie(url, await signPayload(state, cfg.sessionSecret), LOGIN_TTL)])
}

export async function callback(request: Request, cfg: AuthConfig, store: Store, fetcher: Fetcher = fetch): Promise<Response> {
  const url = new URL(request.url)
  const now = Date.now()
  const state = await verifyPayload<LoginState>(parseCookies(request.headers.get('Cookie')).get(LOGIN_COOKIE), cfg.sessionSecret)
  const fresh = state !== null && state.e > now
  const returnTo = fresh ? safeReturnTo(state.r) : '/'
  const clear = loginCookie(url, '', 0)
  const fail = (reason: 'failed' | 'domain') => redirect(withQuery(returnTo, 'auth_error', reason), [clear])

  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  if (!fresh || url.searchParams.has('error') || !code || !returnedState || !safeEqual(returnedState, state.s)) return fail('failed')

  try {
    const d = await discover(cfg.issuer, fetcher)
    const { idToken } = await exchangeCode(d, { code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: callbackUri(url), verifier: state.v }, fetcher)
    const claims = await verifyIdToken(idToken, {
      issuer: d.issuer,
      clientId: cfg.clientId,
      nonce: state.n,
      keys: (refresh) => fetchJwks(d.jwks_uri, refresh, fetcher),
    })
    const allowed = allowedEmail(claims, cfg.domains)
    if ('reason' in allowed) return fail('domain')

    const user = await store.upsertUser({ email: allowed.email, name: claims.name ?? null, picture: claims.picture ?? null }, now)
    await store.deleteExpiredSessions(now)
    return redirect(returnTo, [clear, await createSession(store, url, user.id, now)])
  } catch (e) {
    console.error('Sign-in failed:', e instanceof Error ? e.message : e)
    return fail('failed')
  }
}

export async function logout(request: Request, store: Store | null): Promise<Response> {
  const url = new URL(request.url)
  if (store) {
    const session = await readSession(store, request)
    if (session) await store.deleteSession(session.idHash)
  }
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', clearSessionCookie(url))
  return new Response(null, { status: 204, headers })
}

export function unavailable(): Response {
  return apiError(503, 'unavailable', 'Sign-in isn’t set up on this deployment.')
}
