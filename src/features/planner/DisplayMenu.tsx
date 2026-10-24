import { Eye } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { useStore, type CalendarDisplay } from '../../state/store'

const OPTIONS: { key: keyof CalendarDisplay; label: string; hint: string }[] = [
  { key: 'section', label: 'Section', hint: 'Lec 1, Rec A or Sec A next to the course number' },
  { key: 'time', label: 'Meeting time', hint: 'Shown when the block is tall enough' },
  { key: 'location', label: 'Room', hint: 'Building and room, when there is space' },
]

/** What calendar blocks show besides the course number (every calendar in the app follows it). */
export function DisplayMenu() {
  const display = useStore((s) => s.calendarDisplay)
  const setDisplay = useStore((s) => s.setCalendarDisplay)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Button ref={triggerRef} size="sm" aria-expanded={open} aria-controls={panelId} aria-label="Calendar display" onClick={() => setOpen((v) => !v)}>
        <Eye aria-hidden className="size-3.5" />
        <span className="hidden min-[400px]:inline">Display</span>
      </Button>
      {open ? (
        <div id={panelId} role="group" aria-label="Calendar display" className="absolute top-full right-0 z-40 mt-1.5 w-72 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl">
          <p className="px-2 pt-1.5 pb-1 text-[12.5px] text-muted">The course number is always shown. Choose what else appears on each class.</p>
          {OPTIONS.map(({ key, label, hint }) => (
            <label key={key} className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2">
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
      ) : null}
    </div>
  )
}
