// Helpers shared by every data source adapter and build script.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Course, Day, Meeting, Section, TermMeta } from '../../src/lib/types.ts'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const dataDir = join(root, 'data')
export const publicDataDir = join(root, 'public', 'data')
export const derivedDir = join(dataDir, 'derived')

/**
 * Checkout of the ScottyLabs courses repo (FCE CSV, Stellic exports, scraper).
 * Override with SCOTTYLABS_DIR; defaults to data/sources.json, then ~/Projects/scottylabs/courses.
 */
export function scottylabsDir(): string {
  if (process.env.SCOTTYLABS_DIR) return resolve(process.env.SCOTTYLABS_DIR)
  const cfg = join(dataDir, 'sources.json')
  if (existsSync(cfg)) {
    const dir = JSON.parse(readFileSync(cfg, 'utf8')).scottylabsDir as string | undefined
    if (dir) return resolve(dir.replace(/^~(?=\/|$)/, homedir()))
  }
  return join(homedir(), 'Projects', 'scottylabs', 'courses')
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Rows as header-keyed records, trimmed. */
export function readCsvRecords(path: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(readFileSync(path, 'utf8'))
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? '').trim()])))
}

export const DAY_LETTERS: Record<string, Day> = { M: 0, T: 1, W: 2, R: 3, F: 4, S: 5, U: 6 }
const DAY_NAMES: Record<string, Day> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 }

/** "MWF" / "TR" (SOC letters) or a weekday name ("tuesday"). */
export function parseDays(s: string): Day[] {
  const t = s.trim()
  if (!t || /^TBA$/i.test(t)) return []
  const named = DAY_NAMES[t.toLowerCase()]
  if (named !== undefined) return [named]
  return [...t.toUpperCase()].map((c) => DAY_LETTERS[c]).filter((d): d is Day => d !== undefined)
}

/** "09:30AM", "9:30 AM", "07:00 PM" → minutes since midnight. */
export function parseTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'P') h += 12
  return h * 60 + Number(m[2])
}

const PLACEHOLDER_LOCATIONS = new Set(['', 'TBA', 'TBD', 'DNM'])

export function location(s: string | null | undefined): string | null {
  const t = (s ?? '').trim()
  return PLACEHOLDER_LOCATIONS.has(t.toUpperCase()) ? null : t
}

export function cleanTitle(s: string): string {
  return s.replace(/\s*Click to Print Page\s*$/i, '').replace(/\s+/g, ' ').trim()
}

export function splitInstructors(s: string): string[] {
  return s
    .split(';')
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter((x) => x && !/^(TBA|Instructor TBA|Staff)$/i.test(x))
}

export function mostCommon<T>(items: T[]): T {
  const counts = new Map<T, number>()
  for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Mini number from a section name's last digit (A3 → 3), when it matches one of the term's minis. */
export function miniOf(section: string, term: TermMeta): number | null {
  if (section.length < 2) return null
  const last = Number(section.at(-1))
  return term.minis.some((m) => m.number === last) ? last : null
}

export function meetingKey(m: Meeting): string {
  return `${m.days.join('')}|${m.start}|${m.end}|${m.building}|${m.room}`
}

export function addMeeting(section: Section, meeting: Meeting) {
  if (!section.meetings.some((m) => meetingKey(m) === meetingKey(meeting))) section.meetings.push(meeting)
}

export function addInstructors(target: string[], names: string[]) {
  for (const n of names) if (!target.includes(n)) target.push(n)
}

export function courseCode(id: string): string {
  return `${id.slice(0, 2)}-${id.slice(2)}`
}

/** Recomputes the course-level instructor union from its sections. */
export function finalizeCourse(course: Course): Course {
  const instructors: string[] = []
  for (const s of course.sections) addInstructors(instructors, s.instructors)
  course.instructors = instructors
  return course
}
