import { BookOpen, CalendarDays, GitFork, GraduationCap, Settings, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { useStore } from '../state/store'
import { useTerms } from '../state/term'
import { SettingsDialog } from './SettingsDialog'
import { IconButton } from './ui'

const NAV = [
  { to: 'courses', label: 'Courses', icon: BookOpen },
  { to: 'instructors', label: 'Instructors', icon: Users },
  { to: 'schedule', label: 'Schedule', icon: CalendarDays },
  { to: 'requisites', label: 'Requisites', icon: GitFork },
  { to: 'plan', label: 'Degree', icon: GraduationCap },
]

export function AppShell() {
  const { termId = '' } = useParams()
  return (
    <div className="relative flex h-dvh flex-col overflow-clip">
      <div aria-hidden className="tartan h-2 shrink-0 md:h-2.5" />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:gap-5 md:px-5">
        <Link to={`/${termId}/courses`} aria-label="Courseweave home" className="flex items-center gap-2 rounded-sm">
          <span aria-hidden className="tartan size-6 rounded-[5px]" />
          <span className="display text-[24px] text-ink md:text-[26px]">Courseweave</span>
          <span className="hidden pt-1 text-[13px] text-muted 2xl:inline">CMU course planner</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={`/${termId}/${to}`}
              className={({ isActive }) =>
                `relative flex h-14 items-center gap-2 px-2.5 text-[14px] font-medium transition-colors lg:px-3 ${
                  isActive
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
          <SettingsButton />
        </div>
      </header>
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
                isActive ? 'text-ink after:absolute after:inset-x-4 after:top-0 after:h-[3px] after:rounded-b after:bg-accent' : 'text-muted'
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
  const known = options.some((t) => t.id === termId)

  return (
    <label className="flex items-center">
      <span className="sr-only">Semester</span>
      <select
        value={termId}
        onChange={(e) => {
          const rest = location.pathname.split('/').slice(2, 3).join('/') || 'courses'
          navigate(`/${e.target.value}/${rest}`)
        }}
        className="h-9 w-[124px] rounded-lg border border-line-strong bg-surface pr-7 pl-2.5 text-[13px] font-medium text-ink md:w-auto md:text-[14px]"
      >
        {!known ? <option value={termId}>{termId}</option> : null}
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function SettingsButton() {
  const theme = useStore((s) => s.theme)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
  }, [theme])

  return (
    <>
      <IconButton label="Settings" onClick={() => setOpen(true)}>
        <Settings />
      </IconButton>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
