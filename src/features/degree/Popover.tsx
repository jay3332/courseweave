import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Placement = { top?: number; bottom?: number; right: number }

/**
 * A button that opens a small menu panel. The panel floats above the page (anchored to the button, opening upward
 * near the bottom of the screen), so scrolling tables and cards can't clip it. Closes on outside click, Escape, or
 * `close()`.
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
  const [place, setPlace] = useState<Placement | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])

  const measure = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const right = Math.max(8, window.innerWidth - r.right)
    const below = window.innerHeight - r.bottom
    setPlace(below < 280 && r.top > below ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right })
  }, [])

  useLayoutEffect(() => {
    if (open) measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !panelRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, close, measure])

  // Inside a modal dialog the panel must live in the dialog (the top layer), not in <body>.
  const host = open ? (buttonRef.current?.closest('dialog') ?? document.body) : null

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
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
      {open && place && host
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              style={{ position: 'fixed', ...place }}
              onKeyDown={(e) => {
                // Tabbing out of the menu closes it and returns to the button, as if the panel sat right after it.
                if (e.key === 'Tab' && !e.shiftKey && e.target === [...(panelRef.current?.querySelectorAll<HTMLElement>('button, a, input, select') ?? [])].at(-1)) {
                  e.preventDefault()
                  close()
                  buttonRef.current?.focus()
                }
              }}
              className={`scrollbar-thin z-50 max-h-[min(70vh,480px)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl ${panelClassName}`}
            >
              {children(close)}
            </div>,
            host,
          )
        : null}
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
