import { Check, Clock, X } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { coursePreview } from '../../components/CoursePreview'
import type { Requisite } from '../../lib/catalog-types'
import { codeOf } from '../../lib/requisite-format'
import { useChipContext, type ChipContext, type HrefFn, type RequisiteStatus, type StatusFn } from './chip-context'

const STATUS_LABEL: Record<RequisiteStatus, string> = { met: 'completed', planned: 'planned', missing: 'not taken yet' }
const STATUS_ICON = { met: Check, planned: Clock, missing: X }
const STATUS_ICON_COLOR: Record<RequisiteStatus, string> = { met: 'text-ok', planned: 'text-warn', missing: 'text-danger' }

function CourseText({ id, minGrade, ctx }: { id: string; minGrade?: string; ctx: ChipContext }) {
  const code = codeOf(id)
  const status = ctx.status?.(id)
  const title = ctx.title(id)
  const label = [title ? `${code} ${title}` : code, minGrade ? `minimum grade ${minGrade}` : null, status ? STATUS_LABEL[status] : null].filter(Boolean).join(', ')
  const Icon = status ? STATUS_ICON[status] : null
  return (
    <Link to={ctx.href(id)} aria-label={label} {...coursePreview(id)} className="whitespace-nowrap text-ink hover:text-accent hover:underline">
      {Icon ? <Icon aria-hidden className={`mr-0.5 inline size-3 align-[-1px] ${STATUS_ICON_COLOR[status!]}`} /> : null}
      <span className="course-code text-[13px]">{code}</span>
    </Link>
  )
}

const paren = (c: string) => <span className="text-muted">{c}</span>

/**
 * `before`/`after` are parentheses that belong to the first/last course: they're kept on the same line as it (an icon
 * is an inline image, so the browser could otherwise break between "(" and the course).
 */
function Part({ req, ctx, top, before, after }: { req: Requisite; ctx: ChipContext; top: boolean; before?: ReactNode; after?: ReactNode }): ReactNode {
  switch (req.type) {
    case 'course':
    case 'text':
      return (
        <span className="whitespace-nowrap">
          {before}
          {req.type === 'course' ? <CourseText id={req.id} minGrade={req.minGrade} ctx={ctx} /> : <span className="whitespace-normal italic">{req.text}</span>}
          {after}
        </span>
      )
    case 'all':
    case 'any':
    case 'atLeast': {
      if (req.items.length === 1) return <Part req={req.items[0]} ctx={ctx} top={top} before={before} after={after} />
      const word = req.type === 'all' ? ' and ' : req.type === 'any' ? ' or ' : ', '
      const lead = req.type === 'atLeast' ? <span className="text-muted">at least {req.n} of </span> : null
      const open = (
        <>
          {before}
          {lead}
          {top ? null : paren('(')}
        </>
      )
      const close = top ? after : <>{paren(')')}{after}</>
      const last = req.items.length - 1
      return (
        <>
          {req.items.map((item, i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="text-muted">{word}</span> : null}
              <Part req={item} ctx={ctx} top={false} before={i === 0 ? open : undefined} after={i === last ? close : undefined} />
            </Fragment>
          ))}
        </>
      )
    }
  }
}

/**
 * A requisite expression as one line of wrapping text, like a catalog writes it: "15-122 and (21-127 or 15-151)".
 * Courses link and carry a met/planned/missing icon when `status` is given. For dense places such as tables;
 * `RequisiteExpression` is the roomier, chip-based version.
 */
export function RequisiteText({ req, status, href, className = '' }: { req: Requisite; status?: StatusFn; href?: HrefFn; className?: string }) {
  const ctx = useChipContext(status, href)
  return (
    <span className={`text-[12.5px] leading-[18px] text-ink-2 ${className}`}>
      <Part req={req} ctx={ctx} top />
    </span>
  )
}
