import { coursePreview } from '../../components/CoursePreview'
import { Check, Clock, X } from 'lucide-react'
import { Link } from 'react-router'
import { codeOf } from '../../lib/requisite-format'
import type { ChipContext, RequisiteStatus } from './chip-context'

const STATUS_STYLE: Record<RequisiteStatus, string> = {
  met: 'border-[color-mix(in_oklab,var(--ok)_55%,transparent)] bg-[color-mix(in_oklab,var(--ok)_10%,var(--surface))]',
  planned: 'border-[color-mix(in_oklab,var(--warn)_60%,transparent)] bg-[color-mix(in_oklab,var(--warn)_10%,var(--surface))]',
  missing: 'border-[color-mix(in_oklab,var(--danger)_60%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))]',
}
const STATUS_LABEL: Record<RequisiteStatus, string> = { met: 'completed', planned: 'planned', missing: 'not taken yet' }
const STATUS_ICON = { met: Check, planned: Clock, missing: X }
const STATUS_ICON_COLOR: Record<RequisiteStatus, string> = { met: 'text-ok', planned: 'text-warn', missing: 'text-danger' }

export function CourseChip({ id, minGrade, ctx, className = '' }: { id: string; minGrade?: string; ctx: ChipContext; className?: string }) {
  const code = codeOf(id)
  const offered = ctx.offered(id)
  const status = ctx.status?.(id)
  const title = ctx.title(id)
  const label = [
    title ? `${code} ${title}` : code,
    minGrade ? `minimum grade ${minGrade}` : null,
    status ? STATUS_LABEL[status] : null,
    offered ? null : `not offered in ${ctx.termName}`,
  ]
    .filter(Boolean)
    .join(', ')
  const Icon = status ? STATUS_ICON[status] : null

  return (
    <Link
      to={ctx.href(id)}
      aria-label={label}
      {...coursePreview(id)}
      className={`inline-flex min-h-9 items-center gap-1 rounded-md border px-2 align-middle whitespace-nowrap transition-colors md:min-h-7 md:px-1.5 ${
        status ? STATUS_STYLE[status] : offered ? 'border-line-strong bg-surface hover:border-ink-2' : 'border-dashed border-line-strong bg-transparent hover:border-ink-2'
      } ${offered ? 'text-ink' : 'text-ink-2'} ${className}`}
    >
      {Icon ? <Icon aria-hidden className={`size-3.5 ${STATUS_ICON_COLOR[status!]}`} /> : null}
      <span className="course-code text-[14px] leading-none">{code}</span>
      {minGrade ? <span className="rounded-sm bg-surface-2 px-1 text-[11px] leading-4 font-semibold text-ink-2">min {minGrade}</span> : null}
    </Link>
  )
}
