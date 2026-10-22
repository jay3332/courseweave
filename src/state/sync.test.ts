import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncDoc, SyncKey, SyncPut } from '../lib/api-types'

// Minimal browser globals for the engine (it listens for online/offline).
beforeAll(() => {
  const listeners = new Map<string, Set<() => void>>()
  vi.stubGlobal('window', {
    addEventListener: (t: string, f: () => void) => listeners.set(t, (listeners.get(t) ?? new Set()).add(f)),
    removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
    location: { assign: () => {}, pathname: '/', search: '' },
  })
  vi.stubGlobal('navigator', { onLine: true })
})

const server = new Map<SyncKey, SyncDoc>()
const puts: { key: SyncKey; put: SyncPut }[] = []
let conflictOnce: SyncKey | null = null
/** Responses to return instead of writing, one per PUT. */
const failures: unknown[] = []

vi.mock('../lib/api', () => ({
  getSync: async () => ({ kind: 'ok', data: { docs: Object.fromEntries(server) } }),
  putSync: async (key: SyncKey, put: SyncPut) => {
    puts.push({ key, put })
    if (failures.length) return failures.shift()
    const current = server.get(key)
    if (conflictOnce === key && current) {
      conflictOnce = null
      return { kind: 'conflict', current }
    }
    if ((current?.rev ?? 0) !== put.baseRev) return { kind: 'conflict', current: current! }
    const doc = { data: put.data, rev: (current?.rev ?? 0) + 1, updatedAt: Date.now() }
    server.set(key, doc)
    return { kind: 'ok', data: doc }
  },
  getMe: async () => ({ kind: 'unavailable' }),
  logout: async () => ({ kind: 'ok', data: undefined }),
  deleteAccount: async () => ({ kind: 'ok', data: undefined }),
  signInUrl: (p: string) => p,
}))

const { startSync, stopSync, useSync } = await import('./sync')
const { useStore } = await import('./store')
const { useRecord } = await import('./record')
const { usePlans } = await import('./plan')

const schedule = (id: string, updatedAt: number) => ({ id, termId: 'S27', name: id, entries: [], createdAt: 1, updatedAt })

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  server.clear()
  puts.length = 0
  conflictOnce = null
  failures.length = 0
  useStore.setState({ schedules: {}, activeSchedule: {}, bookmarks: {} })
  useRecord.setState({ entries: [], overrides: {}, profile: {} })
  usePlans.setState({ plans: {}, activePlanId: null })
})

afterEach(() => {
  stopSync()
  vi.useRealTimers()
})

describe('sync engine', () => {
  it('merges the server copy into this device and uploads the union', async () => {
    useStore.setState({ schedules: { a: schedule('a', 1) }, activeSchedule: { S27: 'a' } })
    server.set('schedules', { data: { schedules: { b: schedule('b', 1) }, activeSchedule: { S27: 'b' }, bookmarks: { S27: ['15122'] } }, rev: 4, updatedAt: 1 })
    await startSync()
    await settle()

    const local = useStore.getState()
    expect(Object.keys(local.schedules).sort()).toEqual(['a', 'b'])
    expect(local.activeSchedule).toEqual({ S27: 'a' })
    expect(local.bookmarks).toEqual({ S27: ['15122'] })
    const put = puts.find((p) => p.key === 'schedules')!
    expect(put.put.baseRev).toBe(4)
    expect(server.get('schedules')!.rev).toBe(5)
    expect(useSync.getState().status).toBe('synced')
  })

  it("doesn't upload when the merge equals what the server has", async () => {
    const data = { entries: [], overrides: {}, profile: {} }
    server.set('record', { data, rev: 2, updatedAt: 1 })
    await startSync()
    await settle()
    expect(puts.some((p) => p.key === 'record')).toBe(false)
  })

  it('merges and retries when another device wrote first', async () => {
    usePlans.setState({ plans: { p: { id: 'p', name: 'Mine', programs: [], startTerm: 'F25', terms: [], createdAt: 1, updatedAt: 5 } }, activePlanId: 'p' })
    server.set('plan', { data: { plans: { q: { id: 'q', name: 'Theirs', programs: [], startTerm: 'F25', terms: [], createdAt: 1, updatedAt: 1 } }, activePlanId: 'q' }, rev: 1, updatedAt: 1 })
    conflictOnce = 'plan'
    await startSync()
    await settle()
    const stored = server.get('plan')!.data as { plans: Record<string, unknown> }
    expect(Object.keys(stored.plans).sort()).toEqual(['p', 'q'])
    expect(Object.keys(usePlans.getState().plans).sort()).toEqual(['p', 'q'])
  })

  it('pushes later edits after a pause', async () => {
    await startSync()
    await settle()
    const before = puts.length
    vi.useFakeTimers()
    useRecord.setState({ entries: [{ id: 'x', courseId: '15122', source: 'taken', addedAt: 1 }] })
    expect(puts.length).toBe(before)
    await vi.advanceTimersByTimeAsync(4500)
    vi.useRealTimers()
    await settle()
    const last = puts.at(-1)!
    expect(last.key).toBe('record')
    expect((last.put.data as { entries: unknown[] }).entries).toHaveLength(1)
  })

  it('backs off on 429s instead of retrying immediately, then pushes', async () => {
    await startSync()
    await settle()
    vi.useFakeTimers()
    failures.push({ kind: 'rate-limited', retryAfter: 60 })
    useRecord.setState({ entries: [{ id: 'y', courseId: '15150', source: 'taken', addedAt: 1 }] })
    await vi.advanceTimersByTimeAsync(4500)
    const afterFirst = puts.length
    expect(useSync.getState().error).toMatch(/Sync paused/)
    // More edits during the pause wait for it to end.
    useRecord.setState({ entries: [{ id: 'y', courseId: '15150', source: 'taken', addedAt: 1 }, { id: 'z', courseId: '15210', source: 'taken', addedAt: 2 }] })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(puts.length).toBe(afterFirst)
    await vi.advanceTimersByTimeAsync(31_000)
    vi.useRealTimers()
    await settle()
    expect(puts.length).toBe(afterFirst + 1)
    expect((puts.at(-1)!.put.data as { entries: unknown[] }).entries).toHaveLength(2)
    expect(useSync.getState().status).toBe('synced')
  })

  it('retries server errors with growing gaps, not in a tight loop', async () => {
    await startSync()
    await settle()
    vi.useFakeTimers()
    const serverError = { kind: 'error', status: 500, error: null }
    failures.push(serverError, serverError, serverError)
    useRecord.setState({ entries: [{ id: 'q', courseId: '21127', source: 'taken', addedAt: 1 }] })
    await vi.advanceTimersByTimeAsync(4500)
    const n = puts.length
    await vi.advanceTimersByTimeAsync(29_000)
    expect(puts.length).toBe(n) // first backoff is 30 s
    await vi.advanceTimersByTimeAsync(2_000)
    expect(puts.length).toBe(n + 1)
    await vi.advanceTimersByTimeAsync(57_000)
    expect(puts.length).toBe(n + 1) // then 60 s
    await vi.advanceTimersByTimeAsync(3_000)
    expect(puts.length).toBe(n + 2)
    vi.useRealTimers()
  })
})
