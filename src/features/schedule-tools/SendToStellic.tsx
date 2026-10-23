// "Send to Stellic or SIO": pick schedules (one per semester) or a degree plan, then copy a script that adds them to
// your Stellic plan from your own signed-in Stellic tab, or, for schedules, the course numbers and sections to enter
// in SIO. See lib/stellic-export.ts for what the script does.
import { Check, ClipboardCopy, ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog } from '../../components/ui'
import { useOfferings } from '../../lib/offerings'
import { resolvePlan } from '../../lib/plan'
import { termOrdinal } from '../../lib/requisites'
import { STELLIC_ORIGIN, buildStellicScript, exportPlan, exportSchedule, sioText, stellicTerm, type ExportTerm } from '../../lib/stellic-export'
import { usePlanList } from '../../state/plan'
import { useStore } from '../../state/store'
import { useTerm } from '../../state/term'
import { PHONE_FULLSCREEN } from './dialog'

type Mode = 'schedules' | 'plan'

function useTitleOf() {
  const term = useTerm()
  const offerings = useOfferings()
  return useMemo(
    () => (id: string) => term.courseById.get(id)?.title ?? offerings?.byId.get(id)?.title ?? `${id.slice(0, 2)}-${id.slice(2)}`,
    [term, offerings],
  )
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const [fallback, setFallback] = useState<{ key: string; text: string } | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setFallback(null)
    } catch {
      setFallback({ key, text })
    }
  }
  return { copied, fallback, copy }
}

export function SendToStellicDialog({ open, onClose, mode, initialId, currentTerm }: { open: boolean; onClose(): void; mode: Mode; initialId?: string; currentTerm: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={mode === 'plan' ? 'Send plan to Stellic' : 'Send to Stellic or SIO'} className={`w-[min(94vw,720px)] ${PHONE_FULLSCREEN}`}>
      {open ? <Body mode={mode} initialId={initialId} currentTerm={currentTerm} /> : null}
    </Dialog>
  )
}

