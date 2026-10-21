// Actions for one schedule: download .ics, copy share link, copy course list.
import { CalendarArrowDown, Check, ChevronDown, ClipboardList, Link2, Share } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import { buildIcs, hasScheduledMeetings, meetingSummary } from '../../lib/ics'
import { shareUrl } from '../../lib/share'
import { formatUnits } from '../../lib/time'
import { buildScheduleView } from '../../state/schedule-view'
import type { Schedule } from '../../state/store'
import { useTerm } from '../../state/term'
import { partLabel } from '../planner/format'

type Copied = 'link' | 'list' | null

export function ExportMenu({ schedule }: { schedule: Schedule }) {
  const term = useTerm()
  const view = useMemo(() => buildScheduleView(schedule, term), [schedule, term])
  const items = useMemo(() => view.placed.flatMap((e) => e.parts.map((section) => ({ course: e.course, section }))), [view])
  const canDownload = hasScheduledMeetings(items)

  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<Copied>(null)
  const [fallback, setFallback] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = (refocus = true) => {
    setOpen(false)
    setFallback(null)
    if (refocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setFallback(null)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 1800)
    return () => clearTimeout(t)
  }, [copied])

  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }

  const copy = async (text: string, kind: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setFallback(null)
    } catch {
      setFallback(text)
    }
  }

  const download = () => {
    const ics = buildIcs(items, term.meta, { calendarName: `${schedule.name} (${term.meta.name})` })
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName(schedule.name)} ${term.meta.id}.ics`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    close()
  }

  const link = () =>
    shareUrl(
      window.location.origin,
      {
        termId: schedule.termId,
        name: schedule.name,
        entries: schedule.entries.map((e) => ({ courseId: e.courseId, section: e.section, child: e.child, color: e.color, hidden: e.hidden, passFail: e.passFail })),
      },
      import.meta.env.BASE_URL,
    )

  const courseList = () => {
    const visible = view.entries.filter((e) => !e.entry.hidden)
    const lines = [`${schedule.name} (${term.meta.name})`]
    for (const { course, section, parts, factorable, needsChild } of visible) {
      const units = `${course.units === null ? 'variable units' : `${formatUnits(course.units)} units`}${factorable ? '' : ' (pass/fail)'}`
      const times = parts.map((p) => `${partLabel(p)}: ${meetingSummary(p)}`).join('; ')
      lines.push(
        section
          ? `${course.code} ${section.title ?? course.title}, ${units}, ${times}${needsChild ? '; recitation not chosen' : ''}`
          : `${course.code} ${course.title}, ${units}, no section chosen`,
      )
    }
    const { total, factorable, nonFactorable, hasVariable } = view.units
    lines.push(
      `Total: ${total} units${hasVariable ? ' plus variable-unit courses' : ''}${nonFactorable ? ` (${factorable} factorable, ${nonFactorable} pass/fail)` : ''}`,
    )
    return lines.join('\n')
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Share aria-hidden className="size-3.5" />
        Export
        <ChevronDown aria-hidden className="size-3.5 text-muted" />
      </Button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Export schedule"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-40 mt-1.5 w-72 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl"
        >
          <MenuItem
            icon={<CalendarArrowDown />}
            label="Download calendar (.ics)"
            hint={canDownload ? 'Weekly events for Google Calendar, Apple Calendar or Outlook' : 'Pick sections with set meeting times first'}
            disabled={!canDownload}
            onClick={download}
          />
          <MenuItem
            icon={copied === 'link' ? <Check className="text-ok" /> : <Link2 />}
            label={copied === 'link' ? 'Link copied' : 'Copy share link'}
            hint="Anyone with the link can save a copy"
            onClick={() => copy(link(), 'link')}
          />
          <MenuItem
            icon={copied === 'list' ? <Check className="text-ok" /> : <ClipboardList />}
            label={copied === 'list' ? 'Course list copied' : 'Copy course list'}
            hint="Plain text with sections and times"
            disabled={!view.entries.length}
            onClick={() => copy(courseList(), 'list')}
          />
          {fallback ? (
            <div className="border-t border-line p-2">
              <label className="mb-1 block text-[12.5px] text-ink-2" htmlFor="export-fallback">
                Your browser blocked copying. Select the text and copy it yourself.
              </label>
              <textarea
                id="export-fallback"
                readOnly
                value={fallback}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded-md border border-line-strong bg-surface-2 p-1.5 text-[12px] text-ink"
              />
            </div>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {copied === 'link' ? 'Share link copied to clipboard' : copied === 'list' ? 'Course list copied to clipboard' : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ icon, label, hint, disabled, onClick }: { icon: ReactNode; label: string; hint: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-45 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[12px] text-muted">{hint}</span>
      </span>
    </button>
  )
}

function fileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'schedule'
}
