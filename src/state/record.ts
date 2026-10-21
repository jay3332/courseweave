// The student's academic record: courses taken, transfer and exam credit, placements, and
// requisite overrides. Term-independent; the schedule planner and degree planner read it.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { earnsCredit, gradePoints, isFactorableGrade, normalizeGrade, termOrdinal, type RequisiteOverride } from '../lib/requisites'

export type RecordSource =
  /** Taken at CMU. */
  | 'taken'
  /** Credit from another institution, recorded against a CMU equivalent (or as general units). */
  | 'transfer'
  /** AP / IB / A-Level credit. */
  | 'exam'
  /** Placed out without credit: satisfies requisites, earns no units. */
  | 'waiver'

export interface RecordEntry {
  id: string
  /** Five-digit CMU course id. Null for transfer credit with no CMU equivalent (general elective units). */
  courseId: string | null
  source: RecordSource
  /** Term taken, e.g. "F25". Optional for transfer/exam credit. */
  term?: string
  /** CMU grade (A–D, R, P, N, W, I, O, S, AD, …). Transfer and exam credit are AD. */
  grade?: string
  /** Units earned; defaults to the course's catalog units when omitted. */
  units?: number
  /** For exam credit: which exam and score produced this entry. */
  exam?: { id: string; score: string }
  /** Transfer: where it was taken. */
  institution?: string
  /** Shown instead of the catalog title (general transfer credit, exam-only course numbers). */
  label?: string
  note?: string
  addedAt: number
}

export interface StoredOverride extends RequisiteOverride {
  updatedAt: number
}

export const COLLEGES = [
  { code: 'CFA', name: 'College of Fine Arts' },
  { code: 'CIT', name: 'College of Engineering' },
  { code: 'DC', name: 'Dietrich College of Humanities and Social Sciences' },
  { code: 'MCS', name: 'Mellon College of Science' },
  { code: 'SCS', name: 'School of Computer Science' },
  { code: 'TSB', name: 'Tepper School of Business' },
  { code: 'BHA', name: 'BXA: Bachelor of Humanities and Arts' },
  { code: 'BXA', name: 'BXA: other intercollege programs' },
  { code: 'HC', name: 'Heinz College' },
] as const

export interface StudentProfile {
  /** First term at CMU, e.g. "F25". */
  entryTerm?: string
  /** Expected graduation term, e.g. "S29". */
  expectedGraduation?: string
  /** College code from COLLEGES. */
  college?: string
  /** Free-form for now; the degree planner will store program ids here. */
  majors?: string[]
  minors?: string[]
  level?: 'undergraduate' | 'graduate'
}

export interface RecordData {
  entries: RecordEntry[]
  /** courseId → waived requisites for that course (instructor permission, advisor override). */
  overrides: Record<string, StoredOverride>
  profile: StudentProfile
}

interface RecordState extends RecordData {
  addEntry(entry: Omit<RecordEntry, 'id' | 'addedAt'>): string
  addEntries(entries: Omit<RecordEntry, 'id' | 'addedAt'>[]): string[]
  updateEntry(id: string, patch: Partial<Omit<RecordEntry, 'id' | 'addedAt'>>): void
  removeEntry(id: string): void
  /** Removes every entry produced by one exam. */
  removeExam(examId: string): void
  /** Merges flags into a course's override; `null` clears it. Clearing every flag removes it. */
  setOverride(courseId: string, patch: Partial<RequisiteOverride> | null): void
  setProfile(patch: Partial<StudentProfile>): void
  importRecord(data: RecordData, mode: 'replace' | 'merge'): void
  clearRecord(): void
}

const uid = () => Math.random().toString(36).slice(2, 10)

const stamp = (e: Omit<RecordEntry, 'id' | 'addedAt'>): RecordEntry => ({ ...e, id: uid(), addedAt: Date.now() })

function sameEntry(a: Omit<RecordEntry, 'id' | 'addedAt'>, b: Omit<RecordEntry, 'id' | 'addedAt'>): boolean {
  return a.courseId === b.courseId && a.source === b.source && (a.term ?? '') === (b.term ?? '') && (a.exam?.id ?? '') === (b.exam?.id ?? '') && (a.label ?? '') === (b.label ?? '')
}

