// Small shared primitives. Feature-specific components live in src/features/*.
import { Search, X } from 'lucide-react'
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:text-ink',
  danger: 'border border-line-strong bg-surface text-danger hover:bg-accent-soft',
}
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-[13px]',
  md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    />
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need an accessible name. */
  label: string
  size?: ButtonSize
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active = false, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`inline-grid shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-45 ${
        size === 'sm' ? 'size-7 [&_svg]:size-4' : 'size-9 [&_svg]:size-[18px]'
      } ${active ? 'text-accent' : 'text-muted hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:text-ink'} ${className}`}
      {...props}
    />
  )
})

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange(value: string): void
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, className = '', ...props },
  ref,
) {
  return (
    <div className={`relative ${className}`}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-9 pl-9 text-[15px] text-ink placeholder:text-muted focus:border-ink-2 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ink)_9%,transparent)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  )
})

/** Toggleable filter chip. */
export function Chip({ selected, onClick, children, className = '', title }: { selected: boolean; onClick(): void; children: ReactNode; className?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition-colors ${
        selected ? 'border-ink bg-ink text-paper' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** Native <dialog> as a modal. Closes on Escape and backdrop click. */
export function Dialog({ open, onClose, title, children, className = '' }: { open: boolean; onClose(): void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // Start focus on the dialog body rather than ringing the close button.
      el.querySelector<HTMLElement>('[data-dialog-body]')?.focus()
    }
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={`m-auto max-h-[min(88dvh,900px)] w-[min(94vw,720px)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] ${className}`}
    >
      {open ? (
        <div className="flex max-h-[inherit] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
            <h2 className="display text-xl">{title}</h2>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X />
            </IconButton>
          </div>
          <div data-dialog-body tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            {children}
          </div>
        </div>
      ) : null}
    </dialog>
  )
}

/** Small neutral label, e.g. units or level. */
export function Tag({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 items-center rounded border border-line px-1.5 text-[11.5px] font-medium text-ink-2 ${className}`}>
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-block size-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
  )
}