function Body({ mode, initialId, currentTerm }: { mode: Mode; initialId?: string; currentTerm: string }) {
  const schedules = useStore((s) => s.schedules)
  const plans = usePlanList()
  const titleOf = useTitleOf()
  const { copied, fallback, copy } = useCopy()

  // Schedules, newest semester first; at most one per semester (two would ask Stellic for conflicting sections).
  const byTerm = useMemo(() => {
    const groups = new Map<string, (typeof schedules)[string][]>()
    for (const s of Object.values(schedules)) if (s.entries.length) groups.set(s.termId, [...(groups.get(s.termId) ?? []), s])
    return [...groups].sort(([a], [b]) => (termOrdinal(b) ?? 0) - (termOrdinal(a) ?? 0))
  }, [schedules])
  const [chosen, setChosen] = useState<Record<string, string>>(() => {
    const first = initialId ? schedules[initialId] : undefined
    return first ? { [first.termId]: first.id } : {}
  })
  const [planId, setPlanId] = useState(initialId ?? plans[0]?.id ?? '')

  const terms: ExportTerm[] = useMemo(() => {
    if (mode === 'plan') {
      const plan = plans.find((p) => p.id === planId)
      return plan ? exportPlan(resolvePlan(plan, schedules), schedules, currentTerm, titleOf) : []
    }
    return Object.values(chosen)
      .map((id) => schedules[id])
      .filter(Boolean)
      .map((s) => exportSchedule(s, titleOf))
      .filter((t): t is ExportTerm => t !== null && t.courses.length > 0)
      .sort((a, b) => (termOrdinal(a.term) ?? 0) - (termOrdinal(b.term) ?? 0))
  }, [mode, plans, planId, schedules, chosen, currentTerm, titleOf])

  const courseCount = terms.reduce((n, t) => n + t.courses.length, 0)
  const script = useMemo(() => (terms.length ? buildStellicScript(terms) : ''), [terms])

  return (
    <div className="flex flex-col gap-6 p-5">
      {mode === 'schedules' ? (
        <section aria-labelledby="send-pick">
          <h3 id="send-pick" className="mb-1 text-[14px] font-semibold text-ink">
            Schedules
          </h3>
          <p className="mb-2 text-[13px] text-muted">One per semester.</p>
          {byTerm.length ? (
            <div className="flex flex-col gap-3">
              {byTerm.map(([termId, list]) => (
                <fieldset key={termId} className="rounded-lg border border-line p-2.5">
                  <legend className="px-1 text-[12.5px] font-medium text-ink-2">{stellicTerm(termId)?.name ?? termId}</legend>
                  <div className="flex flex-col">
                    {list.map((s) => (
                      <label key={s.id} className="flex min-h-10 items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-surface-2 md:min-h-0">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={chosen[termId] === s.id}
                          onChange={(e) =>
                            setChosen((prev) => {
                              const next = { ...prev }
                              if (e.target.checked) next[termId] = s.id
                              else delete next[termId]
                              return next
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium text-ink">{s.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {s.entries
                              .filter((e) => !e.hidden)
                              .map((e) => {
                                const section = e.child ?? e.section
                                return `${e.courseId.slice(0, 2)}-${e.courseId.slice(2)}${section ? ` ${section}` : ''}`
                              })
                              .join(', ')}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : (
            <p className="text-[13.5px] text-ink-2">Add courses to a schedule first.</p>
          )}
        </section>
      ) : (
        <section aria-labelledby="send-pick">
          <label className="flex flex-col gap-1">
            <span id="send-pick" className="text-[14px] font-semibold text-ink">
              Degree plan
            </span>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="h-10 rounded-lg border border-line-strong bg-surface px-2.5 text-[14px] text-ink md:h-9"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-[13px] text-muted">
            Sends this plan’s current and future semesters; past ones are already in Stellic from your transcript. Semesters synced with a schedule
            include its sections. Stellic keeps one main plan, so send one plan at a time.
          </p>
          {terms.length ? (
            <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-ink-2">
              {terms.map((t) => (
                <li key={t.term}>
                  <span className="font-medium text-ink">{t.name}</span>: {t.courses.map((c) => c.code).join(', ')}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      <section aria-labelledby="send-stellic" className="flex flex-col gap-3 border-t border-line pt-5">
        <div>
          <h3 id="send-stellic" className="display text-[19px] text-ink">
            Stellic
          </h3>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Stellic has no import, so this is a short script you run in your own signed-in Stellic tab. It shows you exactly what it will add and
            changes nothing until you confirm. It only adds courses (with your sections) to your plan: it never registers, drops or removes anything.
          </p>
        </div>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] text-ink-2">
          <li>
            <Button size="sm" variant="primary" disabled={!courseCount} onClick={() => copy('script', script)}>
              {copied === 'script' ? <Check aria-hidden className="size-3.5" /> : <ClipboardCopy aria-hidden className="size-3.5" />}
              {copied === 'script' ? 'Script copied' : courseCount ? `Copy script (${courseCount} course${courseCount === 1 ? '' : 's'})` : 'Copy script'}
            </Button>
          </li>
          <li>
            Open{' '}
            <a href={`${STELLIC_ORIGIN}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">
              Stellic
              <ExternalLink aria-hidden className="size-3" />
            </a>{' '}
            and sign in.
          </li>
          <li>
            Open the console: <kbd className="rounded border border-line px-1 text-[12px]">⌥⌘J</kbd> on a Mac or{' '}
            <kbd className="rounded border border-line px-1 text-[12px]">Ctrl+Shift+J</kbd> in Chrome or Edge. In Safari, turn on Show features for web
            developers in Settings → Advanced, then <kbd className="rounded border border-line px-1 text-[12px]">⌥⌘C</kbd>.
          </li>
          <li>Paste the script and press Enter. Chrome may first ask you to type “allow pasting”.</li>
          <li>Check the list it shows and confirm. Reload Stellic to see the courses.</li>
        </ol>
        <p className="text-[12.5px] text-muted">
          Only paste code into a console from a source you trust. You can read this one first:
        </p>
        <details className="rounded-md border border-line">
          <summary className="flex min-h-9 cursor-pointer items-center px-3 text-[13px] font-medium text-ink-2 select-none">Show the script</summary>
          <textarea
            readOnly
            value={script}
            rows={12}
            aria-label="Stellic script"
            onFocus={(e) => e.currentTarget.select()}
            className="block w-full resize-y border-t border-line bg-surface-2 p-2 font-mono text-[11.5px] text-ink"
          />
        </details>
      </section>

      {mode === 'schedules' ? (
        <section aria-labelledby="send-sio" className="flex flex-col gap-3 border-t border-line pt-5">
          <div>
            <h3 id="send-sio" className="display text-[19px] text-ink">
              SIO
            </h3>
            <p className="mt-1 text-[13.5px] text-ink-2">
              SIO can’t take a script safely, so enter these in its registration page: each course number with the section to register for (a
              recitation brings its lecture with it). If Stellic offers to send planned sections to SIO, you can also use that after the step above.
            </p>
          </div>
          {terms.length ? (
            <>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-line bg-surface-2 text-[12px] text-muted">
                    <tr>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Semester
                      </th>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Course
                      </th>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Section
                      </th>
                      <th scope="col" className="px-2.5 py-1.5 font-medium">
                        Title
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {terms.flatMap((t) =>
                      t.courses.map((c) => (
                        <tr key={`${t.term}-${c.code}`} className="border-b border-line/70 last:border-b-0">
                          <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-2">{t.name}</td>
                          <td className="course-code px-2.5 py-1.5 text-[14px] text-ink">{c.code.replace('-', '')}</td>
                          <td className="px-2.5 py-1.5 font-medium text-ink">{c.sections.at(-1) ?? <span className="font-normal text-warn">pick one</span>}</td>
                          <td className="max-w-[16rem] truncate px-2.5 py-1.5 text-ink-2">{c.title}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <Button size="sm" onClick={() => copy('sio', sioText(terms))}>
                  {copied === 'sio' ? <Check aria-hidden className="size-3.5" /> : <ClipboardCopy aria-hidden className="size-3.5" />}
                  {copied === 'sio' ? 'Copied' : 'Copy list'}
                </Button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {fallback ? (
        <div>
          <label className="mb-1 block text-[12.5px] text-ink-2" htmlFor="send-fallback">
            Your browser blocked copying. Select the text and copy it yourself.
          </label>
          <textarea
            id="send-fallback"
            readOnly
            value={fallback.text}
            rows={5}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-y rounded-md border border-line-strong bg-surface-2 p-1.5 font-mono text-[12px] text-ink"
          />
        </div>
      ) : null}
    </div>
  )
}