export const useRecord = create<RecordState>()(
  persist(
    (set) => ({
      entries: [],
      overrides: {},
      profile: {},

      addEntry(entry) {
        const e = stamp(entry)
        set((s) => ({ entries: [...s.entries, e] }))
        return e.id
      },

      addEntries(entries) {
        const stamped = entries.map(stamp)
        set((s) => ({ entries: [...s.entries, ...stamped] }))
        return stamped.map((e) => e.id)
      },

      updateEntry(id, patch) {
        set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
      },

      removeEntry(id) {
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
      },

      removeExam(examId) {
        set((s) => ({ entries: s.entries.filter((e) => e.exam?.id !== examId) }))
      },

      setOverride(courseId, patch) {
        set((s) => {
          const overrides = { ...s.overrides }
          if (patch === null) {
            delete overrides[courseId]
            return { overrides }
          }
          const next: StoredOverride = { ...overrides[courseId], ...patch, updatedAt: Date.now() }
          for (const k of ['prereqs', 'coreqs', 'antireqs'] as const) if (!next[k]) delete next[k]
          if (!next.prereqs && !next.coreqs && !next.antireqs) delete overrides[courseId]
          else overrides[courseId] = next
          return { overrides }
        })
      },

      setProfile(patch) {
        set((s) => ({ profile: { ...s.profile, ...patch } }))
      },

      importRecord(data, mode) {
        set((s) => {
          if (mode === 'replace') return { entries: data.entries.map((e) => ({ ...e })), overrides: { ...data.overrides }, profile: { ...data.profile } }
          const entries = [...s.entries]
          for (const e of data.entries) if (!entries.some((x) => sameEntry(x, e))) entries.push({ ...e, id: uid() })
          return { entries, overrides: { ...s.overrides, ...data.overrides }, profile: { ...data.profile, ...s.profile } }
        })
      },

      clearRecord() {
        set({ entries: [], overrides: {}, profile: {} })
      },
    }),
    { name: 'courseweave-record', version: 1 },
  ),
)

// ---------------------------------------------------------------------------
// Export / import

export const RECORD_FORMAT = 'courseweave-record'

export interface RecordExport extends RecordData {
  format: typeof RECORD_FORMAT
  version: 1
  exportedAt: string
}

export function exportRecord(data: RecordData): RecordExport {
  return { format: RECORD_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries: data.entries, overrides: data.overrides, profile: data.profile }
}

const SOURCES: RecordSource[] = ['taken', 'transfer', 'exam', 'waiver']

