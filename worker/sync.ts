// Synced documents with optimistic concurrency (see src/lib/api-types.ts).
import { SYNC_DAILY_WRITES, SYNC_KEYS, SYNC_MAX_BYTES, type SyncDoc, type SyncKey } from '../src/lib/api-types.ts'
import { utcDay, type Store, type StoredDoc } from './db.ts'

const toDoc = (d: StoredDoc): SyncDoc => ({ data: JSON.parse(d.data), rev: d.rev, updatedAt: d.updatedAt })

/** A doc that doesn't exist, for conflicts where the client expected one (e.g. after an account reset). */
const MISSING: SyncDoc = { data: null, rev: 0, updatedAt: 0 }

export function isSyncKey(key: string): key is SyncKey {
  return (SYNC_KEYS as readonly string[]).includes(key)
}

/**
 * The GET /api/sync body as JSON text. Stored documents are JSON this Worker wrote itself, so they're spliced in
 * as-is rather than parsed and re-serialized (which costs CPU time on large documents).
 */
export async function syncStateText(store: Store, userId: string): Promise<string> {
  const parts: string[] = []
  for (const d of await store.getDocs(userId)) {
    if (!isSyncKey(d.key)) continue
    parts.push(`${JSON.stringify(d.key)}:{"data":${d.data},"rev":${Number(d.rev)},"updatedAt":${Number(d.updatedAt)}}`)
  }
  return `{"docs":{${parts.join(',')}}}`
}

export type PutResult =
  | { status: 200; doc: SyncDoc }
  | { status: 409; current: SyncDoc }
  /** The document reached its daily write cap; `retryAfter` is seconds until the next UTC day. */
  | { status: 429; retryAfter: number }
  | { status: 400 | 404 | 413; message: string }

/** Seconds from `now` until the next UTC midnight. */
export function secondsUntilNextUtcDay(now: number): number {
  return Math.ceil(((utcDay(now) + 1) * 86_400_000 - now) / 1000)
}

/** Applies a PUT /api/sync/:key body. `body` is the parsed JSON request body. */
export async function putDoc(store: Store, userId: string, key: string, body: unknown, now = Date.now(), dailyCap = SYNC_DAILY_WRITES): Promise<PutResult> {
  if (!isSyncKey(key)) return { status: 404, message: `Unknown sync document "${key}".` }
  if (typeof body !== 'object' || body === null || !('data' in body) || !('baseRev' in body)) {
    return { status: 400, message: 'Expected { data, baseRev }.' }
  }
  const { data, baseRev } = body as { data: unknown; baseRev: unknown }
  if (data === undefined || typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) {
    return { status: 400, message: 'baseRev must be a non-negative integer and data must be present.' }
  }
  let text: string
  try {
    // Throws on pathological input (e.g. nesting deep enough to overflow the stack).
    text = JSON.stringify(data)
  } catch {
    return { status: 400, message: 'The document couldn’t be serialized.' }
  }
  if (new TextEncoder().encode(text).length > SYNC_MAX_BYTES) return { status: 413, message: `Documents are limited to ${SYNC_MAX_BYTES} bytes.` }

  const written = baseRev === 0 ? await store.insertDoc(userId, key, text, now) : await store.updateDoc(userId, key, text, baseRev, now, dailyCap)
  if (written) return { status: 200, doc: { data, rev: baseRev + 1, updatedAt: now } }
  const current = await store.getDoc(userId, key)
  // Same rev as the client expected but not written: the daily cap, not a conflict.
  if (current && current.rev === baseRev && current.day === utcDay(now) && current.dayWrites >= dailyCap) {
    return { status: 429, retryAfter: secondsUntilNextUtcDay(now) }
  }
  return { status: 409, current: current ? toDoc(current) : MISSING }
}
