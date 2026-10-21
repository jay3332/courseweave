import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { CatalogIndex, Requisite } from '../../lib/catalog-types'
import type { ChipContext } from './chip-context'
import { CourseChip } from './CourseChip'

/** Deepest level "Expand all" opens; deeper chains stay collapsed to keep the tree readable. */
const MAX_AUTO_DEPTH = 6

interface TreeProps {
  index: CatalogIndex
  ctx: ChipContext
  /** Course ids from the root down to here, to stop at cycles. */
  path: string[]
  depth: number
  expandAll: boolean
}

function groupLabel(req: Requisite): string {
  if (req.type === 'all') return 'All of'
  if (req.type === 'any') return 'One of'
  if (req.type === 'atLeast') return `At least ${req.n} of`
  return ''
}

/** One requisite node: a course row, a free-text condition, or an all/one-of group. */
export function ReqNode({ req, ...props }: TreeProps & { req: Requisite }) {
  if (req.type === 'course') return <CourseNode id={req.id} minGrade={req.minGrade} {...props} />
  if (req.type === 'text') {
    return <li className="py-1 text-[13.5px] text-ink-2 italic">{req.text}</li>
  }
  return (
    <li className="py-0.5">
      <span className="text-[12.5px] font-medium text-muted">{groupLabel(req)}</span>
      <ul className="mt-0.5 ml-1.5 border-l border-line-strong pl-2.5 md:ml-2 md:pl-3">
        {req.items.map((item, i) => (
          <ReqNode key={i} req={item} {...props} />
        ))}
      </ul>
    </li>
  )
}

function CourseNode({ id, minGrade, index, ctx, path, depth, expandAll }: TreeProps & { id: string; minGrade?: string }) {
  const prereqs = index.courses[id]?.prereqs ?? null
  const cycle = path.includes(id)
  const expandable = Boolean(prereqs) && !cycle
  const [open, setOpen] = useState(expandAll && depth < MAX_AUTO_DEPTH)
  const title = ctx.title(id)

  return (
    <li className="py-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} prerequisites of ${ctx.title(id) ?? id}`}
            onClick={() => setOpen(!open)}
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink md:size-7"
          >
            <ChevronRight aria-hidden className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span aria-hidden className="size-9 shrink-0 md:size-7" />
        )}
        <CourseChip id={id} minGrade={minGrade} ctx={ctx} />
        <span className="min-w-0 truncate text-[13px] text-ink-2">{title}</span>
        {cycle ? <span className="shrink-0 text-[12px] text-muted">(circular)</span> : null}
      </div>
      {open && prereqs ? (
        <ul className="ml-4 border-l border-line pl-2 md:ml-3.5 md:pl-3">
          <ReqNode req={prereqs} index={index} ctx={ctx} path={[...path, id]} depth={depth + 1} expandAll={expandAll} />
        </ul>
      ) : null}
    </li>
  )
}
