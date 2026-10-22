// Small HTTP helpers: JSON responses, cookies, redirect targets, CSRF.
import type { ApiError } from '../src/lib/api-types.ts'

export type HeaderMap = Record<string, string>

export function json(body: unknown, status = 200, headers: HeaderMap = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

export function apiError(status: number, code: ApiError['code'], message: string, headers: HeaderMap = {}): Response {
  const body: ApiError = { code, message }
  return json(body, status, headers)
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

// ---------------------------------------------------------------------------
// Cookies

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try {
      value = decodeURIComponent(value)
    } catch {
      continue
    }
    if (name && !out.has(name)) out.set(name, value)
  }
  return out
}

export interface CookieOptions {
  maxAge?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? '/'}`]
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`)
  if (opts.httpOnly ?? true) parts.push('HttpOnly')
  if (opts.secure) parts.push('Secure')
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  return parts.join('; ')
}

/** Local development over plain http (wrangler dev): cookies can't be Secure or use the __Host- prefix. */
export function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
}

// ---------------------------------------------------------------------------
// Redirect targets

/**
 * A same-site path to send the user back to after signing in. Anything else (absolute URLs, protocol-relative
 * "//host", backslash tricks, control characters, /auth/* loops) becomes "/".
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f || ch === '\\') return '/'
  }
  let parsed: URL
  try {
    parsed = new URL(value, 'https://courseweave.invalid')
  } catch {
    return '/'
  }
  if (parsed.origin !== 'https://courseweave.invalid') return '/'
  if (parsed.pathname === '/auth' || parsed.pathname.startsWith('/auth/')) return '/'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** `path` with `?key=value` added (or replaced), keeping the rest of its query and hash. */
export function withQuery(path: string, key: string, value: string): string {
  const parsed = new URL(path, 'https://courseweave.invalid')
  parsed.searchParams.set(key, value)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

// ---------------------------------------------------------------------------
// CSRF

/**
 * State-changing requests must be same-origin JSON: browsers only send a cross-site JSON request after a CORS
 * preflight (which this Worker never approves), and the Origin header names the page that sent it.
 * `extraOrigins` allows the Vite dev server in front of `wrangler dev`.
 */
export function csrfCheck(request: Request, extraOrigins: string[] = []): Response | null {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return null
  const type = request.headers.get('Content-Type') ?? ''
  if (!/^application\/json\s*(;|$)/i.test(type)) return apiError(403, 'forbidden', 'Requests that change data must be JSON.')
  const origin = request.headers.get('Origin')
  const own = new URL(request.url).origin
  if (!origin || (origin !== own && !extraOrigins.includes(origin))) return apiError(403, 'forbidden', 'Cross-site request refused.')
  return null
}
