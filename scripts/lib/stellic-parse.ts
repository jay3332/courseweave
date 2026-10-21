// Pure parsing of Stellic `/planner/getcoursesections/` responses (one file per course per lyear/sem),
// as saved by the ScottyLabs scraper: <courses_history>/<5digit>/ly<L>_sm<S>.json.
// No I/O here so it can be unit-tested; scripts/sources/stellic.ts does the file reading.

import type { Course, Day, Meeting, Section, TermMeta } from '../../src/lib/types.ts'

export interface StellicTiming {
  building?: string | null
  day: string
  start: string
  end: string
  room?: string | null
}

export interface StellicSection {
  id?: number
  name: string
  parent?: { name: string } | null
  type?: { name: string; short_name: string } | null
  instructors?: { first_name?: string | null; last_name?: string | null }[]
  raw_timings?: StellicTiming[]
  max_enrollment?: number | null
  start_date?: string | null
  end_date?: string | null
  topic?: unknown
  hidden?: boolean
  campus?: number | null
}

export interface StellicGroup {
  group_name: string
  group_short_name?: string
  sections: StellicSection[]
}

export interface StellicEntry {
  course: { code: string; name: string; units?: number | null }
  section_groups: StellicGroup[]
}

export interface StellicSectionsFile {
  data_list: StellicEntry[]
}

const DAYS: Record<string, Day> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 }

/** Course-number prefix → SOC department code (Stellic responses don't carry it). */
export const PREFIX_DEPT: Record<string, string> = {
  '00': 'IED', '01': 'MIS', '02': 'CB', '03': 'BSC', '05': 'HCI', '06': 'CHE', '07': 'SCS', '09': 'CMY', '10': 'MLG',
  '11': 'LTI', '12': 'CEE', '14': 'INI', '15': 'CS', '16': 'ROB', '17': 'S3D', '18': 'ECE', '19': 'EPP', '21': 'MSC',
  '24': 'MEG', '27': 'MSE', '32': 'NVS', '33': 'PHY', '36': 'STA', '38': 'MCS', '39': 'CIT', '42': 'BMD', '45': 'BUS',
  '46': 'BUS', '47': 'BUS', '48': 'ARC', '49': 'III', '51': 'DES', '52': 'BXA', '53': 'ETC', '54': 'DRA', '57': 'MUS',
  '60': 'ART', '62': 'CFA', '65': 'H00', '66': 'HSS', '67': 'ISP', '69': 'PE', '70': 'BUS', '73': 'ECO', '76': 'ENG',
  '79': 'HIS', '80': 'PHI', '82': 'LCL', '84': 'CST', '85': 'PSY', '86': 'NSI', '88': 'SDS', '90': 'PPP', '91': 'PMP',
  '92': 'MED', '93': 'AEM', '94': 'HC', '95': 'ISM', '98': 'STU', '99': 'CMU',
}

/** "07:00 PM" / "07:00PM" → minutes since midnight. */
export function parseClock(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec((s ?? '').trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'P') h += 12
  return h * 60 + Number(m[2])
}

function place(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return !t || /^(TBA|TBD|DNM)$/i.test(t) ? null : t
}

const DAY_MS = 86_400_000

/**
 * Mini number for a section. Dates win: a section spanning most of the term is full-semester, otherwise
 * it's the mini whose midpoint is closest. Falls back to the section name's last digit (A3 → Mini 3)
 * when dates are missing or don't belong to this term.
 */
export function detectMini(name: string, start: string | null | undefined, end: string | null | undefined, term: TermMeta): number | null {
  const byName = name.length >= 2 && term.minis.some((m) => m.number === Number(name.at(-1))) ? Number(name.at(-1)) : null
  const s = start ? Date.parse(start) : NaN
  const e = end ? Date.parse(end) : NaN
  const termStart = Date.parse(term.classesBegin)
  const termEnd = Date.parse(term.classesEnd)
  const inTerm = s >= termStart - 30 * DAY_MS && e <= termEnd + 30 * DAY_MS
  if (Number.isNaN(s) || Number.isNaN(e) || !inTerm || !term.minis.length) return byName
  if (e - s >= (termEnd - termStart) * 0.7) return null
  const mid = (s + e) / 2
  let best: number | null = null
  let bestDist = Infinity
  for (const m of term.minis) {
    const d = Math.abs((Date.parse(m.start) + Date.parse(m.end)) / 2 - mid)
    if (d < bestDist) {
      bestDist = d
      best = m.number
    }
  }
  return best
}

