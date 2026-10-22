import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../planner/hooks'

/**
 * A button that opens a small anchored panel. Closes on outside click, Escape, or `close()`.
 * The panel stays inside the viewport on phones (right-aligned, capped width).
 */
export function Popover({
  label,
  button,
  children,
  className = '',
  panelClassName = '',
}: {
  label: string
  button: ReactNode
  children: (close: () => void) => ReactNode
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:size-7 [&_svg]:size-4"
      >
        {button}
      </button>
      {open ? (
        <div id={id} className={`absolute top-full right-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-1 shadow-xl ${panelClassName}`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({ children, onClick, danger, disabled }: { children: ReactNode; onClick(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-[14px] hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45 md:min-h-8 md:text-[13.5px] ${
        danger ? 'text-danger' : 'text-ink'
      } [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted`}
    >
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted">{children}</p>
}
