import { useState } from 'react'
import { signOutAndClear } from '../state/device'
import { Button, Dialog } from './ui'

type Phase = 'confirm' | 'working' | 'unsynced' | 'sign-out-failed'

/** Confirms "Sign out and clear this device", for shared computers, and walks through what can go wrong. */
export function ClearDeviceDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [phase, setPhase] = useState<Phase>('confirm')
  const close = () => {
    if (phase === 'working') return
    setPhase('confirm')
    onClose()
  }
  const run = async (force: boolean) => {
    setPhase('working')
    const result = await signOutAndClear(force)
    // 'done' reloads the page.
    if (result !== 'done') setPhase(result)
  }

  return (
    <Dialog open={open} onClose={close} title="Sign out and clear this device?" className="w-[min(94vw,460px)]">
      <div className="px-5 py-4">
        <p className="text-ink-2">
          Signs you out and removes your schedules, saved courses, degree plans and academic record from this browser. Your account keeps its synced
          copy, so they come back when you sign in again. Use this on a shared or public computer.
        </p>
        {phase === 'unsynced' ? (
          <p className="mt-3 text-[13.5px] text-danger">
            Some changes haven’t reached your account yet: you may be offline, or syncing is paused. Clearing now would lose them.
          </p>
        ) : phase === 'sign-out-failed' ? (
          <p className="mt-3 text-[13.5px] text-danger">Couldn’t sign out, so nothing was cleared. Check your connection and try again.</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button onClick={close} disabled={phase === 'working'}>
            Cancel
          </Button>
          {phase === 'unsynced' ? (
            <Button variant="danger" onClick={() => void run(true)}>
              Clear anyway
            </Button>
          ) : (
            <Button variant="primary" disabled={phase === 'working'} onClick={() => void run(false)}>
              {phase === 'working' ? 'Signing out…' : phase === 'sign-out-failed' ? 'Try again' : 'Sign out and clear'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
