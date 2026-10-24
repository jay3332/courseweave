import { ChevronDown, Copy, FileUp, MoreHorizontal, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button, Dialog } from '../../components/ui'
import type { Plan } from '../../lib/plan'
import type { AuditResult, RequirementResult } from '../../lib/plan-types'
import { termLabel } from '../../lib/requisites'
import { usePlanList, usePlans } from '../../state/plan'
import { useTerm } from '../../state/term'
import { ProgramsField } from './AuditArea'
import { entryYearOf, useStartTermOptions, type PlanDerived } from './hooks'
import { MenuItem, Popover } from './Popover'
import { SioImportButton } from '../record/SioImport'
import { SendToStellicDialog } from '../schedule-tools/SendToStellic'

function countRequirements(r: RequirementResult): { done: number; total: number } {
  if (!r.children.length) return { done: r.state === 'complete' || r.state === 'complete-with-plan' ? 1 : 0, total: 1 }
  return r.children.reduce(
    (acc, c) => {
      const x = countRequirements(c)
      return { done: acc.done + x.done, total: acc.total + x.total }
    },
    { done: 0, total: 0 },
  )
}

export function PlanHeader({ plan, derived, audit }: { plan: Plan; derived: PlanDerived; audit: AuditResult | null }) {
  const term = useTerm()
  const navigate = useNavigate()
  const plans = usePlanList()
  const createPlan = usePlans((s) => s.createPlan)
  const duplicatePlan = usePlans((s) => s.duplicatePlan)
  const renamePlan = usePlans((s) => s.renamePlan)
  const deletePlan = usePlans((s) => s.deletePlan)
  const setActivePlan = usePlans((s) => s.setActivePlan)
  const setPrograms = usePlans((s) => s.setPrograms)
  const setStartTerm = usePlans((s) => s.setStartTerm)
  const startOptions = useStartTermOptions(derived.current)

  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(plan.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sending, setSending] = useState(false)

  const go = (id: string) => {
    setActivePlan(id)
    navigate(`/${term.meta.id}/plan/${id}`)
  }

  const program = audit?.programs[0]
  const requirements = audit?.programs.reduce(
    (acc, p) => {
      const x = countRequirements(p.root)
      return { done: acc.done + x.done, total: acc.total + x.total }
    },
    { done: 0, total: 0 },
  )
  const needUnits = program?.totalUnits?.need

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="display text-[30px] text-ink md:text-[36px]">Degree plan</h1>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <label className="min-w-0">
            <span className="sr-only">Plan</span>
            <select
              value={plan.id}
              onChange={(e) => go(e.target.value)}
              className="h-10 max-w-[52vw] rounded-lg border border-line-strong bg-surface pr-7 pl-2.5 text-[14px] font-medium text-ink md:h-9 md:max-w-[260px]"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => go(createPlan({ startTerm: plan.startTerm, programs: plan.programs.map((x) => ({ ...x })) }))} className="max-md:h-10">
            <Plus aria-hidden className="size-4" />
            <span className="hidden sm:inline">New plan</span>
          </Button>
          {/* The import's file picker and review live outside the menu, which closes when an item is chosen. */}
          <SioImportButton onImported={() => {}} onPlanCreated={go}>
            {(choose) => (
          <Popover label="Plan options" button={<MoreHorizontal />}>
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    setName(plan.name)
                    setRenaming(true)
                    close()
                  }}
                >
                  <Pencil aria-hidden />
                  Rename
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    go(duplicatePlan(plan.id))
                    close()
                  }}
                >
                  <Copy aria-hidden />
                  Duplicate
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setSending(true)
                    close()
                  }}
                >
                  <Send aria-hidden />
                  Send to Stellic
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    choose()
                    close()
                  }}
                >
                  <FileUp aria-hidden />
                  Import from Stellic
                </MenuItem>
                <MenuItem
                  danger
                  onClick={() => {
                    setConfirmDelete(true)
                    close()
                  }}
                >
                  <Trash2 aria-hidden />
                  Delete plan
                </MenuItem>
              </>
            )}
          </Popover>
            )}
          </SioImportButton>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Programs</span>
        <ProgramsField value={plan.programs} onChange={(p) => setPrograms(plan.id, p)} entryYearHint={entryYearOf(plan.startTerm)} />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Stat label="Units planned" value={String(derived.totalUnits)} sub={needUnits ? `of ${needUnits} required` : undefined} />
        <Stat label="Units completed" value={String(derived.completedUnits)} sub="Record and credit" />
        <Stat label="Requirements" value={requirements ? `${requirements.done}/${requirements.total}` : '—'} sub={requirements ? 'met or planned' : 'Pick a program'} />
        <Stat
          label="Semesters"
          value={String(derived.columns.length)}
          sub={
            // The plan's first semester, editable where the semester count is.
            <label className="relative inline-flex items-center gap-1">
              Starts
              <select
                aria-label="First semester"
                value={plan.startTerm}
                onChange={(e) => setStartTerm(plan.id, e.target.value)}
                className="min-h-8 cursor-pointer appearance-none bg-transparent pr-4 font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-accent md:min-h-0"
              >
                {startOptions.map((t) => (
                  <option key={t} value={t}>
                    {termLabel(t)}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-0 size-3 text-muted" />
            </label>
          }
        />
      </dl>

      <Dialog open={renaming} onClose={() => setRenaming(false)} title="Rename plan">
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault()
            renamePlan(plan.id, name)
            setRenaming(false)
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-ink-2">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="h-10 rounded-lg border border-line-strong bg-surface px-2.5 text-[15px] text-ink focus:border-ink-2 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Save name
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete plan">
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] text-ink-2">Delete “{plan.name}”? Your academic record isn't affected.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deletePlan(plan.id)
                setConfirmDelete(false)
                navigate(`/${term.meta.id}/plan`)
              }}
            >
              Delete plan
            </Button>
          </div>
        </div>
      </Dialog>
      <SendToStellicDialog open={sending} onClose={() => setSending(false)} mode="plan" initialId={plan.id} currentTerm={derived.current} />
    </header>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col bg-surface px-3 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="display text-[24px] text-ink">{value}</dd>
      {sub ? <dd className="text-[12px] text-muted">{sub}</dd> : null}
    </div>
  )
}
