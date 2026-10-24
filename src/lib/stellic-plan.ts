// Parser for Stellic's plan PDF (Plan your Path → Download Plan → Create plan report). Pure, like sio-record.ts: it
// works on positioned text pieces, so it runs in the browser and in tests, and nothing here sends the file anywhere.
//
// Layout it understands:
//   header      label/value pairs in two columns ("Programs:", "Level:", "Campus:", …); long values wrap onto lines
//               of their own under the value
//   terms       "Fall 2026 - 62 units attempted, 4.5 units earned", then a column header ("Course or Activity",
//               "Units", "Grade" (only when the term has grades), "Status"), then one row per course or activity:
//               "15-213 Introduction to Computer Systems (I, 1)" with the chosen sections in parentheses
//   credits     "Transfer Credits - …", columns "Course", "Units", "Grade": AP for exam credit, TR for transfer
//   footer      "10-23-2026, 08:16 pm" and "1 of 2" on every page; a term's rows can continue on the next page
//
// Only what a plan needs is kept: programs, campus, level and the courses. Names, Andrew ids and advisors are read
// past, never stored.
import { termCode, type TextPiece } from './sio-record'

export interface StellicRow {
  /** Five-digit course id ("15213"). */
  courseId: string
  /** As printed, without the section list. */
  title: string
  /** Sections chosen in Stellic, e.g. ["I", "1"]; empty when none. */
  sections: string[]
  /** Null when the row has no units (activities). */
  units: number | null
  /** As printed ("A", "AP", "TR"); absent for "-" or when the term has no grade column. */
  grade?: string
  /** "Planned", "Taken", …; null for transfer credit (which has no status column). */
  status: string | null
}

export interface StellicTerm {
  /** App term code, e.g. "F26". */
  term: string
  rows: StellicRow[]
}

export interface StellicPlan {
  /** Program names as Stellic prints them, e.g. "BS in Computer Science". */
  programs: string[]
  campus: string | null
  level: 'undergraduate' | 'graduate' | null
  terms: StellicTerm[]
  /** The "Transfer Credits" block: AP and other exam credit, and transfer credit. */
  credits: StellicRow[]
  /** Lines that weren't courses (activities without a course number, notes) or couldn't be read. */
  skipped: string[]
}

export class NotStellicPlanError extends Error {
  constructor(message = "This doesn't look like a Stellic plan.") {
    super(message)
    this.name = 'NotStellicPlanError'
  }
}

interface Row {
  pieces: TextPiece[]
  /** Distance from the top of the page. */
  top: number
  size: number
}

const text = (pieces: TextPiece[]) =>
  pieces
    .map((p) => p.str.trim())
    .filter(Boolean)
    .join(' ')

/** One page's pieces as rows, top to bottom, each left to right. */
function pageRows(pieces: TextPiece[]): Row[] {
  const rows: Row[] = []
  // The footer (print date, "1 of 2") shares a row; drop its pieces before grouping.
  const kept = pieces.filter((p) => p.str.trim() && !FOOTER.some((re) => re.test(p.str.trim())))
  for (const p of kept.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1)
    if (row && Math.abs(row.pieces[0].y - p.y) <= Math.max(2, p.size * 0.35)) row.pieces.push(p)
    else rows.push({ pieces: [p], top: -p.y, size: p.size })
  }
  for (const row of rows) row.pieces.sort((a, b) => a.x - b.x)
  return rows
}

const FOOTER = [/^\d{1,2}-\d{1,2}-\d{4},?\s+\d{1,2}:\d{2}\s*[ap]m$/i, /^\d+ of \d+$/]
const COLUMN_NAMES: Record<string, Column> = { 'course or activity': 'course', course: 'course', units: 'units', grade: 'grade', status: 'status' }
type Column = 'course' | 'units' | 'grade' | 'status'

const CREDITS_HEADING = /^Transfer Credits?\b/i
const COURSE = /^(\d{2})-(\d{3})\s+(.*)$/
/** A trailing "(I, 1)" / "(SC)" / "(C2)": the sections chosen in Stellic. */
const SECTIONS = /\s*\(([A-Z0-9]{1,4}(?:,\s*[A-Z0-9]{1,4})*)\)$/
const LABEL = /^[A-Z][A-Za-z ]{1,20}:$/
/** Where a new program starts in the wrapped "Programs:" value (otherwise a line continues the previous one). */
const PROGRAM_START = /^(?:B[A-Z]{1,4}|M[A-Z]{1,4}|PHD|Ph\.?D\.?|Minor|Additional Major|Major|Bachelor|Master|Doctor|Certificate|Concentration|Track)\b/

function termOfHeading(line: string): string | null {
  return termCode(line.split(/\s+[-–]\s+/)[0])
}

function isColumnHeader(row: Row): boolean {
  return row.pieces.length >= 2 && row.pieces.every((p) => p.str.trim().toLowerCase() in COLUMN_NAMES)
}

/** True when the pages look like a Stellic plan PDF. */
export function isStellicPlan(pages: TextPiece[][]): boolean {
  const rows = pages.flatMap(pageRows)
  return rows.some((r) => text(r.pieces) === 'Course or Activity' || /^Course or Activity\b/.test(text(r.pieces))) || rows.some((r) => r.pieces.some((p) => p.str.trim() === 'Programs:'))
}

