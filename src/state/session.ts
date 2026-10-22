// Who's signed in. Accounts need the Cloudflare Worker; without it (plain `vite` dev) the status is
// "unavailable" and the app hides every account feature and works locally as before.
import { create } from 'zustand'
import { deleteAccount, getMe, logout, signInUrl } from '../lib/api'
import type { Me } from '../lib/api-types'
import { resetFceCaches } from '../lib/fce'

export type SessionStatus = 'loading' | 'signed-in' | 'anonymous' | 'unavailable'
export type AuthError = 'domain' | 'failed'

interface SessionState {
  status: SessionStatus
  user: Me | null
  /** From ?auth_error= after a sign-in attempt. */
  authError: AuthError | null

  refresh(): Promise<void>
  /** The session ended on the server (a 401 mid-session). */
  expired(): void
  signOut(): Promise<void>
  deleteAccount(): Promise<boolean>
  setAuthError(error: AuthError | null): void
}

export const useSession = create<SessionState>()((set, get) => {
  const setStatus = (status: SessionStatus, user: Me | null) => {
    const was = get().status
    set({ status, user })
    // Gated data (FCEs) depends on the session: reload it after signing in or out.
    if ((was === 'signed-in') !== (status === 'signed-in') && was !== 'loading') resetFceCaches()
  }

  return {
    status: 'loading',
    user: null,
    authError: null,

    async refresh() {
      const res = await getMe()
      if (res.kind === 'ok') setStatus('signed-in', res.data)
      else if (res.kind === 'auth') setStatus('anonymous', null)
      else if (res.kind === 'unavailable') setStatus('unavailable', null)
      // Server errors: keep whatever we knew, defaulting to signed out.
      else if (get().status === 'loading') setStatus('anonymous', null)
    },

    expired() {
      if (get().status === 'signed-in') setStatus('anonymous', null)
    },

    async signOut() {
      await logout()
      setStatus('anonymous', null)
    },

    async deleteAccount() {
      const res = await deleteAccount()
      if (res.kind !== 'ok' && res.kind !== 'auth') return false
      setStatus('anonymous', null)
      return true
    },

    setAuthError(error) {
      set({ authError: error })
    },
  }
})

/** Starts sign-in, coming back to the current page. */
export function startSignIn() {
  window.location.assign(signInUrl(window.location.pathname + window.location.search))
}
