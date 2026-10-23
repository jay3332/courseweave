// Section reservations as the Schedule of Classes words them ("Some reservations are for Students in SCS"), condensed
// for display: "students in SCS, CIT and MCS; first-years in M00".

import { departmentName } from './departments'

const WHO: Record<string, string> = {
  students: 'students',
  'first-year': 'first-years',
  'first-years': 'first-years',
  sophomore: 'sophomores',
  junior: 'juniors',
  senior: 'seniors',
  undergrad: 'undergraduates',
  undergraduate: 'undergraduates',
  graduate: 'graduate students',
  'phd candidates': 'PhD candidates',
  '5th yr students': 'fifth-year students',
}

/** "First-Year with a primary major" → "first-years with a primary major". */
function whoLabel(raw: string): string {
  const m = /^(.*?)( with a primary major)?$/i.exec(raw.trim())!
  return (WHO[m[1].toLowerCase()] ?? m[1].toLowerCase()) + (m[2] ? ' with a primary major' : '')
}

/**
 * Codes whose reservation meaning differs from (or is missing in) the department list: a college code reserves seats
 * for the whole college ("SCS" is the School of Computer Science, not the SCS interdisciplinary department).
 */
const GROUPS: Record<string, string> = {
  CFA: 'College of Fine Arts',
  CIT: 'College of Engineering',
  DC: 'Dietrich College',
  HC: 'Heinz College',
  MCS: 'Mellon College of Science',
  SCS: 'School of Computer Science',
  TSB: 'Tepper School of Business',
  M00: 'MCS, undeclared',
}

const LINE = /^(?:Some|All) reservations are for (.+?)(?: in (.+))?$/i

/** "CIT: College of Engineering, DC: Dietrich College" for the codes in these lines that have known names. */
export function reservationCodes(lines: string[]): string {
  const codes = new Set(lines.flatMap((l) => LINE.exec(l.trim())?.[2] ?? []))
  return [...codes]
    .map((c) => [c, GROUPS[c] ?? departmentName(c)])
    .filter(([c, name]) => name !== c)
    .map(([c, name]) => `${c}: ${name}`)
    .join(', ')
}

const listJoin = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/**
 * Who a section's reserved seats are for, grouped by class: "students in CIT, CFA and DC; first-years in SCS".
 * A line without a group ("Some reservations are for Students") adds "others"; lines in another shape pass through.
 */
export function reservationSummary(lines: string[]): string {
  const groups = new Map<string, string[]>()
  const loose = new Set<string>()
  const other: string[] = []
  for (const line of lines) {
    const m = LINE.exec(line.trim())
    if (!m) {
      other.push(line.trim())
      continue
    }
    const who = whoLabel(m[1])
    if (!m[2]) {
      loose.add(who)
      continue
    }
    const list = groups.get(who) ?? []
    if (!list.includes(m[2])) list.push(m[2])
    groups.set(who, list)
  }
  const parts = [...groups].map(([who, where]) => `${who} in ${listJoin(where)}`)
  for (const who of loose) parts.push(groups.has(who) ? `other ${who}` : who)
  return [...parts, ...other].join('; ')
}
