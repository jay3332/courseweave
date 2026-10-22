import { AlertTriangle, Check, CloudOff, LogIn, LogOut, RefreshCw, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { startSignIn, useSession } from '../state/session'
import { retrySync, useSync, type SyncStatus } from '../state/sync'
import { Button, IconButton } from './ui'

const STATUS: Record<SyncStatus, { text: string; icon: typeof Check; tone: string }> = {
  idle: { text: 'Connecting…', icon: RefreshCw, tone: 'text-muted' },
  syncing: { text: 'Syncing…', icon: RefreshCw, tone: 'text-muted' },
  synced: { text: 'Synced', icon: Check, tone: 'text-ok' },
  offline: { text: 'Offline, changes saved on this device', icon: CloudOff, tone: 'text-warn' },
  error: { text: 'Sync error', icon: AlertTriangle, tone: 'text-danger' },
}

function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email.split('@')[0]
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2)
  return letters.toUpperCase()
}

/** Header control: "Sign in" when signed out, an account menu when signed in, nothing when accounts are off. */
export function AccountMenu({ onOpenSettings }: { onOpenSettings(): void }) {
  const status = useSession((s) => s.status)
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const sync = useSync()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (status === 'anonymous') {
    return (
      <>
        <Button size="sm" variant="secondary" className="hidden h-9 md:inline-flex" onClick={startSignIn}>
          <LogIn className="size-4" />
          Sign in
        </Button>
        <IconButton label="Sign in" className="md:hidden" onClick={startSignIn}>
          <LogIn />
        </IconButton>
      </>
    )
  }
  if (status !== 'signed-in' || !user) return null

  const s = STATUS[sync.status]
  const Icon = s.icon
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.email}`}
        title={user.email}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-full bg-ink text-[12.5px] font-semibold text-paper"
      >
        {initialsOf(user.name, user.email)}
        {sync.status === 'error' || sync.status === 'offline' ? (
          <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface ${sync.status === 'error' ? 'bg-danger' : 'bg-warn'}`} />
        ) : null}
      </button>
      {open ? (
        <div role="menu" className="absolute top-11 right-0 z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="px-2.5 pt-1.5 pb-2">
            {user.name ? <div className="truncate text-[14px] font-semibold text-ink">{user.name}</div> : null}
            <div className="truncate text-[13px] text-muted">{user.email}</div>
          </div>
          <div className="mx-1 mb-1 flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[13px]" role="status">
            <Icon aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${s.tone} ${sync.status === 'syncing' ? 'animate-spin' : ''}`} />
            <div className="min-w-0 flex-1">
              <div className="text-ink-2">{s.text}</div>
              {sync.status === 'error' && sync.error ? <div className="mt-0.5 text-[12px] text-muted">{sync.error}</div> : null}
            </div>
            {sync.status === 'error' || sync.status === 'offline' ? (
              <button type="button" onClick={retrySync} className="shrink-0 rounded px-1.5 text-[12.5px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">
                Retry
              </button>
            ) : null}
          </div>
          <MenuButton
            icon={Settings}
            label="Settings"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
          />
          <MenuButton
            icon={LogOut}
            label="Sign out"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function MenuButton({ icon: Icon, label, onClick }: { icon: typeof Check; label: string; onClick(): void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-ink hover:bg-surface-2 md:min-h-9">
      <Icon aria-hidden className="size-4 text-muted" />
      {label}
    </button>
  )
}
