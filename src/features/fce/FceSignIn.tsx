import { LockKeyhole, LogIn } from 'lucide-react'
import { Button } from '../../components/ui'
import { startSignIn, useSession } from '../../state/session'

/** Shown where FCE data would be when the deployment gates it behind CMU sign-in. */
export function FceSignIn({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const status = useSession((s) => s.status)
  // A signed-in user getting 401s means the session lapsed; the session check will catch up.
  const canSignIn = status === 'anonymous' || status === 'signed-in'

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-strong bg-surface-2 ${compact ? 'px-3 py-2' : 'px-4 py-3'} ${className}`}>
      <LockKeyhole aria-hidden className="size-4 shrink-0 text-muted" />
      <p className={`min-w-0 flex-1 text-ink-2 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}>Sign in with your CMU account to see course evaluations.</p>
      {canSignIn ? (
        <Button size="sm" variant="secondary" onClick={startSignIn}>
          <LogIn className="size-4" />
          Sign in
        </Button>
      ) : null}
    </div>
  )
}
