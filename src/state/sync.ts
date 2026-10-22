// Cloud sync for signed-in users: schedules (+ bookmarks), the academic record and degree plans.
//
// On start: pull every document, merge it with this device's copy (lib/sync-merge.ts: unions, nothing local is
// dropped), write the merge into the stores, and push it if it differs from the server. Then every store change
// is pushed after a short pause. A 409 (another device wrote first) merges the server's copy in and retries.
// Device-only settings (theme, calendar display) never sync.
import { create } from 'zustand'
import { getSync, putSync } from '../lib/api'
import type { SyncDoc, SyncKey } from '../lib/api-types'
import {
  mergePlanDoc,
  mergeRecordDoc,
  mergeSchedulesDoc,
  normalizePlanDoc,
  normalizeRecordDoc,
  normalizeSchedulesDoc,
  stableStringify,
  type PlanDoc,
  type RecordDoc,
  type SchedulesDoc,
} from '../lib/sync-merge'
import { usePlans } from './plan'
import { useRecord } from './record'
import { useSession } from './session'
import { useStore } from './store'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error'

interface SyncState {
  status: SyncStatus
  lastSyncedAt: number | null
  /** User-facing reason for status "error". */
  error: string | null
}

export const useSync = create<SyncState>(() => ({ status: 'idle', lastSyncedAt: null, error: null }))

interface Adapter<T> {
  key: SyncKey
  read(): T
  write(doc: T): void
  normalize(raw: unknown): T | null
  merge(local: T, remote: T): T
  subscribe(onChange: () => void): () => void
}

const schedulesAdapter: Adapter<SchedulesDoc> = {
  key: 'schedules',
  read: () => {
    const s = useStore.getState()
    return { schedules: s.schedules, activeSchedule: s.activeSchedule, bookmarks: s.bookmarks }
  },
  write: (doc) => useStore.setState({ schedules: doc.schedules, activeSchedule: doc.activeSchedule, bookmarks: doc.bookmarks }),
  normalize: normalizeSchedulesDoc,
  merge: mergeSchedulesDoc,
  subscribe: (cb) => useStore.subscribe((s, prev) => (s.schedules !== prev.schedules || s.activeSchedule !== prev.activeSchedule || s.bookmarks !== prev.bookmarks) && cb()),
}

const recordAdapter: Adapter<RecordDoc> = {
  key: 'record',
  read: () => {
    const s = useRecord.getState()
    return { entries: s.entries, overrides: s.overrides, profile: s.profile }
  },
  write: (doc) => useRecord.setState({ entries: doc.entries, overrides: doc.overrides, profile: doc.profile }),
  normalize: normalizeRecordDoc,
  merge: mergeRecordDoc,
  subscribe: (cb) => useRecord.subscribe((s, prev) => (s.entries !== prev.entries || s.overrides !== prev.overrides || s.profile !== prev.profile) && cb()),
}

