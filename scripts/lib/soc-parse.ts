// Pure parsers for CMU's open Schedule of Classes (enr-apps.as.cmu.edu/open/SOC/SOCServlet).
// No I/O here so the parsers can be unit tested (src/lib/soc-parse.test.ts).

/** One <tr> of the search results table. Continuation rows (more meetings / more sections) have an empty course. */
export interface SocRow {
  /** Department title of the table this row is in, e.g. "COMPUTER SCIENCE". */
  department: string
  course: string
  title: string
  /** Summer only: "summer", "summer one", "qatar summer", … */
  session: string
  units: string
  section: string
  /** "Y" / "N" / "" */
  mini: string
  days: string
  begin: string
  end: string
  /** Campus, e.g. "Pittsburgh, Pennsylvania". */
  location: string
  /** Delivery mode label, e.g. "In-person Expectation". */
  mode: string
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

export function decodeHtml(s: string): string {
  return s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[name.toLowerCase()] ?? m
    })
    .replace(/\u00a0/g, ' ')
}

function cellText(cell: string): string {
  return decodeHtml(cell.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits an HTML fragment into rows of cell texts. Tolerates rows that are missing their opening <tr>. */
function tableRows(fragment: string): string[][] {
  const rows: string[][] = []
  for (const chunk of fragment.split(/<\/tr\s*>/i)) {
    const cells = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((m) => cellText(m[1]))
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** Column keys come from the header's `col-*` classes, so extra columns (summer's Session) are handled. */
const COLUMN_KEYS: Record<string, keyof SocRow> = {
  course: 'course',
  title: 'title',
  session: 'session',
  units: 'units',
  section: 'section',
  mini: 'mini',
  days: 'days',
  begin: 'begin',
  end: 'end',
  location: 'location',
  deliverymode: 'mode',
}

/** Parses a POST /SOCServlet/search results page (one table per department). */
export function parseSearchPage(html: string): SocRow[] {
  const out: SocRow[] = []
  const parts = html.split(/<h4 class="department-title">/i).slice(1)
  for (const part of parts) {
    const department = cellText(part.slice(0, part.indexOf('</h4>')))
    const head = part.slice(part.search(/<thead/i), part.search(/<\/thead/i))
    const columns = [...head.matchAll(/<th[^>]*class="col-([a-z]+)"/gi)].map((m) => COLUMN_KEYS[m[1].toLowerCase()])
    const bodyStart = part.search(/<tbody/i)
    if (bodyStart === -1 || !columns.length) continue
    const body = part.slice(bodyStart)
    const end = body.search(/<\/tbody/i)
    for (const cells of tableRows(end === -1 ? body : body.slice(0, end))) {
      if (cells.length < columns.length) continue
      const row: SocRow = { department, course: '', title: '', session: '', units: '', section: '', mini: '', days: '', begin: '', end: '', location: '', mode: '' }
      columns.forEach((key, i) => {
        if (key && key !== 'department') row[key] = cells[i]
      })
      if (!/^\d{5}$/.test(row.course)) row.course = ''
      out.push(row)
    }
  }
  return out
}

export interface DetailSection {
  name: string
  /** For non-lecture sections listed under a lecture, that lecture's raw label ("Lec 1"); otherwise null. */
  lecture: string | null
}

/** Lecture → section grouping from a /SOCServlet/courseDetails page (sections are listed under their lecture). */
export function parseDetailsGrouping(html: string): DetailSection[] {
  const start = html.search(/<th[^>]*>\s*Units/i)
  if (start === -1) return []
  const tableStart = html.lastIndexOf('<table', start)
  const table = html.slice(tableStart === -1 ? start : tableStart, html.indexOf('</table>', start))
  const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map((m) => cellText(m[1]))
  const col = headers.findIndex((h) => /^Sec(tion)?$/i.test(h))
  if (col === -1) return []
  const out: DetailSection[] = []
  let lecture: string | null = null
  for (const cells of tableRows(table)) {
    const name = cells[col]
    if (!name) continue
    if (isLecture(name)) {
      lecture = name
      out.push({ name, lecture: null })
    } else {
      out.push({ name, lecture })
    }
  }
  return out
}

/**
 * SOC title cells: "Course Title", "Course Title : Topic" (first row of a topics course), ": Topic"
 * (later sections), each optionally suffixed with "This Section Cancelled".
 */
export function splitSocTitle(raw: string): { base: string; topic: string | null; cancelled: boolean } {
  let t = raw.replace(/\s+/g, ' ').trim()
  const cancelled = /\bThis Section Cancell?ed$/i.test(t)
  if (cancelled) t = t.replace(/\s*\bThis Section Cancell?ed$/i, '').trim()
  if (t.startsWith(':')) return { base: '', topic: t.slice(1).trim() || null, cancelled }
  const i = t.indexOf(' : ')
  if (i === -1) return { base: t, topic: null, cancelled }
  return { base: t.slice(0, i).trim(), topic: t.slice(i + 3).trim() || null, cancelled }
}

/** "Lec 1" → "1", "Lec" → "1", "A" → "A". */
export function sectionName(raw: string): string {
  const m = /^Lec\s*(.*)$/.exec(raw.trim())
  if (!m) return raw.trim()
  return m[1].trim() || '1'
}

export function isLecture(raw: string): boolean {
  return /^Lec\b/.test(raw.trim())
}

/** Option value → label pairs from a <select name="…">. */
export function selectOptions(html: string, name: string): { value: string; label: string }[] {
  const i = html.search(new RegExp(`<select[^>]*name="${name}"`, 'i'))
  if (i === -1) return []
  const seg = html.slice(i, html.indexOf('</select>', i))
  return [...seg.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)].map((m) => ({ value: m[1], label: cellText(m[2]) }))
}

/** Delivery mode labels → the SOC codes used by the CSV exports (IPE, REO, …). */
export const MODE_CODES: Record<string, string> = {
  'In-person Expectation': 'IPE',
  'In-person only': 'IPO',
  'Remote only': 'REO',
  'In-person + remote': 'IPR',
  'In-person (rotation) + remote': 'IRR',
  'In-person + technology': 'IPT',
  'In-person Expectation Rotation': 'PER',
}

/** SOC code for a delivery mode label (case-insensitive); unknown labels pass through. */
export function modeCode(label: string): string {
  const key = Object.keys(MODE_CODES).find((k) => k.toLowerCase() === label.trim().toLowerCase())
  return key ? MODE_CODES[key] : label.trim()
}
