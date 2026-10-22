// Synced documents with optimistic concurrency (see src/lib/api-types.ts).
import { SYNC_KEYS, SYNC_MAX_BYTES, type SyncDoc, type SyncKey, type SyncState } from '../src/lib/api-types.ts'
import type { Store, StoredDoc } from './db.ts'

const toDoc = (d: StoredDoc): SyncDoc => ({ data: JSON.parse(d.data), rev: d.rev, updatedAt: d.updatedAt })

/** A doc that doesn't exist, for conflicts where the client expected one (e.g. after an account reset). */
const MISSING: SyncDoc = { data: null, rev: 0, updatedAt: 0 }

export function isSyncKey(key: string): key is SyncKey {
  return (SYNC_KEYS as readonly string[]).includes(key)
}

export async function syncState(store: Store, userId: string): Promise<SyncState> {
  const docs: SyncState['docs'] = {}
  for (const d of await store.getDocs(userId)) if (isSyncKey(d.key)) docs[d.key] = toDoc(d)
  return { docs }
}

export type PutResult =
  | { status: 200; doc: SyncDoc }
  | { status: 409; current: SyncDoc }
  | { status: 400 | 404 | 413; message: string }

/** Applies a PUT /api/sync/:key body. `body` is the parsed JSON request body. */
export async function putDoc(store: Store, userId: string, key: string, body: unknown, now = Date.now()): Promise<PutResult> {
  if (!isSyncKey(key)) return { status: 404, message: `Unknown sync document "${key}".` }
  if (typeof body !== 'object' || body === null || !('data' in body) || !('baseRev' in body)) {
    return { status: 400, message: 'Expected { data, baseRev }.' }
  }
  const { data, baseRev } = body as { data: unknown; baseRev: unknown }
  if (data === undefined || typeof baseRev !== 'number' || !Number.isInteger(baseRev) || baseRev < 0) {
    return { status: 400, message: 'baseRev must be a non-negative integer and data must be present.' }
  }
  const text = JSON.stringify(data)
  if (new TextEncoder().encode(text).length > SYNC_MAX_BYTES) return { status: 413, message: `Documents are limited to ${SYNC_MAX_BYTES} bytes.` }

  const written = baseRev === 0 ? await store.insertDoc(userId, key, text, now) : await store.updateDoc(userId, key, text, baseRev, now)
  if (written) return { status: 200, doc: { data, rev: baseRev + 1, updatedAt: now } }
  const current = await store.getDoc(userId, key)
  return { status: 409, current: current ? toDoc(current) : MISSING }
}
