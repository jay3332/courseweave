// First-run prompt to add the academic record (past courses, AP/IB/transfer credit). Asked once per browser, and once
// more for each new account signed in on it; never when a record already exists. Kept on this device only.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useRecord } from './record'
import { useSession, type SessionStatus } from './session'
import { useSync, type SyncStatus } from './sync'

/** Most accounts remembered per browser; older ones are dropped first. */
const MAX_ACCOUNTS = 10

interface OnboardingState {
  /** This browser was asked (the student added their record or skipped). */
  asked: boolean
  /** Accounts asked on this browser (lowercase emails), so a new account is asked even after skipping signed out. */
  accounts: string[]
  /** The "add your record" nudges on other pages were closed. */
  promptHidden: boolean
  markAsked(email: string | null): void
  hidePrompt(): void
}

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set) => ({
      asked: false,
      accounts: [],
      promptHidden: false,
      markAsked: (email) =>
        set((s) => ({
          asked: true,
          accounts: email && !s.accounts.includes(email) ? [...s.accounts, email].slice(-MAX_ACCOUNTS) : s.accounts,
        })),
      hidePrompt: () => set({ promptHidden: true }),
    }),
    { name: 'courseweave-onboarding', version: 1, partialize: ({ asked, accounts, promptHidden }) => ({ asked, accounts, promptHidden }) },
  ),
)

export interface OnboardingInputs {
  session: SessionStatus
  email: string | null
  sync: SyncStatus
  recordEmpty: boolean
  asked: boolean
  accounts: string[]
}

/** Whether to ask now. Signed in, it waits for the first sync so a record saved on another device isn't asked for again. */
export function onboardingDue(i: OnboardingInputs): boolean {
  if (!i.recordEmpty || i.session === 'loading') return false
  if (i.session === 'signed-in') return i.sync === 'synced' && !!i.email && !i.accounts.includes(i.email)
  return !i.asked
}

export function useOnboardingDue(): boolean {
  const session = useSession((s) => s.status)
  const email = useSession((s) => s.user?.email ?? null)
  const sync = useSync((s) => s.status)
  const recordEmpty = useRecord((s) => s.entries.length === 0 && Object.keys(s.overrides).length === 0)
  const asked = useOnboarding((s) => s.asked)
  const accounts = useOnboarding((s) => s.accounts)
  return onboardingDue({ session, email, sync, recordEmpty, asked, accounts })
}
