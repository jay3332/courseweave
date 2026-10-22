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

vi.mock('../lib/api', () => ({
  getSync: async () => ({ kind: 'ok', data: { docs: Object.fromEntries(server) } }),
  putSync: async (key: SyncKey, put: SyncPut) => {
    puts.push({ key, put })
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
    await vi.advanceTimersByTimeAsync(2000)
    vi.useRealTimers()
    await settle()
    const last = puts.at(-1)!
    expect(last.key).toBe('record')
    expect((last.put.data as { entries: unknown[] }).entries).toHaveLength(1)
  })
})
