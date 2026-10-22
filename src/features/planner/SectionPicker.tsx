import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Section } from '../../lib/types'
import { InstructorFceBadge } from '../fce/InstructorFceBadge'
import { joinList, locationSummary, meetingSummary, partLabel } from './format'
import { useDismiss } from './hooks'

interface SectionPickerProps {
  /** e.g. "lecture", "recitation", "section"; used in labels. */
  noun: string
  /** Accessible name of the list, e.g. "Lectures of 15-122". */
  listLabel: string
  options: Section[]
  current: Section | null
  /** Codes of scheduled courses an option would conflict with. */
  conflictsFor(section: Section): string[]
  onChange(section: string): void
  /** Called with the section being considered, or null when nothing is. */
  onPreview(section: string | null): void
  /** Shown in place of a current value; styled as a prompt to act. */
  placeholder?: string
  /** When set, each option shows its instructors' FCE for this course. */
  fceCourseId?: string
}

/** Listbox of sections. Hovering or arrowing to an option previews it on the calendar. */
export function SectionPicker({ noun, listLabel, options, current, conflictsFor, onChange, onPreview, placeholder, fceCourseId }: SectionPickerProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  const close = useCallback(() => {
    setOpen(false)
    onPreview(null)
  }, [onPreview])
  useDismiss(ref, open, close)

  const openList = () => {
    const i = Math.max(
      0,
      options.findIndex((s) => s.name === current?.name),
    )
    setActive(i)
    setOpen(true)
    onPreview(options[i]?.name ?? null)
  }

  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const move = (i: number) => {
    const n = options.length
    const next = (i + n) % n
    setActive(next)
    onPreview(options[next].name)
  }

  const choose = (name: string) => {
    onChange(name)
    close()
    buttonRef.current?.focus()
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') move(active + 1)
    else if (e.key === 'ArrowUp') move(active - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') choose(options[active].name)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      close()
      if (e.key === 'Escape') buttonRef.current?.focus()
      return
    } else return
    e.preventDefault()
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={current ? `${noun[0].toUpperCase()}${noun.slice(1)}: ${partLabel(current)}, ${meetingSummary(current)}. Change ${noun}` : (placeholder ?? `Choose a ${noun}`)}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            openList()
          }
        }}
        className={`flex min-h-8 w-full items-center gap-2 rounded-md border bg-surface px-2 py-1 text-left text-[13px] hover:border-ink-2 ${
          current ? 'border-line-strong text-ink-2' : 'border-warn text-warn'
        }`}
      >
        {current ? (
          <>
            <span className="shrink-0 font-semibold text-ink">{partLabel(current)}</span>
            <span className="min-w-0 truncate">{meetingSummary(current)}</span>
          </>
        ) : (
          <span className="font-medium">{placeholder ?? `Choose a ${noun}`}</span>
        )}
        <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 text-muted" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={listLabel}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onListKey}
          onMouseLeave={() => onPreview(null)}
          className="scrollbar-thin absolute top-full right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-1 shadow-xl focus:outline-none"
        >
          {options.map((s, i) => {
            const conflicts = conflictsFor(s)
            const selected = s.name === current?.name
            return (
              <li
                key={s.name}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => {
                  setActive(i)
                  onPreview(s.name)
                }}
                onClick={() => choose(s.name)}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-[13px] ${i === active ? 'bg-surface-2 ring-1 ring-line-strong' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-ink">{partLabel(s)}</span>
                  {s.mini ? <span className="rounded bg-surface-2 px-1 text-[11px] font-semibold text-ink-2">Mini {s.mini}</span> : null}
                  {selected ? <Check aria-label="Current choice" className="size-3.5 text-ok" /> : null}
                  {conflicts.length ? (
                    <span className="ml-auto flex items-center gap-1 text-[12px] font-medium text-danger">
                      <AlertTriangle aria-hidden className="size-3" />
                      Conflicts with {joinList(conflicts)}
                    </span>
                  ) : null}
                </div>
                <div className="text-ink-2">{meetingSummary(s)}</div>
                <div className="flex flex-wrap gap-x-3 text-[12px] text-muted">
                  <span className="shrink-0">{locationSummary(s)}</span>
                  {s.instructors.length ? <span className="min-w-0 truncate">{s.instructors.join(', ')}</span> : null}
                  {fceCourseId ? s.instructors.map((name) => <InstructorFceBadge key={name} courseId={fceCourseId} instructor={name} />) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
