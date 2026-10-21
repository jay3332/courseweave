import { departmentName } from './departments'
import { buildSearchDocs, normalize, type SearchDoc } from './search'
import type { Course, TermData, TermIndexEntry, TermMeta } from './types'

const base = import.meta.env.BASE_URL

let termsPromise: Promise<TermIndexEntry[]> | null = null
const termPromises = new Map<string, Promise<Term>>()

export function loadTerms(): Promise<TermIndexEntry[]> {
  termsPromise ??= fetch(`${base}data/terms.json`).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load the term list (HTTP ${r.status}).`)
    return r.json()
  })
  return termsPromise
}

export function loadTerm(id: string): Promise<Term> {
  let p = termPromises.get(id)
  if (!p) {
    p = fetch(`${base}data/${encodeURIComponent(id)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`No schedule data for term ${id}.`)
        return r.json() as Promise<TermData>
      })
      .then(indexTerm)
    p.catch(() => termPromises.delete(id))
    termPromises.set(id, p)
  }
  return p
}

export interface Instructor {
  name: string
  slug: string
  courseIds: string[]
  /** Number of sections taught. */
  sectionCount: number
  depts: string[]
}

export interface Department {
  code: string
  name: string
  /** Course-number prefixes used by this department, e.g. ["15"]. */
  prefixes: string[]
  courseCount: number
}

/** A loaded term with lookup tables. Built once per term and shared app-wide. */
export interface Term {
  meta: TermMeta
  generatedAt: string
  courses: Course[]
  courseById: Map<string, Course>
  searchDocs: SearchDoc[]
  instructors: Instructor[]
  instructorBySlug: Map<string, Instructor>
  departments: Department[]
}

export function instructorSlug(name: string): string {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function indexTerm(data: TermData): Term {
  const courseById = new Map(data.courses.map((c) => [c.id, c]))

  const instructorMap = new Map<string, Instructor>()
  const usedSlugs = new Set<string>()
  for (const course of data.courses) {
    for (const section of course.sections) {
      for (const name of section.instructors) {
        let inst = instructorMap.get(name)
        if (!inst) {
          let slug = instructorSlug(name)
          for (let n = 2; usedSlugs.has(slug); n++) slug = `${instructorSlug(name)}-${n}`
          usedSlugs.add(slug)
          inst = { name, slug, courseIds: [], sectionCount: 0, depts: [] }
          instructorMap.set(name, inst)
        }
        inst.sectionCount++
        if (!inst.courseIds.includes(course.id)) inst.courseIds.push(course.id)
        if (!inst.depts.includes(course.dept)) inst.depts.push(course.dept)
      }
    }
  }
  const instructors = [...instructorMap.values()].sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name))

  const deptMap = new Map<string, Department>()
  for (const course of data.courses) {
    let d = deptMap.get(course.dept)
    if (!d) {
      d = { code: course.dept, name: departmentName(course.dept), prefixes: [], courseCount: 0 }
      deptMap.set(course.dept, d)
    }
    d.courseCount++
    const prefix = course.id.slice(0, 2)
    if (!d.prefixes.includes(prefix)) d.prefixes.push(prefix)
  }
  const departments = [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    meta: data.term,
    generatedAt: data.generatedAt,
    courses: data.courses,
    courseById,
    searchDocs: buildSearchDocs(data.courses),
    instructors,
    instructorBySlug: new Map(instructors.map((i) => [i.slug, i])),
    departments,
  }
}

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** Accepts "15-122" or "15122". */
export function parseCourseCode(code: string): string {
  return code.replace(/\D/g, '')
}
