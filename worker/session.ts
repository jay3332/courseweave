// Sessions: a random token in an HttpOnly cookie; the database keeps only its SHA-256 hash.
import { randomToken, sha256 } from './crypto.ts'
import type { Store, User } from './db.ts'
import { isLocalHttp, parseCookies, serializeCookie } from './http.ts'

const DAY = 24 * 60 * 60 * 1000
export const SESSION_TTL = 30 * DAY
/** Sessions are extended at most once a day (sliding expiry), so most requests don't write. */
export const SESSION_REFRESH_AFTER = DAY

/** `__Host-` cookies must be Secure; on http://localhost (wrangler dev) a plain name is used instead. */
export function sessionCookieName(url: URL): string {
  return isLocalHttp(url) ? 'cw_session' : '__Host-cw_session'
}

export function sessionCookie(url: URL, token: string, maxAgeMs: number): string {
  return serializeCookie(sessionCookieName(url), token, { maxAge: maxAgeMs / 1000, secure: !isLocalHttp(url), httpOnly: true, sameSite: 'Lax', path: '/' })
}

export function clearSessionCookie(url: URL): string {
  return sessionCookie(url, '', 0)
}

export interface Session {
  user: User
  idHash: string
  /** A refreshed cookie to send back, when the expiry was extended. */
  setCookie?: string
}

export async function createSession(store: Store, url: URL, userId: string, now = Date.now()): Promise<string> {
  const token = randomToken(32)
  await store.createSession(await sha256(token), userId, now, now + SESSION_TTL)
  return sessionCookie(url, token, SESSION_TTL)
}

let touchFailureLogged = false

/** The session token in a request's cookie, if any (not validated). */
export function sessionToken(request: Request): string | null {
  const token = parseCookies(request.headers.get('Cookie')).get(sessionCookieName(new URL(request.url)))
  return token && token.length <= 128 ? token : null
}

/** The signed-in user for a request, or null. Expired sessions are deleted. */
export async function readSession(store: Store, request: Request, now = Date.now()): Promise<Session | null> {
  const url = new URL(request.url)
  const token = sessionToken(request)
  if (!token) return null
  const idHash = await sha256(token)
  const found = await store.findSession(idHash)
  if (!found) return null
  if (found.expiresAt <= now) {
    await store.deleteSession(idHash)
    return null
  }
  const session: Session = { user: found.user, idHash }
  if (found.expiresAt - now < SESSION_TTL - SESSION_REFRESH_AFTER) {
    // Extending the session is a nicety: if the write fails (e.g. the database's daily write limit), the session
    // is still valid, so the request goes ahead.
    try {
      await store.touchSession(idHash, now + SESSION_TTL)
      session.setCookie = sessionCookie(url, token, SESSION_TTL)
    } catch (e) {
      if (!touchFailureLogged) {
        touchFailureLogged = true
        console.error('Could not extend a session:', e instanceof Error ? e.message : e)
      }
    }
  }
  return session
}

/** Copies a response and appends Set-Cookie headers. */
export function withCookies(response: Response, cookies: (string | undefined)[]): Response {
  const list = cookies.filter((c): c is string => Boolean(c))
  if (!list.length) return response
  const copy = new Response(response.body, response)
  for (const c of list) copy.headers.append('Set-Cookie', c)
  return copy
}
