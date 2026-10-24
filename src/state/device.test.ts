import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ logout: vi.fn() }))
const sync = vi.hoisted(() => ({ syncNow: vi.fn(), stopSync: vi.fn() }))
vi.mock('../lib/api', async (load) => ({ ...(await load<typeof import('../lib/api')>()), logout: api.logout }))
vi.mock('./sync', async (load) => ({ ...(await load<typeof import('./sync')>()), syncNow: sync.syncNow, stopSync: sync.stopSync }))

const { clearDeviceData, signOutAndClear } = await import('./device')
const { useStore } = await import('./store')
const { usePlans } = await import('./plan')
const { useRecord } = await import('./record')
const { useOnboarding } = await import('./onboarding')

const reload = vi.fn()
vi.stubGlobal('location', { reload })

function fill() {
  useStore.setState({ schedules: { s: { id: 's', termId: 'F26', name: 'Mine', entries: [], createdAt: 0, updatedAt: 0 } }, activeSchedule: { F26: 's' }, bookmarks: { F26: ['15122'] }, theme: 'dark', planLayout: 'table' })
  usePlans.setState({ plans: { p: { id: 'p', name: 'Plan', programs: [], startTerm: 'F25', terms: [], createdAt: 0, updatedAt: 0 } }, activePlanId: 'p' })
  useRecord.setState({ entries: [{ id: 'e', courseId: '15122', source: 'taken', term: 'F25', grade: 'A', addedAt: 0 }], overrides: { x: true } as never, profile: { entryTerm: 'F25' } })
  useOnboarding.setState({ asked: true, accounts: ['someone@andrew.cmu.edu'], promptHidden: true })
}

const cleared = () =>
  Object.keys(useStore.getState().schedules).length === 0 &&
  Object.keys(usePlans.getState().plans).length === 0 &&
  useRecord.getState().entries.length === 0 &&
  useOnboarding.getState().accounts.length === 0

beforeEach(() => {
  vi.clearAllMocks()
  fill()
})

describe('clearing this device', () => {
  it('removes personal data and keeps display preferences', () => {
    clearDeviceData()
    expect(cleared()).toBe(true)
    expect(useStore.getState().bookmarks).toEqual({})
    expect(useRecord.getState().profile).toEqual({})
    expect(useOnboarding.getState().asked).toBe(false)
    expect(useStore.getState().theme).toBe('dark')
    expect(useStore.getState().planLayout).toBe('table')
  })

  it('signs out, stops syncing first, then clears and reloads', async () => {
    sync.syncNow.mockResolvedValue(true)
    api.logout.mockResolvedValue({ kind: 'ok', data: undefined })
    expect(await signOutAndClear()).toBe('done')
    expect(sync.stopSync).toHaveBeenCalled()
    expect(cleared()).toBe(true)
    expect(reload).toHaveBeenCalled()
  })

  it('keeps everything when changes haven’t reached the account, unless told to go ahead', async () => {
    sync.syncNow.mockResolvedValue(false)
    api.logout.mockResolvedValue({ kind: 'ok', data: undefined })
    expect(await signOutAndClear()).toBe('unsynced')
    expect(api.logout).not.toHaveBeenCalled()
    expect(cleared()).toBe(false)
    expect(await signOutAndClear(true)).toBe('done')
    expect(cleared()).toBe(true)
  })

  it('clears nothing when the sign-out doesn’t go through', async () => {
    sync.syncNow.mockResolvedValue(true)
    api.logout.mockResolvedValue({ kind: 'error', status: 0, message: 'offline' })
    expect(await signOutAndClear()).toBe('sign-out-failed')
    expect(cleared()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
