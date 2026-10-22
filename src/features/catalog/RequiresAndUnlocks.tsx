// A course's prerequisite tree (what it needs, expandable) beside the courses it unlocks.
import { useMemo, useState } from 'react'
import type { Unlock } from '../../lib/catalog'
import type { CatalogIndex } from '../../lib/catalog-types'
import type { ChipContext } from './chip-context'
import { CourseChip } from './CourseChip'
import { ReqNode } from './RequiresTree'
import { UnlocksList } from './UnlocksList'

export function RequiresAndUnlocks({ id, index, ctx, unlocks }: { id: string; index: CatalogIndex; ctx: ChipContext; unlocks: Unlock[] }) {
  const [expandAll, setExpandAll] = useState(false)
  const entry = index.courses[id]
  // Met/missing marks are about this course's requisites; on what it unlocks or excludes they'd only read as "not taken".
  const plainCtx = useMemo(() => ({ ...ctx, status: undefined }), [ctx])
  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-2 md:gap-6">
      <section aria-labelledby="requires-heading" className="min-w-0 rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id="requires-heading" className="display text-[18px]">
            Requires
          </h3>
          {entry?.prereqs ? (
            <button
              type="button"
              aria-pressed={expandAll}
              onClick={() => setExpandAll(!expandAll)}
              className="min-h-9 rounded-md px-2 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:min-h-7"
            >
              {expandAll ? 'Collapse all' : 'Expand all'}
            </button>
          ) : null}
        </div>
        {entry?.prereqs ? (
          <div className="scrollbar-thin -mx-1 overflow-x-auto px-1">
            <ul key={String(expandAll)} className="min-w-fit">
              <ReqNode req={entry.prereqs} index={index} ctx={ctx} path={[id]} depth={0} expandAll={expandAll} />
            </ul>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">{entry ? 'No prerequisites listed.' : 'The catalog has no requisite data for this course.'}</p>
        )}
        {entry?.coreqs.length ? <CoreqList ids={entry.coreqs} ctx={ctx} /> : null}
        {entry?.antireqs.length ? (
          <div className="mt-4 border-t border-line pt-3">
            <h4 className="text-[13px] font-semibold text-ink">Can’t also get credit for</h4>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.antireqs.map((a) => (
                <CourseChip key={a} id={a} ctx={plainCtx} />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="unlocks-heading" className="min-w-0 rounded-lg border border-line bg-surface p-4">
        <h3 id="unlocks-heading" className="display mb-2 text-[18px]">
          Unlocks
        </h3>
        <UnlocksList unlocks={unlocks} ctx={plainCtx} />
      </section>
    </div>
  )
}

function CoreqList({ ids, ctx }: { ids: string[]; ctx: ChipContext }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h4 className="text-[13px] font-semibold text-ink">Corequisites</h4>
      <p className="text-[12.5px] text-muted">{ids.length > 1 ? 'One of these, before or in the same semester' : 'Before or in the same semester'}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {ids.map((c, i) => (
          <span key={c} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-[12.5px] text-muted">or</span> : null}
            <CourseChip id={c} ctx={ctx} />
          </span>
        ))}
      </div>
    </div>
  )
}