const planAdapter: Adapter<PlanDoc> = {
  key: 'plan',
  read: () => {
    const s = usePlans.getState()
    return { plans: s.plans, activePlanId: s.activePlanId }
  },
  write: (doc) => usePlans.setState({ plans: doc.plans, activePlanId: doc.activePlanId }),
  normalize: normalizePlanDoc,
  merge: mergePlanDoc,
  subscribe: (cb) => usePlans.subscribe((s, prev) => (s.plans !== prev.plans || s.activePlanId !== prev.activePlanId) && cb()),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ADAPTERS: Adapter<any>[] = [schedulesAdapter, recordAdapter, planAdapter]

/** Quiet time before pushing a change; batches bursts of edits into one write (each write costs the server). */
const DEBOUNCE_MS = 4000
/** Longest wait honoured from a 429's Retry-After (the daily cap can ask for up to a day). */
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000
const MAX_CONFLICT_RETRIES = 3

interface KeyState {
  /** Server rev our last read/write was based on (0 = the server has none). */
  rev: number
  /** stableStringify of what the server holds as far as we know. */
  uploaded: string | null
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<void> | null
  /** Changed while a push was in flight; push again afterwards. */
  dirty: boolean
  /** No pushes before this time (ms): set by 429s and server errors so clients back off instead of retrying hot. */
  pausedUntil: number
  /** Next backoff after a server error (ms); doubles up to a cap, resets on success. */
  errorBackoff: number
}

const FIRST_ERROR_BACKOFF_MS = 30_000
const MAX_ERROR_BACKOFF_MS = 10 * 60 * 1000

let running = false
/** Bumped on every start/stop so stale async work from a previous session bails out. */
let epoch = 0
let applying = false
let unsubscribers: (() => void)[] = []
const keys = new Map<SyncKey, KeyState>()

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function setStatus(status: SyncStatus, error: string | null = null) {
  useSync.setState((s) => ({ status, error, lastSyncedAt: status === 'synced' ? Date.now() : s.lastSyncedAt }))
}

/** Writes into a store without echoing the change back as a push. */
function apply<T>(adapter: Adapter<T>, doc: T) {
  applying = true
  try {
    adapter.write(doc)
  } finally {
    applying = false
  }
}

function anyBusy(): boolean {
  for (const k of keys.values()) if (k.inFlight || k.timer || k.dirty) return true
  return false
}

function settle() {
  if (!running) return
  if (anyBusy()) return
  if (isOffline()) setStatus('offline')
  else if (useSync.getState().status !== 'error') setStatus('synced')
}

async function push<T>(adapter: Adapter<T>, myEpoch: number): Promise<void> {
  const k = keys.get(adapter.key)!
  if (isOffline()) {
    k.dirty = true
    setStatus('offline')
    return
  }
  let attempts = 0
  while (running && myEpoch === epoch) {
    const data = adapter.read()
    const body = stableStringify(data)
    if (body === k.uploaded) return
    setStatus('syncing')
    const res = await putSync(adapter.key, { data, baseRev: k.rev })
    if (myEpoch !== epoch) return
    if (res.kind === 'ok') {
      k.rev = res.data.rev
      k.uploaded = body
      k.errorBackoff = FIRST_ERROR_BACKOFF_MS
      // The store may have changed while the request was out; the loop pushes again if so.
      continue
    }
    if (res.kind === 'conflict') {
      if (++attempts > MAX_CONFLICT_RETRIES) {
        setStatus('error', 'Another device keeps changing the same data. Try again in a moment.')
        return
      }
      mergeRemote(adapter, res.current)
      continue
    }
    if (res.kind === 'auth') {
      stopSync()
      useSession.getState().expired()
      return
    }
    if (res.kind === 'too-large') {
      setStatus('error', 'Your saved data is too large to sync. Remove some schedules or plans and try again.')
      return
    }
    if (res.kind === 'rate-limited') {
      // Keep the change (it's still in the store) and push it once the server is ready again.
      const waitMs = Math.min(res.retryAfter * 1000, MAX_BACKOFF_MS)
      setStatus('error', `Sync paused, retrying ${waitMs >= 60 * 60 * 1000 ? 'in a few hours' : waitMs >= 2 * 60 * 1000 ? `in ${Math.round(waitMs / 60_000)} minutes` : 'in a minute'}. Your changes are saved on this device.`)
      pauseAndRetry(adapter, k, myEpoch, waitMs)
      return
    }
    if (isOffline() || res.kind === 'unavailable') {
      // Pushed again by the `online` handler or the next change.
      k.dirty = true
      setStatus('offline')
      return
    }
    // A server error: retry later with growing gaps, never in a tight loop.
    setStatus('error', 'Couldn’t reach the sync server. Your changes are saved on this device.')
    pauseAndRetry(adapter, k, myEpoch, k.errorBackoff)
    k.errorBackoff = Math.min(k.errorBackoff * 2, MAX_ERROR_BACKOFF_MS)
    return
  }
}

/** Holds pushes for `waitMs`, then pushes whatever the store holds by then. */
function pauseAndRetry<T>(adapter: Adapter<T>, k: KeyState, myEpoch: number, waitMs: number) {
  k.dirty = false
  k.pausedUntil = Date.now() + waitMs
  if (k.timer) clearTimeout(k.timer)
  k.timer = setTimeout(() => {
    k.timer = null
    flush(adapter, myEpoch)
  }, waitMs)
}

/** Folds a server copy into this device's state and records its rev. */
function mergeRemote<T>(adapter: Adapter<T>, doc: SyncDoc) {
  const k = keys.get(adapter.key)!
  const remote = adapter.normalize(doc.data)
  k.rev = doc.rev
  if (!remote) return
  const local = adapter.read()
  const merged = adapter.merge(local, remote)
  if (stableStringify(merged) !== stableStringify(local)) apply(adapter, merged)
  k.uploaded = stableStringify(remote)
}

function schedulePush<T>(adapter: Adapter<T>) {
  if (!running || applying) return
  const k = keys.get(adapter.key)!
  if (k.timer) clearTimeout(k.timer)
  const myEpoch = epoch
  // While paused (rate limit or server trouble), edits wait for the pause to end rather than pushing early.
  const delay = Math.max(DEBOUNCE_MS, k.pausedUntil - Date.now())
  k.timer = setTimeout(() => {
    k.timer = null
    flush(adapter, myEpoch)
  }, delay)
  if (useSync.getState().status === 'synced') setStatus('syncing')
}

function flush<T>(adapter: Adapter<T>, myEpoch: number) {
  const k = keys.get(adapter.key)!
  if (k.inFlight) {
    k.dirty = true
    return
  }
  k.dirty = false
  k.inFlight = push(adapter, myEpoch).finally(() => {
    k.inFlight = null
    if (k.dirty && running && myEpoch === epoch && !isOffline()) flush(adapter, myEpoch)
    else settle()
  })
}

function flushAll() {
  for (const a of ADAPTERS) flush(a, epoch)
}

function onOnline() {
  if (running) flushAll()
}

function onOffline() {
  if (running) setStatus('offline')
}

/** Starts syncing for the signed-in user. Safe to call more than once. */
export async function startSync(): Promise<void> {
  if (running) return
  running = true
  const myEpoch = ++epoch
  for (const a of ADAPTERS) keys.set(a.key, { rev: 0, uploaded: null, timer: null, inFlight: null, dirty: false, pausedUntil: 0, errorBackoff: FIRST_ERROR_BACKOFF_MS })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  // Collect edits made during the initial pull; they're pushed once the merge is in.
  const pending = new Set<SyncKey>()
  unsubscribers = ADAPTERS.map((a) =>
    a.subscribe(() => {
      if (applying) return // our own merge writes
      if (keys.get(a.key)?.uploaded === null) pending.add(a.key)
      else schedulePush(a)
    }),
  )

  if (isOffline()) {
    setStatus('offline')
    return
  }
  setStatus('syncing')
  const res = await getSync()
  if (myEpoch !== epoch) return
  if (res.kind === 'auth') {
    stopSync()
    useSession.getState().expired()
    return
  }
  if (res.kind === 'error' && res.status === 429) {
    // Too many requests from this network right now: try the whole pull again after the server's wait.
    setStatus('error', 'Sync paused, retrying in a minute. Your changes are saved on this device.')
    setTimeout(() => {
      if (myEpoch === epoch) {
        stopSync()
        void startSync()
      }
    }, Math.min((res.retryAfter ?? 60) * 1000, MAX_BACKOFF_MS))
    return
  }
  if (res.kind !== 'ok') {
    setStatus(res.kind === 'unavailable' ? 'offline' : 'error', res.kind === 'unavailable' ? null : 'Couldn’t load your synced data. Your changes are saved on this device.')
    // Retry the whole pull on reconnect.
    const retry = () => {
      window.removeEventListener('online', retry)
      if (myEpoch === epoch) {
        stopSync()
        void startSync()
      }
    }
    window.addEventListener('online', retry)
    return
  }

  for (const a of ADAPTERS) {
    const k = keys.get(a.key)!
    const doc = res.data.docs[a.key]
    if (doc) mergeRemote(a, doc)
    else k.uploaded = '' // nothing on the server yet; any local data differs and gets pushed
    flush(a, myEpoch)
  }
  for (const key of pending) {
    const a = ADAPTERS.find((x) => x.key === key)
    if (a) schedulePush(a)
  }
}

/** Stops syncing (sign-out, session expiry). Local data stays as it is. */
export function stopSync() {
  running = false
  epoch++
  for (const u of unsubscribers) u()
  unsubscribers = []
  for (const k of keys.values()) if (k.timer) clearTimeout(k.timer)
  keys.clear()
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  useSync.setState({ status: 'idle', error: null })
}

/** Retries after an error (from the account menu). */
export function retrySync() {
  if (!running) {
    void startSync()
    return
  }
  setStatus('syncing')
  flushAll()
}
