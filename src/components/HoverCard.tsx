// A small card shown while hovering or focusing its trigger, floating above the page (so table scrollers and cards
// can't clip it). The pointer can move into the card without it closing.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const OPEN_DELAY = 120
const CLOSE_DELAY = 140

export function HoverCard({ trigger, children, className = '' }: { trigger: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  const schedule = useCallback((next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), delay)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  useLayoutEffect(() => {
    if (!open) return
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 328))
    const below = window.innerHeight - r.bottom
    setPlace(below < 220 && r.top > below ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const hide = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const host = open ? (anchor.current?.closest('dialog') ?? document.body) : null

  return (
    <span
      ref={anchor}
      className={`inline ${className}`}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => schedule(true, OPEN_DELAY)}
      onMouseLeave={() => schedule(false, CLOSE_DELAY)}
      onFocus={() => schedule(true, 0)}
      onBlur={() => schedule(false, CLOSE_DELAY)}
    >
      {trigger}
      {open && place && host
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{ position: 'fixed', ...place }}
              onMouseEnter={() => schedule(true, 0)}
              onMouseLeave={() => schedule(false, CLOSE_DELAY)}
              className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-surface p-3 text-left text-[13px] font-normal text-ink-2 shadow-xl"
            >
              {children}
            </div>,
            host,
          )
        : null}
    </span>
  )
}
