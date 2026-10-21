// Compact, URL-safe encoding of a schedule for share links.
//
// Text form (version 2):  2|<termId>|<entry>,<entry>,…|<name>
//   entry = <courseId>.<section>.<child>.<color>[h][p]
//   section/child are empty when unchosen; trailing h = hidden, p = taken pass/fail.
// Version 1 (still decoded): 1|<termId>|<courseId>.<section>.<color>[h],…|<name>
// The name is last so it may contain any character. The text is UTF-8, then base64url without padding.

export interface SharedEntry {
  courseId: string
  section: string | null
  /** Recitation/lab of `section`. */
  child: string | null
  color: number
  hidden: boolean
  /** The student elected pass/fail grading. */
  passFail: boolean
}

export interface SharedSchedule {
  termId: string
  name: string
  entries: SharedEntry[]
}

const VERSION = '2'
const MAX_ENTRIES = 60
const MAX_NAME = 120
const ENTRY_V1 = /^(\d{5})\.([A-Za-z0-9]{0,6})\.(\d{1,2})(h?)$/
const ENTRY_V2 = /^(\d{5})\.([A-Za-z0-9]{0,6})\.([A-Za-z0-9]{0,6})\.(\d{1,2})(h?)(p?)$/
const TERM = /^[A-Za-z0-9]{1,10}$/

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export function encodeSchedule(schedule: SharedSchedule): string {
  const entries = schedule.entries
    .slice(0, MAX_ENTRIES)
    .map(
      (e) =>
        `${e.courseId}.${e.section ?? ''}.${e.child ?? ''}.${Math.max(0, Math.min(99, Math.trunc(e.color)))}${e.hidden ? 'h' : ''}${e.passFail ? 'p' : ''}`,
    )
    .join(',')
  const name = schedule.name.slice(0, MAX_NAME)
  return toBase64Url(new TextEncoder().encode(`${VERSION}|${schedule.termId}|${entries}|${name}`))
}

function parseEntry(raw: string, version: string): SharedEntry | null {
  if (version === '1') {
    const m = ENTRY_V1.exec(raw)
    return m ? { courseId: m[1], section: m[2] || null, child: null, color: Number(m[3]), hidden: m[4] === 'h', passFail: false } : null
  }
  const m = ENTRY_V2.exec(raw)
  if (!m || (m[3] && !m[2])) return null
  return { courseId: m[1], section: m[2] || null, child: m[3] || null, color: Number(m[4]), hidden: m[5] === 'h', passFail: m[6] === 'p' }
}

/** Returns null for anything that isn't a well-formed version 1 or 2 payload. */
export function decodeSchedule(payload: string): SharedSchedule | null {
  if (!payload || payload.length > 4000) return null
  const bytes = fromBase64Url(payload.trim())
  if (!bytes) return null

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }

  const first = text.indexOf('|')
  const second = text.indexOf('|', first + 1)
  const third = text.indexOf('|', second + 1)
  if (first < 0 || second < 0 || third < 0) return null

  const version = text.slice(0, first)
  const termId = text.slice(first + 1, second)
  const entryText = text.slice(second + 1, third)
  const name = text.slice(third + 1)
  if ((version !== '1' && version !== VERSION) || !TERM.test(termId) || name.length > MAX_NAME) return null

  const entries: SharedEntry[] = []
  const seen = new Set<string>()
  for (const raw of entryText ? entryText.split(',') : []) {
    const entry = parseEntry(raw, version)
    if (!entry || seen.has(entry.courseId)) return null
    seen.add(entry.courseId)
    entries.push(entry)
  }
  if (entries.length > MAX_ENTRIES) return null

  return { termId, name: name.trim() || 'Shared schedule', entries }
}

export function shareUrl(origin: string, schedule: SharedSchedule, base = '/'): string {
  const root = base.endsWith('/') ? base : `${base}/`
  return `${origin}${root}${encodeURIComponent(schedule.termId)}/schedule?import=${encodeSchedule(schedule)}`
}
