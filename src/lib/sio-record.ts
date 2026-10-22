// Parser for SIO's "Unofficial Academic Record" PDF (SIO → Academic Record → Unofficial Academic Record → PDF).
// Pure: it works on positioned text items (as pdf.js returns them), so it runs in the browser and in tests without
// a PDF library. Nothing here sends the document anywhere.
//
// Layout it understands:
//   header      "<Name> :: Unofficial Academic Record as of <date>", then "Name:", "College:", "Department:", "Major:"
//   credits     "Advanced Placement / Transfer Credits" with sub-sections "ADVANCED PLACEMENT CREDIT" (and other exam
//               credit) and "TRANSFER CREDIT FROM <INSTITUTION>"; rows "DPT CRS# TITLE UNITS GRADE" (DPT optional)
//   terms       academic years "2026 / 2027", terms "Fall 2026" / "Spring 2027" / "Summer 2027", rows
//               "DPT CRS# TITLE UNITS [GRADE] QUALITY_POINTS", then "Semester" / "Cumulative" summaries
//   sidebar     a FERPA "NOTE" column on the right, dropped before parsing

/** A positioned piece of text, in PDF user-space units (y grows upward). */
export interface TextPiece {
  str: string
  x: number
  y: number
  width: number
  /** Font size (pdf.js transform[0]); used to decide where spaces go. */
  size: number
}

export interface SioCourseRow {
  /** Five-digit course id ("15122"). */
  courseId: string
  /** SIO's abbreviated title, e.g. "INTR CMPUTER SYSTEMS". */
  title: string
  units: number
  /** Normalized grade ("A", "P", "W", "AD", "TR", …); undefined when the term has no grade yet. */
  grade?: string
  /** Department code SIO shows (e.g. "CS"); absent for some exam-credit rows. */
  dept?: string
}

export interface SioTerm {
  /** App term code, e.g. "F26", "S27", "M27". */
  term: string
  /** As printed, e.g. "Fall 2026". */
  label: string
  rows: SioCourseRow[]
}

export interface SioTransferGroup {
  /** Title-cased institution, e.g. "Example Community College". */
  institution: string
  rows: SioCourseRow[]
}

export interface SioRecord {
  /** "as of" date printed in the header, e.g. "21 Oct 2026". */
  asOf: string | null
  profile: {
    name: string | null
    college: string | null
    /** Matching code from the record store's COLLEGES, when recognized. */
    collegeCode: string | null
    department: string | null
    major: string | null
    level: 'undergraduate' | 'graduate' | null
  }
  /** AP / IB / other exam credit (SIO lists these under "ADVANCED PLACEMENT CREDIT" and similar headings). */
  exam: SioCourseRow[]
  transfer: SioTransferGroup[]
  terms: SioTerm[]
  /** Lines that looked like course rows but couldn't be read. */
  warnings: string[]
}

export class NotSioRecordError extends Error {
  constructor(message = "This doesn't look like an SIO unofficial academic record.") {
    super(message)
    this.name = 'NotSioRecordError'
  }
}

// ---------------------------------------------------------------------------
// Text items → lines

/**
 * Groups one page's pieces into lines (top to bottom), each sorted left to right, with spaces inserted where the gap
 * between pieces is wider than a fraction of the font size. The right-hand FERPA "NOTE" sidebar is dropped.
 */
export function pageLines(pieces: TextPiece[]): string[] {
  const visible = pieces.filter((p) => p.str.trim() !== '')
  const note = visible.find((p) => p.str.trim() === 'NOTE')
  // Everything from the sidebar's left edge rightwards belongs to the sidebar.
  const sidebarX = note ? note.x - 2 : Infinity
  const main = visible.filter((p) => p.x < sidebarX)

  const rows: TextPiece[][] = []
  for (const p of [...main].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.at(-1)
    const tolerance = Math.max(2, p.size * 0.35)
    if (row && Math.abs(row[0].y - p.y) <= tolerance) row.push(p)
    else rows.push([p])
  }

  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const p of sorted) {
      const gap = p.x - end
      if (line && (gap > p.size * 0.18 || /\s$/.test(line) || /^\s/.test(p.str))) line += ' '
      line += p.str
      end = p.x + p.width
    }
    return line.replace(/\s+/g, ' ').trim()
  })
}

