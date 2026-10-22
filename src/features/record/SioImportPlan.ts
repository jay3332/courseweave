// Turns a parsed SIO record into importable record entries, marking what's already in the record.
import { normalizeGrade, termLabel, termOrdinal } from '../../lib/requisites'
import type { SioCourseRow, SioRecord } from '../../lib/sio-record'
import type { RecordEntry } from '../../state/record'

export type NewEntry = Omit<RecordEntry, 'id' | 'addedAt'>

/** Groups SIO's exam credit together in the AP / IB section of the record page. */
export const SIO_EXAM_NOTE = 'Advanced placement credit from your SIO record'

export type ItemStatus = 'graded' | 'in-progress' | 'no-grade' | 'credit'

export interface ImportItem {
  key: string
  row: SioCourseRow
  entry: NewEntry
  status: ItemStatus
  /** Already in the record (same course, source and term); unchecked by default. */
  already: boolean
}

export interface ImportGroup {
  key: string
  title: string
  subtitle?: string
  items: ImportItem[]
}

export interface ImportPlan {
  groups: ImportGroup[]
  /** Profile values the record suggests, when they differ from what's saved. */
  profile: { college?: string; entryTerm?: string }
}

export interface PlanOptions {
  /** Whether the catalog or term data knows this course (otherwise the PDF's title is kept as a label). */
  knows(courseId: string): boolean
  /** The routed term, e.g. "S27": ungraded rows from it or later are in progress. */
  currentTerm: string
  profile: { college?: string; entryTerm?: string }
}

export function planSioImport(record: SioRecord, existing: RecordEntry[], opts: PlanOptions): ImportPlan {
  // Courses the catalog doesn't know (AP elective placeholders like 76-011) keep SIO's own text: title-casing
  // abbreviations mangles them ("AP US HISTORY" would become "Ap Us History").
  const label = (row: SioCourseRow) => (opts.knows(row.courseId) ? {} : { label: row.title })
  const groups: ImportGroup[] = []

  if (record.exam.length) {
    groups.push({
      key: 'exam',
      title: 'AP and exam credit',
      items: record.exam.map((row, i) => ({
        key: `exam:${i}`,
        row,
        entry: { courseId: row.courseId, source: 'exam', units: row.units, note: SIO_EXAM_NOTE, ...label(row) },
        status: 'credit',
        already: existing.some((e) => e.source === 'exam' && e.courseId === row.courseId),
      })),
    })
  }

  record.transfer.forEach((group, g) => {
    groups.push({
      key: `transfer:${g}`,
      title: 'Transfer credit',
      subtitle: group.institution,
      items: group.rows.map((row, i) => ({
        key: `transfer:${g}:${i}`,
        row,
        entry: { courseId: row.courseId, source: 'transfer', units: row.units, institution: group.institution, ...label(row) },
        status: 'credit',
        already: existing.some((e) => e.source === 'transfer' && e.courseId === row.courseId),
      })),
    })
  })

  const current = termOrdinal(opts.currentTerm) ?? Infinity
  const terms = [...record.terms].sort((a, b) => (termOrdinal(a.term) ?? 0) - (termOrdinal(b.term) ?? 0))
  for (const t of terms) {
    const ord = termOrdinal(t.term) ?? 0
    groups.push({
      key: `term:${t.term}`,
      title: termLabel(t.term),
      items: t.rows.map((row, i) => {
        const grade = normalizeGrade(row.grade)
        const status: ItemStatus = grade ? 'graded' : ord >= current - 1 ? 'in-progress' : 'no-grade'
        return {
          key: `term:${t.term}:${i}`,
          row,
          entry: { courseId: row.courseId, source: 'taken', term: t.term, units: row.units, ...(grade ? { grade } : {}), ...label(row) },
          status,
          already: existing.some((e) => e.source === 'taken' && e.courseId === row.courseId && (e.term ?? '') === t.term),
        }
      }),
    })
  }

  const profile: ImportPlan['profile'] = {}
  if (record.profile.collegeCode && record.profile.collegeCode !== opts.profile.college) profile.college = record.profile.collegeCode
  const first = terms[0]?.term
  if (first && first !== opts.profile.entryTerm) profile.entryTerm = first

  return { groups, profile }
}
