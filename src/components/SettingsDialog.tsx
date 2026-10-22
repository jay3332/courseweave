import { LogIn, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { startSignIn, useSession } from '../state/session'
import { useStore, type CalendarDisplay, type Theme } from '../state/store'
import { useSync } from '../state/sync'
import { Button, Dialog } from './ui'
import { WeekGrid, type CalendarBlock } from './WeekGrid'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

const DISPLAY_OPTIONS: { key: keyof CalendarDisplay; label: string; hint: string }[] = [
  { key: 'section', label: 'Section', hint: 'Lec 1, Rec A or Sec A next to the course number' },
  { key: 'time', label: 'Meeting time', hint: 'Shown when the block is tall enough' },
  { key: 'location', label: 'Room', hint: 'Building and room, when there is space' },
]

// Two classes back to back, so the preview shows both a lecture and a recitation.
const PREVIEW: CalendarBlock[] = [
  { key: 'l', day: 0, start: 600, end: 680, color: 4, label: '15-151', section: 'Lec 1', location: 'DH 2210' },
  { key: 'r', day: 0, start: 690, end: 740, color: 4, label: '15-151', section: 'Rec A', location: 'WEH 5310' },
]

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const display = useStore((s) => s.calendarDisplay)
  const setDisplay = useStore((s) => s.setCalendarDisplay)

  return (
    <Dialog open={open} onClose={onClose} title="Settings" className="w-[min(94vw,520px)]">
      <div className="flex flex-col gap-6 p-5">
        <AccountSection />

        <fieldset>
          <legend className="mb-2 text-[14px] font-semibold text-ink">Theme</legend>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <label
                key={value}
                className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 text-[13.5px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  theme === value ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink-2 hover:border-ink-2'
                }`}
              >
                <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => setTheme(value)} className="sr-only" />
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-[14px] font-semibold text-ink">Calendar blocks</legend>
          <p className="mb-3 text-[13px] text-muted">The course number is always shown. Choose what else appears on each class.</p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12.5rem]">
            <div className="flex flex-col gap-1">
              {DISPLAY_OPTIONS.map(({ key, label, hint }) => (
                <label key={key} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-1 py-1.5 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={display[key]}
                    onChange={(e) => setDisplay({ [key]: e.target.checked })}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-[14px] text-ink">{label}</span>
                    <span className="block text-[12.5px] text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div aria-label="Preview" className="rounded-lg border border-line bg-surface p-1.5">
              <WeekGrid blocks={PREVIEW} days={[0]} minHour={10} maxHour={13} hourHeight={56} />
            </div>
          </div>
        </fieldset>
      </div>
    </Dialog>
  )
}

const PRIVACY = 'Courseweave stores only your email, your name, and the schedules, record and plans you save.'

/** Signed-in account, sync status and data controls. Hidden when the deployment has no accounts. */
function AccountSection() {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const deleteAccount = useSession((s) => s.deleteAccount)
  const lastSyncedAt = useSync((s) => s.lastSyncedAt)
  const syncStatus = useSync((s) => s.status)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)

  if (status === 'anonymous') {
    return (
      <section aria-labelledby="settings-account">
        <h3 id="settings-account" className="mb-1 text-[14px] font-semibold text-ink">
          Account
        </h3>
        <p className="text-[13.5px] text-ink-2">
          Sign in with your Andrew account to see course evaluations (FCEs) and keep your schedules, record and degree plans in sync across your devices.
        </p>
        <p className="mt-1 text-[12.5px] text-muted">{PRIVACY}</p>
        <Button className="mt-3" variant="primary" onClick={startSignIn}>
          <LogIn className="size-4" />
          Sign in with CMU
        </Button>
      </section>
    )
  }
  if (status !== 'signed-in' || !user) return null

  const synced =
    syncStatus === 'syncing' || syncStatus === 'idle'
      ? 'Syncing…'
      : syncStatus === 'offline'
        ? 'Offline. Changes are saved on this device and sync when you reconnect.'
        : syncStatus === 'error'
          ? 'Sync error. Your changes are saved on this device.'
          : lastSyncedAt
            ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'Synced'

  return (
    <section aria-labelledby="settings-account">
      <h3 id="settings-account" className="mb-1 text-[14px] font-semibold text-ink">
        Account
      </h3>
      <p className="text-[13.5px] text-ink-2">
        Signed in as <span className="font-medium text-ink">{user.name ?? user.email}</span>
        {user.name ? <span className="text-muted"> ({user.email})</span> : null}
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted">{synced}</p>
      <p className="mt-1 text-[12.5px] text-muted">{PRIVACY}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => void signOut()}>Sign out</Button>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete my synced data
        </Button>
      </div>

      <Dialog open={confirming} onClose={() => !deleting && setConfirming(false)} title="Delete your synced data?" className="w-[min(94vw,440px)]">
        <div className="px-5 py-4">
          <p className="text-ink-2">
            This deletes your Courseweave account and everything synced to it, and signs you out. Schedules, your record and plans stay on this device.
          </p>
          {deleteFailed ? <p className="mt-2 text-[13px] text-danger">Couldn’t delete it right now. Try again in a moment.</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirming(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                setDeleteFailed(false)
                const ok = await deleteAccount()
                setDeleting(false)
                if (ok) setConfirming(false)
                else setDeleteFailed(true)
              }}
            >
              {deleting ? 'Deleting…' : 'Delete synced data'}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  )
}