// ---------------------------------------------------------------------------
// Lines → record

const COLLEGE_CODES: [RegExp, string][] = [
  [/computer science/i, 'SCS'],
  [/engineering|carnegie institute of technology/i, 'CIT'],
  [/dietrich|humanities and social sciences/i, 'DC'],
  [/mellon college of science/i, 'MCS'],
  [/fine arts/i, 'CFA'],
  [/tepper|business/i, 'TSB'],
  [/heinz/i, 'HC'],
  [/humanities and arts/i, 'BHA'],
  [/intercollege|bxa/i, 'BXA'],
]

export function collegeCode(name: string | null): string | null {
  if (!name) return null
  return COLLEGE_CODES.find(([re]) => re.test(name))?.[1] ?? null
}

const SEASON: Record<string, 'F' | 'S' | 'M'> = { fall: 'F', spring: 'S', summer: 'M' }

/** "Fall 2026" → "F26"; "Summer One 2027" / "Summer Session II 2027" → "M27". */
export function termCode(label: string): string | null {
  const text = label
    .trim()
    .replace(/\s*[-–(]?\s*\(?cont(?:inued|'d|\.)?\)?\s*$/i, '')
    .trim()
  const m = /^(Fall|Spring|Summer)(?:\s+(?:Session\s+)?(?:One|Two|I{1,2}|1|2|All))?\s+(\d{4})$/i.exec(text)
  if (!m) return null
  return `${SEASON[m[1].toLowerCase()]}${m[2].slice(2)}`
}

/** Title Case for institution names ("MONTGOMERY COLLEGE" style input), keeping small words lowercase. */
export function titleCase(text: string): string {
  const small = new Set(['of', 'and', 'the', 'at', 'in', 'for', 'on'])
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/(^|[-/(])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase())))
    .join(' ')
}

// DPT? CRS# TITLE UNITS [GRADE] [QUALITY POINTS]. Units and quality points always carry one decimal in SIO.
const ROW =
  /^(?:([A-Z][A-Z0-9]{1,3})\s+)?(\d{2})-?(\d{3})\s+(.+?)\s+(\d{1,3}\.\d{1,2})(?:\s+([A-Z]{1,2}[+-]?|\*{1,2}))?(?:\s+(\d{1,4}\.\d{1,2}))?(?:\s+[*#@^]+)?$/
// Something that starts like a course row; used to report rows the full pattern couldn't read.
const ROW_START = /^(?:[A-Z][A-Z0-9]{1,3}\s+)?\d{2}-?\d{3}\s/

export function parseCourseRow(line: string): SioCourseRow | null {
  const m = ROW.exec(line)
  if (!m) return null
  const units = Number(m[5])
  if (!Number.isFinite(units)) return null
  const grade = m[6] && !m[6].startsWith('*') ? m[6] : undefined
  return {
    courseId: m[2] + m[3],
    title: m[4].trim(),
    units,
    ...(grade ? { grade } : {}),
    ...(m[1] ? { dept: m[1] } : {}),
  }
}

type Section = { kind: 'none' } | { kind: 'exam' } | { kind: 'transfer'; group: SioTransferGroup } | { kind: 'term'; term: SioTerm }

const EXAM_HEADING = /^(?:ADVANCED PLACEMENT|INTERNATIONAL BACCALAUREATE|A[- ]LEVELS?|CAMBRIDGE|CREDIT BY EXAM|EXAM(?:INATION)?|TEST|AP|IB)\b.*CREDITS?$|^(?:ADVANCED PLACEMENT|INTERNATIONAL BACCALAUREATE) CREDITS?/i
const TRANSFER_HEADING = /^TRANSFER(?:RED)? CREDITS?(?: (?:FROM|AT)\s+(.+?))?\s*$/i
/** The block that holds AP and transfer credit ("Advanced Placement / Transfer Credits"). */
const CREDITS_BLOCK = /^Advanced Placement\s*\/\s*Transfer Credits?$/i
/** Any other all-caps "... CREDIT" sub-heading inside the credits block (e.g. "OTHER CREDIT"). */
const OTHER_CREDIT_HEADING = /^[A-Z][A-Z &/,.'-]{2,60} CREDITS?$/
const IGNORED = [
  /^=+$/,
  /^(?:Beginning|End) of (?:Undergraduate|Graduate) Record$/i,
  /^DPT\b/,
  /^(?:FINAL|GRADE|POINTS|UNITS|QUALITY|PASSED|FACTORABLE|QPA|TOTAL)\b/i,
  /^(?:Semester|Cumulative)\b/i,
  /^\d{4}\s*\/\s*\d{4}$/,
  /^TOTAL AP \/ TRANSFER CREDIT/i,
  /Unofficial Academic Record/i,
  /^Carnegie Mellon University/i,
  /^Page \d+ of \d+$/i,
]

/** Parses the lines of every page. Throws NotSioRecordError when the text isn't an SIO unofficial record. */
export function parseSioLines(pages: string[][]): SioRecord {
  const all = pages.flat()
  const header = all.find((l) => /Unofficial Academic Record as of/i.test(l))
  if (!header && !all.some((l) => /Unofficial Academic Record/i.test(l))) {
    throw new NotSioRecordError(
      all.length ? undefined : "This PDF has no readable text. Download the PDF from SIO again rather than scanning or printing it.",
    )
  }

  const record: SioRecord = {
    asOf: header ? (/as of (.+)$/i.exec(header)?.[1]?.trim() ?? null) : null,
    profile: { name: null, college: null, collegeCode: null, department: null, major: null, level: null },
    exam: [],
    transfer: [],
    terms: [],
    warnings: [],
  }

  let section: Section = { kind: 'none' }
  let inCredits = false
  for (const line of all) {
    if (CREDITS_BLOCK.test(line)) {
      inCredits = true
      section = { kind: 'exam' }
      continue
    }
    const field = /^(Name|College|Department|Major):\s*(.*)$/.exec(line)
    if (field) {
      const value = field[2].trim() || null
      if (field[1] === 'Name') record.profile.name = value
      else if (field[1] === 'College') record.profile.college = value
      else if (field[1] === 'Department') record.profile.department = value
      else record.profile.major = value
      continue
    }
    if (/^Beginning of Undergraduate Record$/i.test(line)) record.profile.level ??= 'undergraduate'
    else if (/^Beginning of Graduate Record$/i.test(line)) record.profile.level ??= 'graduate'

    const transfer = TRANSFER_HEADING.exec(line)
    if (transfer) {
      const group: SioTransferGroup = { institution: transfer[1] ? titleCase(transfer[1]) : 'Another institution', rows: [] }
      record.transfer.push(group)
      section = { kind: 'transfer', group }
      continue
    }
    if (EXAM_HEADING.test(line) || (inCredits && OTHER_CREDIT_HEADING.test(line) && !/^TOTAL\b/i.test(line))) {
      section = { kind: 'exam' }
      continue
    }
    const code = termCode(line)
    if (code) {
      inCredits = false
      let term = record.terms.find((t) => t.term === code)
      if (!term) {
        term = { term: code, label: line.trim(), rows: [] }
        record.terms.push(term)
      }
      section = { kind: 'term', term }
      continue
    }
    if (IGNORED.some((re) => re.test(line))) continue

    if (!ROW_START.test(line)) continue
    const row = parseCourseRow(line)
    if (!row || section.kind === 'none') {
      record.warnings.push(line)
      continue
    }
    if (section.kind === 'exam') record.exam.push(row)
    else if (section.kind === 'transfer') section.group.rows.push(row)
    else section.term.rows.push(row)
  }

  record.profile.collegeCode = collegeCode(record.profile.college)
  record.transfer = record.transfer.filter((g) => g.rows.length)
  record.terms = record.terms.filter((t) => t.rows.length)
  // The header said it's an SIO record; an empty one (or one we couldn't read) is reported by the caller.
  return record
}

/** Convenience: positioned pieces per page → record. */
export function parseSioPieces(pages: TextPiece[][]): SioRecord {
  return parseSioLines(pages.map(pageLines))
}
