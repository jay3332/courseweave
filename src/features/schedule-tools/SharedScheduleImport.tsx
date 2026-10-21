// Mounted once on the schedule page. Handles ?import=<payload> share links.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { WeekGrid } from '../../components/WeekGrid'
import { Button, Dialog } from '../../components/ui'
import { courseColorStyle } from '../../lib/colors'
import { meetingSummary } from '../../lib/ics'
import { decodeSchedule, type SharedSchedule } from '../../lib/share'
import { resolveEntry, unitTotals, type ResolvedEntry } from '../../state/schedule-view'
import { useStore, useTermSchedules } from '../../state/store'
import { useTerm } from '../../state/term'
import { partBlocks, partLabel } from '../planner/format'
import { PHONE_FULLSCREEN } from './dialog'

type Pending = { payload: string } & ({ status: 'valid'; shared: SharedSchedule } | { status: 'invalid' })

export function SharedScheduleImport() {
  const term = useTerm()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const payload = params.get('import')
  const [pending, setPending] = useState<Pending | null>(null)

  // Decode during render; the link stays open even after the param is stripped from the URL.
  if (payload && pending?.payload !== payload) {
    const shared = decodeSchedule(payload)
    if (!shared) setPending({ payload, status: 'invalid' })
    else if (shared.termId === term.meta.id) setPending({ payload, status: 'valid', shared })
  }

  useEffect(() => {
    if (!payload) return
    const shared = decodeSchedule(payload)
    if (shared && shared.termId !== term.meta.id) {
      // The link is for another semester: reopen it there.
      navigate(`/${encodeURIComponent(shared.termId)}/schedule?import=${payload}`, { replace: true })
      return
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('import')
        return next
      },
      { replace: true },
    )
  }, [payload, term.meta.id, navigate, setParams])

  const close = () => setPending(null)

  if (pending?.status === 'invalid') {
    return (
      <Dialog open onClose={close} title="Couldn't open shared schedule">
        <div className="space-y-4 px-5 py-5">
          <p className="text-ink-2">This share link is incomplete or damaged. Ask whoever sent it to copy the link again.</p>
          <Button onClick={close}>Dismiss</Button>
        </div>
      </Dialog>
    )
  }
  if (pending?.status === 'valid') return <ImportPreview shared={pending.shared} onClose={close} />
  return null
}

function ImportPreview({ shared, onClose }: { shared: SharedSchedule; onClose(): void }) {
  const term = useTerm()
  const existing = useTermSchedules(term.meta.id)
  const createSchedule = useStore((s) => s.createSchedule)

  const { rows, skipped } = useMemo(() => {
    const rows: ResolvedEntry[] = []
    const skipped: string[] = []
    for (const entry of shared.entries) {
      const course = term.courseById.get(entry.courseId)
      if (!course) {
        skipped.push(`${entry.courseId.slice(0, 2)}-${entry.courseId.slice(2)}`)
        continue
      }
      rows.push(resolveEntry(entry, course))
    }
    return { rows, skipped }
  }, [shared, term])

  const blocks = rows.flatMap((r) => (r.entry.hidden ? [] : r.parts.flatMap((p) => partBlocks(r.course, p, r.entry.color))))
  const units = unitTotals(rows)

  const save = () => {
    const name = existing.some((s) => s.name === shared.name) ? `${shared.name} (shared)` : shared.name
    createSchedule(
      term.meta.id,
      name,
      rows.map((r) => ({ ...r.entry })),
    )
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title="Shared schedule" className={`w-[min(96vw,860px)]! ${PHONE_FULLSCREEN}`}>
      <div className="space-y-4 px-5 py-5">
        <div>
          <p className="display text-2xl">{shared.name}</p>
          <p className="text-[13.5px] text-ink-2">
            {term.meta.name}, {rows.length} {rows.length === 1 ? 'course' : 'courses'}, {units.total} units
            {units.nonFactorable ? ` (${units.factorable} factorable)` : ''}
          </p>
        </div>

        {blocks.length ? (
          <div className="rounded-lg border border-line bg-surface">
            <WeekGrid blocks={blocks} compact hourHeight={28} />
          </div>
        ) : null}

        {rows.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map(({ entry, course, section, parts, factorable }) => (
              <li key={course.id} className="flex items-start gap-3 px-3 py-2" style={courseColorStyle(entry.color)}>
                <span aria-hidden className="course-swatch mt-1 h-4 w-1 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="course-code text-[14px]">{course.code}</span>
                    <span className="truncate">{course.title}</span>
                    {entry.hidden ? <span className="text-[12px] text-muted">hidden</span> : null}
                    {!factorable ? <span className="text-[12px] text-muted">pass/fail</span> : null}
                  </div>
                  <div className="text-[12.5px] text-ink-2">
                    {section ? parts.map((p) => `${partLabel(p)}: ${meetingSummary(p)}`).join('; ') : 'No section chosen'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">None of the courses in this link are offered in {term.meta.name}.</p>
        )}

        {skipped.length ? (
          <p className="text-[13px] text-warn">
            Not offered in {term.meta.name}, so left out: <span className="course-code">{skipped.join(', ')}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={save} disabled={!rows.length}>
            Save as new schedule
          </Button>
          <Button onClick={onClose}>Dismiss</Button>
        </div>
      </div>
    </Dialog>
  )
}