/** Groups per-day timings with the same time and room into one meeting. Sections without timings get a TBA meeting. */
export function timingsToMeetings(timings: StellicTiming[] | undefined): Meeting[] {
  const byKey = new Map<string, Meeting>()
  for (const t of timings ?? []) {
    const day = DAYS[t.day?.toLowerCase()]
    const start = parseClock(t.start)
    const end = parseClock(t.end)
    const building = place(t.building)
    const room = building ? place(t.room) : null
    const key = `${start}|${end}|${building}|${room}`
    let m = byKey.get(key)
    if (!m) {
      m = { days: [], start, end, building, room }
      byKey.set(key, m)
    }
    if (day !== undefined && !m.days.includes(day)) m.days.push(day)
  }
  const meetings = [...byKey.values()]
  for (const m of meetings) m.days.sort((a, b) => a - b)
  return meetings.length ? meetings : [{ days: [], start: null, end: null, building: null, room: null }]
}

function topicTitle(topic: unknown): string | undefined {
  if (typeof topic === 'string') return topic.trim() || undefined
  if (topic && typeof topic === 'object' && 'name' in topic && typeof topic.name === 'string') return topic.name.trim() || undefined
  return undefined
}

export interface ParseOptions {
  /** Keep only sections on these Stellic campus ids (1 = Pittsburgh). Default: all. */
  campuses?: number[]
}

/** One course from a sections file. Returns null when the file has no usable sections. */
export function parseStellicCourse(id: string, file: StellicSectionsFile, term: TermMeta, options: ParseOptions = {}): Course | null {
  const entries = file.data_list ?? []
  if (!entries.length) return null
  const first = entries[0].course
  const title = first.name.replace(/\s+/g, ' ').trim()

  const sections = new Map<string, Section>()
  for (const entry of entries) {
    for (const group of entry.section_groups ?? []) {
      for (const s of group.sections ?? []) {
        if (s.hidden) continue
        if (options.campuses && s.campus != null && !options.campuses.includes(s.campus)) continue
        if (sections.has(s.name)) continue
        // SOC only calls numbered sections lectures ("Lec 1"); Stellic also types lettered standalone sections as L.
        const isLecture = (s.type ? s.type.short_name === 'L' : group.group_name === 'Lecture') && /^\d/.test(s.name)
        const instructors: string[] = []
        for (const i of s.instructors ?? []) {
          const name = `${i.first_name ?? ''} ${i.last_name ?? ''}`.replace(/\s+/g, ' ').trim()
          // Stellic uses "[] []" for unassigned instructors.
          if (/[a-z]/i.test(name) && !instructors.includes(name)) instructors.push(name)
        }
        const topic = topicTitle(s.topic)
        sections.set(s.name, {
          name: s.name,
          kind: isLecture ? 'lecture' : 'section',
          parent: s.parent?.name ?? null,
          mini: detectMini(s.name, s.start_date, s.end_date, term),
          mode: '',
          instructors,
          meetings: timingsToMeetings(s.raw_timings),
          ...(topic && topic !== title ? { title: topic } : {}),
          ...(typeof s.max_enrollment === 'number' ? { capacity: s.max_enrollment } : {}),
        })
      }
    }
  }
  if (!sections.size) return null

  const units = typeof first.units === 'number' && first.units >= 0 ? first.units : null
  return {
    id,
    code: `${id.slice(0, 2)}-${id.slice(2)}`,
    title,
    units,
    dept: PREFIX_DEPT[id.slice(0, 2)] ?? id.slice(0, 2),
    level: Number(id.slice(2)) >= 600 ? 'G' : 'U',
    instructors: [],
    sections: [...sections.values()],
    crossListed: [],
  }
}
