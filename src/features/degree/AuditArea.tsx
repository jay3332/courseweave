// Integration point with the audit feature (src/features/degree/audit, src/lib/audit.ts, src/lib/programs.ts).
// Everything the plan page needs from the audit goes through this file.
import { useMemo } from 'react'
import { useAudit } from '../../lib/programs'
import type { AuditInput, AuditResult, ProgramSelection } from '../../lib/plan-types'
import { AuditPanel } from './audit/AuditPanel'
import { ProgramPicker } from './audit/ProgramPicker'

export interface ProgramsFieldProps {
  value: ProgramSelection[]
  onChange(value: ProgramSelection[]): void
  /** Entry year (fall that starts the plan), to preselect matching requirement versions. */
  entryYearHint?: number
}

/** Major/minor picker. */
export function ProgramsField(props: ProgramsFieldProps) {
  return <ProgramPicker {...props} />
}

/** Requirement audit panel: progress per program and requirement, with course suggestions. */
export function AuditColumn(props: { input: AuditInput; onAddCourse?(courseId: string, nodeId: number): void; termLabel?: (term: string) => string; dragCourses?: boolean }) {
  return <AuditPanel {...props} />
}

const EMPTY: AuditInput = { programs: [], courses: [] }

/** The audit result for an input, or null while unavailable. */
export function useAuditResult(input: AuditInput | null): AuditResult | null {
  const stable = useMemo(() => input ?? EMPTY, [input])
  const audit = useAudit(stable)
  return input && input.programs.length && audit.status === 'ready' ? audit.value : null
}
