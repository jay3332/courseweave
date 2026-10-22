// Typed client for the Worker's /auth and /api endpoints (contract: lib/api-types.ts).
// When the Worker isn't running (plain `vite` dev) requests fail, 404, or come back as the SPA's index.html:
// all of that is reported as "unavailable" so the app keeps working locally.
import type { ApiError, Me, SyncConflict, SyncDoc, SyncKey, SyncPut, SyncState } from './api-types'

export type ApiResult<T> =
  | { kind: 'ok'; data: T }
  /** 401: not signed in, or the session expired. */
  | { kind: 'auth' }
  /** The Worker or the endpoint isn't there (network error, 404, HTML instead of JSON, 503 unavailable). */
  | { kind: 'unavailable' }
  | { kind: 'error'; status: number; error: ApiError | null }

const base = import.meta.env.BASE_URL

function isJson(r: Response): boolean {
  return (r.headers.get('content-type') ?? '').includes('application/json')
}

async function readError(r: Response): Promise<ApiError | null> {
  if (!isJson(r)) return null
  try {
    return (await r.json()) as ApiError
  } catch {
    return null
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let r: Response
  try {
    r = await fetch(`${base}${path.replace(/^\//, '')}`, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    return { kind: 'unavailable' }
  }
  if (r.status === 401) return { kind: 'auth' }
  // The Worker always answers errors in JSON; anything else (a dev proxy with no Worker behind it, a 404 page)
  // means accounts aren't available here.
  if (!r.ok && !isJson(r)) return { kind: 'unavailable' }
  if (r.ok) {
    if (r.status === 204) return { kind: 'ok', data: undefined as T }
    // Vite's dev server answers unknown paths with index.html.
    if (!isJson(r)) return { kind: 'unavailable' }
    try {
      return { kind: 'ok', data: (await r.json()) as T }
    } catch {
      return { kind: 'unavailable' }
    }
  }
  const error = await readError(r)
  if (r.status === 503 || error?.code === 'unavailable') return { kind: 'unavailable' }
  return { kind: 'error', status: r.status, error }
}

/** Where "Sign in" goes: the Worker starts the provider login and comes back to `returnTo`. */
export function signInUrl(returnTo: string): string {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
  return `${base}auth/login?returnTo=${encodeURIComponent(path)}`
}

export function getMe(): Promise<ApiResult<Me>> {
  return request<Me>('GET', '/api/me')
}

export function logout(): Promise<ApiResult<void>> {
  // JSON body + same-origin fetch satisfy the Worker's CSRF checks (Content-Type and Origin).
  return request<void>('POST', '/auth/logout', {})
}

export function getSync(): Promise<ApiResult<SyncState>> {
  return request<SyncState>('GET', '/api/sync')
}

export type PutResult = ApiResult<SyncDoc> | { kind: 'conflict'; current: SyncDoc } | { kind: 'too-large' }

export async function putSync(key: SyncKey, put: SyncPut): Promise<PutResult> {
  const res = await request<SyncDoc>('PUT', `/api/sync/${key}`, put)
  if (res.kind === 'error' && res.status === 409) {
    const conflict = res.error as unknown as SyncConflict | null
    if (conflict?.current) return { kind: 'conflict', current: conflict.current }
  }
  if (res.kind === 'error' && res.status === 413) return { kind: 'too-large' }
  return res
}

export function deleteAccount(): Promise<ApiResult<void>> {
  return request<void>('DELETE', '/api/account', {})
}