/** Validates an imported file. Returns null with a reason when it isn't a Courseweave record. */
export function parseRecordExport(value: unknown): { data: RecordData } | { error: string } {
  if (!value || typeof value !== 'object') return { error: "This file isn't a Courseweave record." }
  const v = value as Partial<RecordExport>
  if (v.format !== RECORD_FORMAT) return { error: "This file isn't a Courseweave record export." }
  if (v.version !== 1) return { error: `This record was exported by a newer version (format ${String(v.version)}).` }
  if (!Array.isArray(v.entries)) return { error: 'The record has no entries list.' }
  const entries: RecordEntry[] = []
  for (const raw of v.entries as unknown[]) {
    const e = raw as Partial<RecordEntry>
    if (!e || typeof e !== 'object' || !SOURCES.includes(e.source as RecordSource)) continue
    if (e.courseId !== null && !(typeof e.courseId === 'string' && /^\d{5}$/.test(e.courseId))) continue
    entries.push({
      id: typeof e.id === 'string' ? e.id : uid(),
      courseId: e.courseId ?? null,
      source: e.source as RecordSource,
      ...(typeof e.term === 'string' && termOrdinal(e.term) !== null ? { term: e.term.toUpperCase() } : {}),
      ...(typeof e.grade === 'string' ? { grade: normalizeGrade(e.grade) } : {}),
      ...(typeof e.units === 'number' && Number.isFinite(e.units) && e.units >= 0 ? { units: e.units } : {}),
      ...(e.exam && typeof e.exam.id === 'string' && typeof e.exam.score === 'string' ? { exam: { id: e.exam.id, score: e.exam.score } } : {}),
      ...(typeof e.institution === 'string' ? { institution: e.institution } : {}),
      ...(typeof e.label === 'string' ? { label: e.label } : {}),
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
      addedAt: typeof e.addedAt === 'number' ? e.addedAt : Date.now(),
    })
  }
  const overrides: Record<string, StoredOverride> = {}
  for (const [id, o] of Object.entries(v.overrides ?? {})) {
    if (!/^\d{5}$/.test(id) || !o || typeof o !== 'object') continue
    const next: StoredOverride = { updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now() }
    if (o.prereqs) next.prereqs = true
    if (o.coreqs) next.coreqs = true
    if (o.antireqs) next.antireqs = true
    if (typeof o.note === 'string') next.note = o.note
    if (next.prereqs || next.coreqs || next.antireqs) overrides[id] = next
  }
  const p = (v.profile ?? {}) as StudentProfile
  const profile: StudentProfile = {}
  if (typeof p.entryTerm === 'string' && termOrdinal(p.entryTerm) !== null) profile.entryTerm = p.entryTerm
  if (typeof p.expectedGraduation === 'string' && termOrdinal(p.expectedGraduation) !== null) profile.expectedGraduation = p.expectedGraduation
  if (typeof p.college === 'string') profile.college = p.college
  if (Array.isArray(p.majors)) profile.majors = p.majors.filter((x) => typeof x === 'string')
  if (Array.isArray(p.minors)) profile.minors = p.minors.filter((x) => typeof x === 'string')
  if (p.level === 'undergraduate' || p.level === 'graduate') profile.level = p.level
  return { data: { entries, overrides, profile } }
}

// ---------------------------------------------------------------------------
// Selectors

/** Effective grade: transfer and exam credit carry AD (credit without a grade). */
export function entryGrade(e: RecordEntry): string | undefined {
  if (e.source === 'transfer' || e.source === 'exam') return 'AD'
  return normalizeGrade(e.grade)
}

/** Units this entry earns, given catalog units for its course. Waivers and failing grades earn none. */
export function entryUnits(e: RecordEntry, catalogUnits: number | null | undefined): number {
  if (e.source === 'waiver') return 0
  if (!earnsCredit(entryGrade(e))) return 0
  return e.units ?? catalogUnits ?? 0
}

export interface RecordTotals {
  /** Units earned, by source. */
  bySource: Record<RecordSource, number>
  earned: number
  /** Units with letter grades (A–D, R): the QPA denominator. */
  factorable: number
  /** Earned units that don't count toward QPA (P, S, transfer, exam). */
  nonFactorable: number
  /** Taken courses with no grade entered yet (in progress or not recorded). */
  ungraded: number
  /** Cumulative QPA over factorable units, or null when there are none. */
  qpa: number | null
}

export function recordTotals(entries: RecordEntry[], unitsOf: (courseId: string) => number | null | undefined): RecordTotals {
  const bySource: Record<RecordSource, number> = { taken: 0, transfer: 0, exam: 0, waiver: 0 }
  let factorable = 0
  let nonFactorable = 0
  let ungraded = 0
  let points = 0
  for (const e of entries) {
    const catalogUnits = e.courseId ? unitsOf(e.courseId) : null
    const grade = entryGrade(e)
    const factor = isFactorableGrade(grade)
    const units = entryUnits(e, catalogUnits)
    bySource[e.source] += units
    if (factor === true) {
      const u = e.units ?? catalogUnits ?? 0
      factorable += u
      points += (gradePoints(grade) ?? 0) * u
    } else if (factor === null) {
      if (e.source === 'taken') ungraded += units
    } else {
      nonFactorable += units
    }
  }
  const earned = bySource.taken + bySource.transfer + bySource.exam
  return { bySource, earned, factorable, nonFactorable, ungraded, qpa: factorable > 0 ? points / factorable : null }
}
