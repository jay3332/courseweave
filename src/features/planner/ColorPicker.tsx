import { Check } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { COURSE_COLOR_NAMES, courseColorStyle } from '../../lib/colors'
import { useDismiss } from './hooks'

export function ColorPicker({ color, onChange, courseCode }: { color: number; onChange(color: number): void; courseCode: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Change color for ${courseCode} (now ${COURSE_COLOR_NAMES[color]})`}
        title="Change color"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="grid size-6 place-items-center rounded-md hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
      >
        <span className="course-swatch block size-3.5 rounded-full" style={courseColorStyle(color)} />
      </button>
      {open ? (
        <div
          role="group"
          aria-label={`Colors for ${courseCode}`}
          // Fixed-size columns: the popover sits in the 24px button, and shrinkable (1fr) columns collapse to that width.
          className="absolute top-7 left-0 z-40 grid w-max grid-cols-[repeat(5,--spacing(7))] gap-1 rounded-lg border border-line bg-surface p-2 shadow-lg"
        >
          {COURSE_COLOR_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={i === color}
              title={name}
              onClick={() => {
                onChange(i)
                setOpen(false)
              }}
              className="course-swatch grid size-7 place-items-center rounded-full text-white ring-offset-2 ring-offset-surface hover:ring-2 hover:ring-line-strong"
              style={courseColorStyle(i)}
            >
              {i === color ? <Check aria-hidden className="size-4" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
