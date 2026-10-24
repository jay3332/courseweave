import { BookOpen, CalendarDays, GraduationCap, ScrollText, Settings, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useSession } from '../state/session'
import { useStore } from '../state/store'
import { ALL_SEMESTERS } from '../state/term-scope'
import { useTerms } from '../state/term'
import { AccountMenu } from './AccountMenu'
import { SettingsDialog } from './SettingsDialog'
import { IconButton } from './ui'

const NAV = [
  { to: 'courses', label: 'Courses', icon: BookOpen },
  { to: 'instructors', label: 'Instructors', icon: Users },
  { to: 'schedule', label: 'Schedule', icon: CalendarDays },
  { to: 'record', label: 'Record', icon: ScrollText },
  { to: 'plan', label: 'Degree', icon: GraduationCap },
]

/** A course's requisite explorer is part of Courses. */
function navActive(to: string, isActive: boolean, pathname: string): boolean {
  return isActive || (to === 'courses' && pathname.split('/')[2] === 'requisites')
}

export function AppShell() {
  const { termId = '' } = useParams()
  const { pathname } = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // With the account control in the header, phones drop the wordmark (the logo mark stays) to make room.
  const accounts = useSession((s) => s.status === 'anonymous' || s.status === 'signed-in')
  return (
    <div className="relative flex h-dvh flex-col overflow-clip">
      <div aria-hidden className="tartan h-2 shrink-0 md:h-2.5" />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:gap-5 md:px-5">
        <Link to={`/${termId}/courses`} aria-label="Courseweave home" className="flex items-center gap-2 rounded-sm">
          <span aria-hidden className="tartan size-6 rounded-[5px]" />
          <span className={`display text-[21px] text-ink min-[400px]:text-[24px] md:text-[26px] ${accounts ? 'hidden min-[460px]:inline' : ''}`}>Courseweave</span>
          <span className="hidden pt-1 text-[13px] text-muted 2xl:inline">CMU course planner</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={`/${termId}/${to}`}
              className={({ isActive }) =>
                `relative flex h-14 items-center gap-2 px-2.5 text-[14px] font-medium transition-colors lg:px-3 ${
                  navActive(to, isActive, pathname)
                    ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t after:bg-accent'
                    : 'text-muted hover:text-ink'
                }`
              }
            >
              <Icon aria-hidden className="size-[18px]" />
              <span className="hidden lg:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <TermSelect termId={termId} />
          <AccountMenu onOpenSettings={() => setSettingsOpen(true)} />
          <SettingsButton onOpen={() => setSettingsOpen(true)} />
        </div>
      </header>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AuthErrorBanner />
      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {/* Phones and small tablets: the main nav becomes a bottom tab bar. */}
      <nav
        aria-label="Main"
        className="grid shrink-0 grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={`/${termId}/${to}`}
            className={({ isActive }) =>
              `relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                navActive(to, isActive, pathname) ? 'text-ink after:absolute after:inset-x-4 after:top-0 after:h-[3px] after:rounded-b after:bg-accent' : 'text-muted'
              }`
            }
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function TermSelect({ termId }: { termId: string }) {
  const terms = useTerms()
  const navigate = useNavigate()
  const location = useLocation()
  const options = terms.status === 'ready' ? terms.value : []
  const page = location.pathname.split('/')[2] || 'courses'
  // "All semesters" only means something for browsing courses.
  const offerAll = page === 'courses'
  const known = options.some((t) => t.id === termId) || (offerAll && termId === ALL_SEMESTERS)

  return (
    <label className="flex items-center">
      <span className="sr-only">Semester</span>
      <select
        value={termId}
        onChange={(e) => {
          // Comparing semesters keeps the search and filters.
          navigate(`/${e.target.value}/${page}${page === 'courses' ? location.search : ''}`)
        }}
        className="h-9 w-auto max-w-[9.5rem] rounded-lg border border-line-strong bg-surface pr-7 pl-2.5 text-[13px] font-medium text-ink md:max-w-none md:text-[14px]"
      >
        {!known ? <option value={termId}>{termId}</option> : null}
        {offerAll ? <option value={ALL_SEMESTERS}>All semesters</option> : null}
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function SettingsButton({ onOpen }: { onOpen(): void }) {
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  return (
    <IconButton label="Settings" onClick={onOpen}>
      <Settings />
    </IconButton>
  )
}

const AUTH_ERROR_TEXT = {
  domain: 'Sign in with your Andrew account (@andrew.cmu.edu or @cmu.edu). Other Google accounts can’t sign in.',
  failed: 'Sign-in didn’t complete; try again.',
}

/** After a failed sign-in (?auth_error=…), explains what happened. */
function AuthErrorBanner() {
  const error = useSession((s) => s.authError)
  const dismiss = useSession((s) => s.setAuthError)
  if (!error) return null
  return (
    <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-line bg-accent-soft px-4 py-2 text-[13.5px] text-ink">
      <p className="min-w-0 flex-1 py-1">{AUTH_ERROR_TEXT[error]}</p>
      <IconButton label="Dismiss" size="sm" onClick={() => dismiss(null)}>
        <X />
      </IconButton>
    </div>
  )
}
