import { Fragment, type ReactNode } from 'react'
import type { Requisite } from '../../lib/catalog-types'
import { useChipContext, type ChipContext, type HrefFn, type StatusFn } from './chip-context'
import { CourseChip } from './CourseChip'

export type { RequisiteStatus, StatusFn, HrefFn } from './chip-context'

const joiner = (word: string) => <span className="px-0.5 text-[12.5px] text-muted">{word}</span>

function Inline({ req, ctx, nested }: { req: Requisite; ctx: ChipContext; nested: boolean }): ReactNode {
  switch (req.type) {
    case 'course':
      return <CourseChip id={req.id} minGrade={req.minGrade} ctx={ctx} />
    case 'text':
      return <span className="text-[13.5px] text-ink-2 italic">{req.text}</span>
    case 'all':
    case 'any':
    case 'atLeast': {
      const word = req.type === 'all' ? 'and' : req.type === 'any' ? 'or' : ','
      const body = (
        <>
          {req.type === 'atLeast' ? <span className="text-[12.5px] text-muted">at least {req.n} of</span> : null}
          {req.items.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && word !== ',' ? joiner(word) : null}
              <Inline req={item} ctx={ctx} nested />
            </Fragment>
          ))}
        </>
      )
      return nested ? (
        <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md bg-surface-2 px-1 py-0.5 ring-1 ring-line">{body}</span>
      ) : (
        <span className="inline-flex max-w-full flex-wrap items-center gap-1">{body}</span>
      )
    }
  }
}

function rowLead(req: Requisite): string | null {
  return req.type === 'any' ? 'One of' : null
}

/**
 * Readable rendering of a requisite expression. A top-level "all of" becomes one row per requirement;
 * alternatives read inline ("21-127 or 15-151"). Pass `status` to color courses as met/planned/missing,
 * and `href` to override where course chips link (e.g. to re-center the requisite explorer).
 */
export function RequisiteExpression({ req, status, href, className = '' }: { req: Requisite; status?: StatusFn; href?: HrefFn; className?: string }) {
  const ctx = useChipContext(status, href)
  if (req.type === 'all' && req.items.length > 1) {
    return (
      <ul className={`flex min-w-0 flex-col gap-1.5 ${className}`} aria-label="All of these">
        {req.items.map((item, i) => {
          const lead = rowLead(item)
          return (
            <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {lead ? <span className="text-[12.5px] text-muted">{lead}</span> : null}
              <Inline req={item} ctx={ctx} nested={false} />
            </li>
          )
        })}
      </ul>
    )
  }
  const lead = rowLead(req)
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 ${className}`}>
      {lead ? <span className="text-[12.5px] text-muted">{lead}</span> : null}
      <Inline req={req} ctx={ctx} nested={false} />
    </div>
  )
}

/** Inline list of course chips, e.g. corequisites or equivalents. */
export function CourseChipList({ ids, status, href, joinWord }: { ids: string[]; status?: StatusFn; href?: HrefFn; joinWord?: string }) {
  const ctx = useChipContext(status, href)
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && joinWord ? joiner(joinWord) : null}
          <CourseChip id={id} ctx={ctx} />
        </Fragment>
      ))}
    </span>
  )
}
