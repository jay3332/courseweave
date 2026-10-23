// Helpers for the degree plan's detailed (spreadsheet-style) view: which requirement each course counts toward, and
// when a course is usually offered.
import type { CatalogEntry } from './catalog-types'
import type { AuditResult, RequirementResult } from './plan-types'

export interface Satisfies {
  /** Short requirement names, e.g. ["Core", "Category 1"]. */
  labels: string[]
  /** Full paths for a tooltip, e.g. "BS in Computer Science › Core › 15-122". */
  paths: string[]
}

/**
 * For each course in each term, the requirements the audit counted it toward. A course leaf ("15-122") is labeled by
 * its parent (e.g. "Core"); a pool or group by its own name. A course the audit put toward nothing is a free elective
 * (`free`).
 */
export function requirementsByCourse(audit: AuditResult | null): { get(courseId: string, term: string): Satisfies | null; free: Set<string> } {
  const byKey = new Map<string, Satisfies>()
  const key = (courseId: string, term: string | null) => `${courseId}@${term ?? ''}`

  const walk = (node: RequirementResult, trail: string[], parent: RequirementResult | null) => {
    const path = [...trail, node.name]
    for (const a of node.assigned) {
      const label = node.kind === 'course' && parent ? parent.name : node.name
      const k = key(a.courseId, a.term)
      const s = byKey.get(k) ?? { labels: [], paths: [] }
      if (!s.labels.includes(label)) s.labels.push(label)
      const full = path.join(' › ')
      if (!s.paths.includes(full)) s.paths.push(full)
      byKey.set(k, s)
    }
    for (const child of node.children) walk(child, path, node)
  }
  for (const program of audit?.programs ?? []) {
    const name = program.programName ?? program.name
    for (const child of program.root.children) walk(child, [name], program.root)
    if (program.root.assigned.length) walk({ ...program.root, children: [] }, [], null)
  }
  return {
    get: (courseId, term) => byKey.get(key(courseId, term)) ?? byKey.get(key(courseId, null)) ?? null,
    free: new Set(audit?.unassigned ?? []),
  }
}

const SEASONS = ['fall', 'spring', 'summer'] as const

/** "Fall", "Fall and Spring", "All semesters"; null when the catalog doesn't say. */
export function seasonsLabel(entry: Pick<CatalogEntry, 'offered'> | null | undefined): string | null {
  const offered = SEASONS.filter((s) => entry?.offered?.includes(s))
  if (!offered.length) return null
  if (offered.length === 3) return 'All semesters'
  const names = offered.map((s) => s[0].toUpperCase() + s.slice(1))
  return names.join(' and ')
}

/** Spreadsheet-style semester labels: "S1: Fall 2026"; summers get their own count ("Summer 1: Summer 2027"). */
export function semesterOrdinals(terms: string[]): Map<string, string> {
  const out = new Map<string, string>()
  let regular = 0
  let summers = 0
  for (const t of terms) out.set(t, t.startsWith('M') ? `Summer ${++summers}` : `S${++regular}`)
  return out
}
