// CMU's open Schedule of Classes, cached by scripts/fetch-soc.ts under data/raw/soc/<TERM>/.
//
// Options (data/terms.json):
//   { "type": "soc", "term": "F26" }                    term code; defaults to the term's own id
//   "campuses": ["Pittsburgh"]                          keep sections taught at these campuses (prefix match on
//                                                       "Pittsburgh, Pennsylvania", "Doha, Qatar", …); default Pittsburgh.
//                                                       Use ["*"] for every campus.
//
// The open SOC has no instructors or rooms; layer a supplement source (e.g. Stellic) on top for those.
// Cancelled sections (flagged in the SOC title) are dropped, with any children of a cancelled lecture.
// Lecture → section grouping: sections listed under a lecture are its children. When a course lists several
// lectures before its sections, the course's detail page (cached in details.json.gz) gives the real grouping.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Course, Section } from '../../src/lib/types.ts'
import { addMeeting, cleanTitle, courseCode, miniOf, parseDays, parseTime } from '../lib/common.ts'
import { isLecture, modeCode, parseDetailsGrouping, parseSearchPage, sectionName, splitSocTitle, type SocRow } from '../lib/soc-parse.ts'
import type { SourceAdapter } from './types.ts'

interface DeptMeta {
  code: string
  name: string
  prefix: string | null
}

function readGz(path: string): string {
  return gunzipSync(readFileSync(path)).toString('latin1')
}

/** "VAR", "3-12", "9,12" → null (variable); "12" / "4.5" → number. */
function parseUnits(s: string): number | null {
  const t = s.trim()
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

function deptResolver(departments: DeptMeta[]) {
  const byName = new Map(departments.map((d) => [d.name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(), d.code]))
  const byPrefix = new Map<string, string>()
  for (const d of departments) if (d.prefix && !byPrefix.has(d.prefix)) byPrefix.set(d.prefix, d.code)
  // 62xxx is shared by several BXA-style codes; the CSV exports file them under CFA.
  byPrefix.set('62', 'CFA')
  return (title: string, courseId: string) =>
    byName.get(title.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()) ?? byPrefix.get(courseId.slice(0, 2)) ?? title
}

interface RawSection {
  raw: string
  rows: SocRow[]
}

export const socSource: SourceAdapter = (source, term, ctx) => {
  const code = String(source.term ?? term.id)
  const dir = join(ctx.dataDir, 'raw', 'soc', code)
  if (!existsSync(join(dir, 'search-U.html.gz'))) {
    throw new Error(`${code}: no cached SOC data in ${dir}. Run: node scripts/fetch-soc.ts ${code}`)
  }
  const campuses = (source.campuses as string[] | undefined) ?? ['Pittsburgh']
  const keepCampus = (loc: string) => campuses.includes('*') || campuses.some((c) => loc.toLowerCase().startsWith(c.toLowerCase()))

  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { departments: DeptMeta[] }
  const deptOf = deptResolver(meta.departments)
  const detailsPath = join(dir, 'details.json.gz')
  const details: Record<string, string> = existsSync(detailsPath) ? JSON.parse(gunzipSync(readFileSync(detailsPath)).toString('utf8')) : {}

  const courses: Course[] = []
  for (const level of ['U', 'G'] as const) {
    const rows = parseSearchPage(readGz(join(dir, `search-${level}.html.gz`)))

    // Group rows: course → sections (in listing order) → meeting rows.
    let current: { id: string; title: string; units: string; department: string; sections: RawSection[] } | null = null
    const flush = () => {
      if (current) {
        const c = buildCourse(current, level)
        if (c) courses.push(c)
      }
    }
    for (const row of rows) {
      if (row.course) {
        flush()
        current = { id: row.course, title: cleanTitle(splitSocTitle(row.title).base), units: row.units, department: row.department, sections: [] }
      }
      if (!current) continue
      if (row.section) current.sections.push({ raw: row.section, rows: [row] })
      else current.sections.at(-1)?.rows.push(row)
    }
    flush()
  }

  function buildCourse(raw: { id: string; title: string; units: string; department: string; sections: RawSection[] }, level: 'U' | 'G'): Course | null {
    // Parent lecture for each raw section label.
    const parentOf = new Map<string, string | null>()
    const grouping = details[raw.id] ? parseDetailsGrouping(details[raw.id]) : []
    if (grouping.length) {
      for (const g of grouping) parentOf.set(g.name, g.lecture)
    }
    let lastLecture: string | null = null
    for (const s of raw.sections) {
      if (isLecture(s.raw)) {
        lastLecture = s.raw
        parentOf.set(s.raw, null)
      } else if (!parentOf.has(s.raw)) {
        parentOf.set(s.raw, lastLecture)
      }
    }

    const sections: Section[] = []
    const cancelled = new Set<string>()
    for (const s of raw.sections) {
      const first = s.rows[0]
      const name = sectionName(s.raw)
      const parentRaw = parentOf.get(s.raw) ?? null
      const { topic, cancelled: isCancelled } = splitSocTitle(first.title)
      if (isCancelled || (parentRaw && cancelled.has(sectionName(parentRaw)))) {
        cancelled.add(name)
        continue
      }
      if (!keepCampus(first.location)) continue
      const title = topic ? cleanTitle(topic) : ''
      const section: Section = {
        name,
        kind: isLecture(s.raw) ? 'lecture' : 'section',
        parent: parentRaw ? sectionName(parentRaw) : null,
        mini: first.mini === 'Y' ? miniOf(name, term) : null,
        mode: modeCode(first.mode),
        instructors: [],
        meetings: [],
        ...(title && title !== raw.title ? { title } : {}),
      }
      for (const r of s.rows) {
        if (!keepCampus(r.location)) continue
        addMeeting(section, { days: parseDays(r.days), start: parseTime(r.begin), end: parseTime(r.end), building: null, room: null })
      }
      // Drop placeholder TBA meetings when the section also has real ones.
      if (section.meetings.length > 1) {
        const scheduled = section.meetings.filter((m) => m.days.length && m.start !== null)
        if (scheduled.length) section.meetings = scheduled
      }
      sections.push(section)
    }
    // A child whose lecture was filtered out (other campus) has no parent here.
    const names = new Set(sections.map((s) => s.name))
    for (const s of sections) if (s.parent !== null && !names.has(s.parent)) s.parent = null
    if (!sections.length) return null

    return {
      id: raw.id,
      code: courseCode(raw.id),
      title: raw.title,
      units: parseUnits(raw.units),
      dept: deptOf(raw.department, raw.id),
      level,
      instructors: [],
      sections,
      crossListed: [],
    }
  }

  return courses
}
