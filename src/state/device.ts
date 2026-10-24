// "Sign out and clear this device": for shared computers. Schedules, saved courses, degree plans, the academic
// record and the list of accounts used here are removed from this browser; the account keeps its synced copy, so
// signing in again brings them back. Display preferences (theme, calendar, plan layout) stay.
import { logout } from '../lib/api'
import { useOnboarding } from './onboarding'
import { usePlans } from './plan'
import { useRecord } from './record'
import { useSession } from './session'
import { useStore } from './store'
import { stopSync, syncNow } from './sync'

export type ClearResult = 'done' | 'unsynced' | 'sign-out-failed'

/** Empties this browser's copy of everyone's personal data. Sync must be stopped first, or the empty state uploads. */
export function clearDeviceData() {
  useStore.setState({ schedules: {}, activeSchedule: {}, bookmarks: {} })
  usePlans.setState({ plans: {}, activePlanId: null })
  useRecord.setState({ entries: [], overrides: {}, profile: {} })
  useOnboarding.setState({ asked: false, accounts: [], promptHidden: false })
  try {
    sessionStorage.clear()
  } catch {
    // Storage off: nothing kept there either.
  }
}

/**
 * Makes sure the account has everything (unless `force`), signs out on the server, then clears this device and
 * reloads. Nothing is cleared unless the sign-out went through: the session cookie can't be removed any other way.
 */
export async function signOutAndClear(force = false): Promise<ClearResult> {
  if (!force && !(await syncNow())) return 'unsynced'
  const res = await logout()
  if (res.kind !== 'ok' && res.kind !== 'auth') return 'sign-out-failed'
  stopSync()
  clearDeviceData()
  useSession.setState({ status: 'anonymous', user: null })
  location.reload()
  return 'done'
}
