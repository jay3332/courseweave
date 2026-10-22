import { describe, expect, it } from 'vitest'
import { onboardingDue, type OnboardingInputs } from './onboarding'

const base: OnboardingInputs = { session: 'anonymous', email: null, sync: 'idle', recordEmpty: true, asked: false, accounts: [] }
const due = (patch: Partial<OnboardingInputs>) => onboardingDue({ ...base, ...patch })

describe('onboardingDue', () => {
  it('asks a new visitor with an empty record once', () => {
    expect(due({})).toBe(true)
    expect(due({ asked: true })).toBe(false)
    expect(due({ session: 'unavailable' })).toBe(true)
  })

  it('never asks while the session is unknown or when a record exists', () => {
    expect(due({ session: 'loading' })).toBe(false)
    expect(due({ recordEmpty: false })).toBe(false)
    expect(due({ session: 'signed-in', email: 'a@andrew.cmu.edu', sync: 'synced', recordEmpty: false })).toBe(false)
  })

  it('asks a new account after its first sync, even if this browser skipped signed out', () => {
    const signedIn = { session: 'signed-in', email: 'a@andrew.cmu.edu', asked: true } as const
    expect(due({ ...signedIn, sync: 'syncing' })).toBe(false)
    expect(due({ ...signedIn, sync: 'error' })).toBe(false)
    expect(due({ ...signedIn, sync: 'synced' })).toBe(true)
    expect(due({ ...signedIn, sync: 'synced', accounts: ['a@andrew.cmu.edu'] })).toBe(false)
  })
})
