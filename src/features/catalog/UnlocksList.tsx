import { useMemo, useState } from 'react'
import { Chip } from '../../components/ui'
import type { Unlock } from '../../lib/catalog'
import { departmentName } from '../../lib/departments'
import { useTerm } from '../../state/term'
import type { ChipContext } from './chip-context'
import { CourseChip } from './CourseChip'

const GROUP_PREVIEW = 8

/** Department name for a course-number prefix, using this term's departments when possible. */
function usePrefixNames(): (prefix: string) => string {
  const term = useTerm()
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const d of term.departments) for (const p of d.prefixes) if (!map.has(p)) map.set(p, d.name)
    return (prefix: string) => map.get(prefix) ?? departmentName(prefix)
  }, [term])
}

export function UnlocksList({ unlocks, ctx }: { unlocks: Unlock[]; ctx: ChipContext }) {
  const [offeredOnly, setOfferedOnly] = useState(false)
  const [requiredOnly, setRequiredOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const prefixName = usePrefixNames()

  const shown = unlocks.filter((u) => (!offeredOnly || ctx.offered(u.id)) && (!requiredOnly || u.required))
  const groups = useMemo(() => {
    const map = new Map<string, Unlock[]>()
    for (const u of shown) {
      const p = u.id.slice(0, 2)
      map.set(p, [...(map.get(p) ?? []), u])
    }
    return [...map].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }, [shown])

  if (!unlocks.length) return <p className="text-[13.5px] text-muted">No course lists this as a prerequisite or corequisite.</p>

  const requiredCount = unlocks.filter((u) => u.required).length
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[13px] text-ink-2">
        {unlocks.length === 1 ? '1 course lists' : `${unlocks.length} courses list`} it as a requisite; {requiredCount === unlocks.length ? 'all' : requiredCount} of them can’t be taken without it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Chip selected={requiredOnly} onClick={() => setRequiredOnly(!requiredOnly)} title="Only courses whose every prerequisite path needs this course">
          Requires it outright
        </Chip>
        <Chip selected={offeredOnly} onClick={() => setOfferedOnly(!offeredOnly)}>
          Offered in {ctx.termName}
        </Chip>
      </div>
      {!shown.length ? <p className="text-[13.5px] text-muted">Nothing matches these filters.</p> : null}
      {groups.map(([prefix, list]) => {
        const open = expanded.has(prefix) || list.length <= GROUP_PREVIEW + 2
        const visible = open ? list : list.slice(0, GROUP_PREVIEW)
        return (
          <section key={prefix} aria-label={prefixName(prefix)} className="min-w-0">
            <h4 className="mb-1 flex items-baseline gap-2 text-[13px] font-semibold text-ink">
              {prefixName(prefix)}
              <span className="font-normal text-muted">{list.length}</span>
            </h4>
            <ul className="flex flex-col">
              {visible.map((u) => (
                <li key={u.id} className="flex min-w-0 items-center gap-2 border-t border-line py-1 first:border-t-0">
                  <CourseChip id={u.id} ctx={ctx} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{ctx.title(u.id)}</span>
                  <span
                    className={`shrink-0 text-[12px] ${u.required ? 'font-medium text-ink' : 'text-muted'}`}
                    title={u.via === 'coreq' ? 'Take before or alongside' : u.required ? 'Every prerequisite path needs this course' : 'One of several ways to meet the prerequisites'}
                  >
                    {u.via === 'coreq' ? 'Corequisite' : u.required ? 'Required' : 'One option'}
                  </span>
                </li>
              ))}
            </ul>
            {!open ? (
              <button
                type="button"
                onClick={() => setExpanded(new Set([...expanded, prefix]))}
                className="mt-0.5 min-h-9 text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-7"
              >
                Show all {list.length}
              </button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