export function parseStellicPieces(pages: TextPiece[][]): StellicPlan {
  if (!isStellicPlan(pages)) {
    throw new NotStellicPlanError(pages.flat().some((p) => p.str.trim()) ? undefined : 'This PDF has no readable text. Download the plan from Stellic again.')
  }
  const plan: StellicPlan = { programs: [], campus: null, level: null, terms: [], credits: [], skipped: [] }

  // Header fields: label → value lines, and where each label's value starts (for wrapped lines).
  const fields = new Map<string, string[]>()
  const valueX: { label: string; x: number }[] = []
  let inHeader = true

  let section: { kind: 'term'; term: StellicTerm } | { kind: 'credits' } | { kind: 'other' } | null = null
  let columns: { col: Column; x: number }[] = []
  let last: { row: StellicRow; bottom: number; size: number; raw: string } | null = null
  const finish = () => {
    if (!last) return
    const m = SECTIONS.exec(last.raw)
    last.row.title = (m ? last.raw.slice(0, m.index) : last.raw).trim()
    last.row.sections = m ? m[1].split(/,\s*/) : []
    last = null
  }

  for (const rows of pages.map(pageRows)) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const line = text(row.pieces)
      const term = row.pieces.length === 1 ? termOfHeading(line) : null
      if (term || (row.pieces.length === 1 && CREDITS_HEADING.test(line))) {
        finish()
        inHeader = false
        if (term) {
          let t = plan.terms.find((x) => x.term === term)
          if (!t) plan.terms.push((t = { term, rows: [] }))
          section = { kind: 'term', term: t }
        } else section = { kind: 'credits' }
        columns = []
        continue
      }
      if (isColumnHeader(row)) {
        finish()
        inHeader = false
        columns = row.pieces.map((p) => ({ col: COLUMN_NAMES[p.str.trim().toLowerCase()], x: p.x }))
        // A heading we don't know (not a term, not transfer credit) right above a column header: skip its rows.
        if (!section) section = { kind: 'other' }
        continue
      }

      if (inHeader) {
        readHeaderRow(row, fields, valueX)
        continue
      }

      const next = rows[i + 1]
      if (row.pieces.length === 1 && next && isColumnHeader(next) && !COURSE.test(line)) {
        // An unrecognized heading.
        finish()
        section = { kind: 'other' }
        continue
      }

      const cells: Record<Column, string[]> = { course: [], units: [], grade: [], status: [] }
      for (const p of row.pieces) {
        const col = [...columns].reverse().find((c) => c.x <= p.x + 4)?.col ?? 'course'
        cells[col].push(p.str.trim())
      }
      const courseText = cells.course.join(' ')
      const m = COURSE.exec(courseText)
      const onlyCourse = !cells.units.length && !cells.grade.length && !cells.status.length
      // A wrapped title: tightly under the previous row, with nothing in the other columns.
      if (!m && onlyCourse && last && row.top - last.bottom < last.size * 1.4) {
        last.raw += ` ${courseText}`
        last.bottom = row.top
        continue
      }
      finish()
      if (!m || !section || section.kind === 'other') {
        plan.skipped.push(line)
        continue
      }
      const unitsText = cells.units.join(' ')
      const units = /^\d+(?:\.\d+)?$/.test(unitsText) ? Number(unitsText) : null
      const grade = cells.grade.join(' ')
      const r: StellicRow = {
        courseId: m[1] + m[2],
        title: m[3],
        sections: [],
        units,
        ...(grade && grade !== '-' ? { grade } : {}),
        status: section.kind === 'credits' ? null : cells.status.join(' ') || null,
      }
      if (section.kind === 'credits') plan.credits.push(r)
      else section.term.rows.push(r)
      last = { row: r, bottom: row.top, size: row.size, raw: m[3] }
    }
    // Rows continue on the next page; a wrapped title doesn't.
    if (last) last.bottom = -Infinity
  }
  finish()

  plan.programs = programsOf(fields.get('Programs') ?? [])
  plan.campus = fields.get('Campus')?.join(' ') || null
  const level = fields.get('Level')?.join(' ') ?? ''
  plan.level = /first[- ]year|freshman|sophomore|junior|senior|fifth|undergrad/i.test(level)
    ? 'undergraduate'
    : /master|doctor|ph\.?d|grad/i.test(level)
      ? 'graduate'
      : null
  plan.terms = plan.terms.filter((t) => t.rows.length)
  return plan
}

/** A header row: "Label:" pieces start values; pieces of rows without labels continue the nearest value above. */
function readHeaderRow(row: Row, fields: Map<string, string[]>, valueX: { label: string; x: number }[]) {
  let label: string | null = null
  let parts: string[] = []
  const flush = () => {
    if (label && parts.length) fields.set(label, [...(fields.get(label) ?? []), parts.join(' ')])
    parts = []
  }
  const labelled = row.pieces.some((p) => LABEL.test(p.str.trim()))
  for (const p of row.pieces) {
    const s = p.str.trim()
    if (LABEL.test(s)) {
      flush()
      label = s.slice(0, -1)
      continue
    }
    if (labelled) {
      if (!label) continue
      if (!parts.length) {
        // Most recent last, so a wrapped line goes to the latest label among those sharing a value column.
        const at = valueX.findIndex((v) => v.label === label)
        if (at >= 0) valueX.splice(at, 1)
        valueX.push({ label, x: p.x })
      }
      parts.push(s)
    } else {
      // A wrapped value: belongs to the label whose value starts closest to it.
      const near = [...valueX].reverse().sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0]
      if (near && Math.abs(near.x - p.x) < 12) fields.set(near.label, [...(fields.get(near.label) ?? []), s])
    }
  }
  flush()
}

/** Wrapped "Programs:" lines → program names. */
function programsOf(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (out.length && !PROGRAM_START.test(line)) out[out.length - 1] += ` ${line}`
    else out.push(line)
  }
  return out.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}
