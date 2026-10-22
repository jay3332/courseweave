// Contract between the app and the Cloudflare Worker (worker/). Type-only: imported by both sides.
//
// Auth (OpenID Connect; Google limited to CMU domains by default, any OIDC issuer by config):
//   GET  /auth/login?returnTo=<path>   302 to the provider. returnTo must be a same-site path; defaults to "/".
//   GET  /auth/callback                Provider redirect target; sets the session cookie, 302 to returnTo.
//                                      On a non-CMU account: 302 to returnTo with ?auth_error=domain.
//   POST /auth/logout                  204; clears the session cookie and deletes the session.
//
// API (JSON; state-changing requests must send Content-Type: application/json and a same-origin Origin header):
//   GET    /api/me                     200 Me | 401 ApiError
//   GET    /api/sync                   200 SyncState | 401
//   PUT    /api/sync/:key              body SyncPut → 200 SyncDoc | 409 SyncConflict | 401 | 413 (over SYNC_MAX_BYTES)
//   DELETE /api/account                204; deletes the user, their sessions and synced data | 401
//
// Gated data:
//   GET /data/fce/*                    200 file when signed in | 401 ApiError (code "auth") | 404 when not deployed
//
// When the Worker isn't running (plain `vite` dev), /api and /auth requests fail or 404: the app treats that as
// "accounts unavailable" and keeps working locally.

export interface Me {
  /** Verified email, lowercase, e.g. "jdoe@andrew.cmu.edu". */
  email: string
  name: string | null
  picture: string | null
}

export interface ApiError {
  code: 'auth' | 'forbidden' | 'not_found' | 'conflict' | 'too_large' | 'bad_request' | 'unavailable'
  message: string
}

/** Synced documents. Each holds one persisted store's state. */
export type SyncKey = 'schedules' | 'record' | 'plan'

export const SYNC_KEYS: readonly SyncKey[] = ['schedules', 'record', 'plan'] as const

/** Largest accepted document body, in bytes of JSON. */
export const SYNC_MAX_BYTES = 512 * 1024

export interface SyncDoc {
  /** The store's persisted state (whatever the app stores; the server treats it as opaque JSON). */
  data: unknown
  /** Increments on every successful write; 0 never exists on the server. */
  rev: number
  /** Server time of the last write, ms since epoch. */
  updatedAt: number
}

export interface SyncState {
  docs: Partial<Record<SyncKey, SyncDoc>>
}

export interface SyncPut {
  data: unknown
  /** The rev this write is based on; 0 when creating. A mismatch returns 409 with the current doc. */
  baseRev: number
}

export interface SyncConflict {
  code: 'conflict'
  current: SyncDoc
}
