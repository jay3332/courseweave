import { useMemo } from 'react'
import { sectionsConflict } from '../lib/conflicts'
import type { Term } from '../lib/data'
import { allSelections, resolveSelection, selectionParts } from '../lib/sections'
import type { Course, Section } from '../lib/types'
import { useActiveSchedule, useStore, type Schedule, type ScheduleEntry } from './store'
import { useTerm } from './term'

export interface ResolvedEntry {
  entry: ScheduleEntry
  course: Course
  /** The chosen top-level section; auto-resolved when the course has exactly one. Null = not chosen yet. */
  section: Section | null
  /** The chosen recitation/lab; auto-resolved when the lecture has exactly one. */
  child: Section | null
  /** The lecture has recitations/labs but none is chosen. */
  needsChild: boolean
  /** Sections on the calendar for this entry: [section] or [section, child]. */
  parts: Section[]
  /** Whether this entry's units count toward QPA (not pass/fail-only, not elected pass/fail). */
  factorable: boolean
}

export interface UnitTotals {
  /** Fixed units over visible entries (variable-unit courses count 0). */
  total: number
  /** Units that count toward QPA. */
  factorable: number
  /** Pass/fail units (course is P/F-only, or the student elected P/F). */
  nonFactorable: number
  /** Any visible entry has variable units. */
  hasVariable: boolean
}

export interface ScheduleView {
  schedule: Schedule | null
  entries: ResolvedEntry[]
  /** Visible entries with at least one section on the calendar. */
  placed: ResolvedEntry[]
  /** courseId → course ids it conflicts with (visible entries only). */
  conflicts: Map<string, string[]>
  units: UnitTotals
  hasCourse(courseId: string): boolean
}

/** Back-compat helper: the top-level section for a stored name. */
export function resolveSection(course: Course, name: string | null): Section | null {
  return resolveSelection(course, name, null).section
}

export function resolveEntry(entry: ScheduleEntry, course: Course): ResolvedEntry {
  const sel = resolveSelection(course, entry.section, entry.child ?? null)
  return {
    entry,
    course,
    section: sel.section,
    child: sel.child,
    needsChild: sel.needsChild,
    parts: selectionParts(sel),
    factorable: !course.passFail && !entry.passFail,
  }
}

export function resolveEntries(schedule: Schedule | null, term: Term): ResolvedEntry[] {
  if (!schedule) return []
  const out: ResolvedEntry[] = []
  for (const entry of schedule.entries) {
    const course = term.courseById.get(entry.courseId)
    if (course) out.push(resolveEntry(entry, course))
  }
  return out
}

/** Whether two sets of sections (e.g. lecture + recitation of two courses) collide anywhere. */
export function partsConflict(a: Section[], b: Section[]): boolean {
  return a.some((x) => b.some((y) => sectionsConflict(x, y)))
}

export function unitTotals(entries: ResolvedEntry[]): UnitTotals {
  const visible = entries.filter((e) => !e.entry.hidden)
  let factorable = 0
  let nonFactorable = 0
  for (const e of visible) {
    const u = e.course.units ?? 0
    if (e.factorable) factorable += u
    else nonFactorable += u
  }
  return { total: factorable + nonFactorable, factorable, nonFactorable, hasVariable: visible.some((e) => e.course.units === null) }
}

export function buildScheduleView(schedule: Schedule | null, term: Term): ScheduleView {
  const entries = resolveEntries(schedule, term)
  const placed = entries.filter((e) => !e.entry.hidden && e.parts.length > 0)
  const conflicts = new Map<string, string[]>()
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (!partsConflict(placed[i].parts, placed[j].parts)) continue
      const a = placed[i].course.id
      const b = placed[j].course.id
      conflicts.set(a, [...(conflicts.get(a) ?? []), b])
      conflicts.set(b, [...(conflicts.get(b) ?? []), a])
    }
  }
  const ids = new Set(entries.map((e) => e.course.id))
  return { schedule, entries, placed, conflicts, units: unitTotals(entries), hasCourse: (id) => ids.has(id) }
}

/** The active schedule for the routed term, resolved against course data. */
export function useScheduleView(): ScheduleView {
  const term = useTerm()
  const schedule = useActiveSchedule(term.meta.id)
  return useMemo(() => buildScheduleView(schedule, term), [schedule, term])
}

/** (section, child) choices of `course` that don't conflict with anything placed (ignoring the course itself). */
export function fittingSelections(course: Course, view: ScheduleView): { section: Section; child: Section | null }[] {
  const others = view.placed.filter((e) => e.course.id !== course.id)
  return allSelections(course).filter((sel) => {
    const parts = sel.child ? [sel.section, sel.child] : [sel.section]
    return !others.some((o) => partsConflict(parts, o.parts))
  })
}

/** Top-level sections of `course` that have at least one conflict-free choice. */
export function fittingSections(course: Course, view: ScheduleView): Section[] {
  const fits = new Set(fittingSelections(course, view).map((s) => s.section))
  return course.sections.filter((s) => fits.has(s))
}

/** Convenience: the active schedule id for the routed term (created by TermProvider). */
export function useActiveScheduleId(): string | null {
  const term = useTerm()
  return useStore((s) => s.activeSchedule[term.meta.id] ?? null)
}
