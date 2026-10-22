import { Copy, GraduationCap, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, IconButton } from '../../components/ui'
import { useActiveScheduleId } from '../../state/schedule-view'
import { usePlanList } from '../../state/plan'
import { useStore, useTermSchedules, type Schedule } from '../../state/store'
import { useTerm } from '../../state/term'
import { plural, scheduleUnits } from './format'
import { entriesFromPlan } from './fromPlan'
import { useDismiss } from './hooks'

/** Switcher for the term's schedule versions, with create / rename / duplicate / delete. */
export function ScheduleTabs() {
  const term = useTerm()
  const termId = term.meta.id
  const schedules = useTermSchedules(termId)
  const activeId = useActiveScheduleId()
  const setActiveSchedule = useStore((s) => s.setActiveSchedule)
  const createSchedule = useStore((s) => s.createSchedule)
  const duplicateSchedule = useStore((s) => s.duplicateSchedule)
  const renameSchedule = useStore((s) => s.renameSchedule)
  const deleteSchedule = useStore((s) => s.deleteSchedule)
  const ensureSchedule = useStore((s) => s.ensureSchedule)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuRef, menuOpen, closeMenu)

  // Degree plans with courses in this semester can seed a new schedule.
  const plans = usePlanList()
  const plansForTerm = plans
    .map((plan) => ({ plan, courses: plan.terms.find((t) => t.term === termId)?.courses ?? [] }))
    .filter((p) => p.courses.length)
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  const closeNew = useCallback(() => setNewOpen(false), [])
  useDismiss(newRef, newOpen, closeNew)
  const [notice, setNotice] = useState<string | null>(null)

  const createFromPlan = (name: string, courses: { courseId: string; passFail?: boolean }[]) => {
    const { entries, skipped } = entriesFromPlan(courses, term)
    createSchedule(termId, `From ${name}`, entries)
    setNewOpen(false)
    setNotice(
      skipped.length
        ? `Added ${plural(entries.length, 'course')} from ${name}. Not offered in ${term.meta.name}: ${skipped.map((id) => `${id.slice(0, 2)}-${id.slice(2)}`).join(', ')}.`
        : `Added ${plural(entries.length, 'course')} from ${name}.`,
    )
  }

  const active = schedules.find((s) => s.id === activeId) ?? null

  return (
    <div className="relative flex items-end gap-1 bg-paper px-3 pt-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line">
      <div role="tablist" aria-label="Schedules" className="scrollbar-thin relative z-10 flex min-w-0 items-end gap-1 overflow-x-auto">
        {schedules.map((s) => {
          const isActive = s.id === activeId
          if (renaming === s.id) {
            return (
              <RenameField
                key={s.id}
                initial={s.name}
                onDone={(name) => {
                  if (name !== null) renameSchedule(s.id, name)
                  setRenaming(null)
                }}
              />
            )
          }
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveSchedule(termId, s.id)}
              onDoubleClick={() => setRenaming(s.id)}
              title={isActive ? 'Double-click to rename' : undefined}
              className={`relative flex h-10 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3.5 text-[14px] transition-colors ${
                isActive
                  ? 'border-line bg-surface font-semibold text-ink after:absolute after:inset-x-0 after:top-0 after:h-[3px] after:rounded-t-lg after:bg-accent'
                  : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <span className="max-w-44 truncate">{s.name}</span>
              <span className={`text-[12px] font-normal ${isActive ? 'text-muted' : ''}`}>{plural(scheduleUnits(s, term), 'unit')}</span>
            </button>
          )
        })}
      </div>

      <div className="mb-1 flex shrink-0 items-center">
        {plansForTerm.length ? (
          <div ref={newRef} className="relative">
            <IconButton label="New schedule" size="sm" aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen((o) => !o)}>
              <Plus />
            </IconButton>
            {newOpen ? (
              <div role="menu" className="absolute top-8 right-0 z-40 w-64 rounded-lg border border-line bg-surface p-1 shadow-xl">
                <MenuItem
                  icon={Plus}
                  label="Blank schedule"
                  onClick={() => {
                    setNewOpen(false)
                    createSchedule(termId)
                  }}
                />
                {plansForTerm.map(({ plan, courses }) => (
                  <MenuItem
                    key={plan.id}
                    icon={GraduationCap}
                    label={`From ${plan.name} (${plural(courses.length, 'course')})`}
                    onClick={() => createFromPlan(plan.name, courses)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <IconButton label="New schedule" size="sm" onClick={() => createSchedule(termId)}>
            <Plus />
          </IconButton>
        )}
        {active ? (
          <div ref={menuRef} className="relative">
            <IconButton label={`Options for ${active.name}`} size="sm" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal />
            </IconButton>
            {menuOpen ? (
              <div role="menu" className="absolute top-8 right-0 z-40 w-44 rounded-lg border border-line bg-surface p-1 shadow-xl">
                <MenuItem
                  icon={Pencil}
                  label="Rename"
                  onClick={() => {
                    setMenuOpen(false)
                    setRenaming(active.id)
                  }}
                />
                <MenuItem
                  icon={Copy}
                  label="Duplicate"
                  onClick={() => {
                    setMenuOpen(false)
                    duplicateSchedule(active.id)
                  }}
                />
                <MenuItem
                  icon={Trash2}
                  label="Delete"
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    setPendingDelete(active)
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice ? (
        <div role="status" className="absolute top-full right-3 left-3 z-30 mt-2 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink-2 shadow-md">
          <span className="min-w-0 flex-1">{notice}</span>
          <IconButton label="Dismiss" size="sm" onClick={() => setNotice(null)}>
            <X />
          </IconButton>
        </div>
      ) : null}

      <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete this schedule?" className="w-[min(94vw,440px)]">
        {pendingDelete ? (
          <div className="px-5 py-4">
            <p className="text-ink-2">
              “{pendingDelete.name}” and its {plural(pendingDelete.entries.length, 'course')} will be removed. This can't be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  deleteSchedule(pendingDelete.id)
                  ensureSchedule(termId)
                  setPendingDelete(null)
                }}
              >
                Delete schedule
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger = false }: { icon: typeof Plus; label: string; onClick(): void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-surface-2 ${danger ? 'text-danger' : 'text-ink'}`}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </button>
  )
}

function RenameField({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Schedule name"
      maxLength={60}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      className="h-10 w-44 shrink-0 rounded-t-lg border border-b-0 border-accent bg-surface px-3 text-[14px] font-semibold text-ink focus:outline-none"
    />
  )
}
