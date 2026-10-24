// Imports use explicit .ts extensions so Node can run scripts/build-data.ts, which shares teachesSection.
import type { Course, Section } from './types.ts'

/** Lectures and standalone sections: what a student picks first. */
export function topSections(course: Course): Section[] {
  return course.sections.filter((s) => s.parent === null)
}

/** Recitations/labs under a lecture. */
export function childSections(course: Course, parentName: string): Section[] {
  return course.sections.filter((s) => s.parent === parentName)
}

export function hasChildren(course: Course, parentName: string): boolean {
  return course.sections.some((s) => s.parent === parentName)
}

export interface Selection {
  /** The chosen top-level section; auto-resolved when the course has exactly one. */
  section: Section | null
  /** The chosen child of `section`; auto-resolved when it has exactly one. Null if none needed or not chosen. */
  child: Section | null
  /** True when `section` has children but none is chosen yet. */
  needsChild: boolean
}

export function resolveSelection(course: Course, sectionName: string | null, childName: string | null): Selection {
  const tops = topSections(course)
  let section = sectionName !== null ? (tops.find((s) => s.name === sectionName) ?? null) : null
  // Older schedules may have stored a child's name as the section.
  if (!section && sectionName !== null) {
    const asChild = course.sections.find((s) => s.name === sectionName && s.parent !== null)
    if (asChild) {
      section = tops.find((s) => s.name === asChild.parent) ?? null
      childName ??= asChild.name
    }
  }
  if (!section && tops.length === 1) section = tops[0]
  if (!section) return { section: null, child: null, needsChild: false }

  const children = childSections(course, section.name)
  let child = childName !== null ? (children.find((s) => s.name === childName) ?? null) : null
  if (!child && children.length === 1) child = children[0]
  return { section, child, needsChild: children.length > 0 && !child }
}

/** The sections that actually go on a calendar for a selection. */
export function selectionParts(sel: Selection): Section[] {
  const parts: Section[] = []
  if (sel.section) parts.push(sel.section)
  if (sel.child) parts.push(sel.child)
  return parts
}

/** Every (top-level, child) combination of a course, e.g. for the schedule generator. */
export function allSelections(course: Course): { section: Section; child: Section | null }[] {
  const out: { section: Section; child: Section | null }[] = []
  for (const top of topSections(course)) {
    const children = childSections(course, top.name)
    if (!children.length) out.push({ section: top, child: null })
    else for (const child of children) out.push({ section: top, child })
  }
  return out
}

/**
 * Whether `name` actually teaches `section`. Recitations often just repeat their lecture's instructors (the TAs
 * aren't listed), so a recitation only counts when the person isn't already on its lecture.
 */
export function teachesSection(course: Course, section: Section, name: string): boolean {
  if (!section.instructors.includes(name)) return false
  if (section.parent === null) return true
  const parent = course.sections.find((s) => s.name === section.parent)
  return !parent?.instructors.includes(name)
}
