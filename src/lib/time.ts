import type { Day, Meeting } from './types'

export const DAYS: Day[] = [0, 1, 2, 3, 4, 5, 6]
export const DAY_LETTERS = ['M', 'T', 'W', 'R', 'F', 'S', 'U'] as const
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** "MWF", "TR" — CMU's own day notation. */
export function formatDays(days: Day[]): string {
  return days.length ? days.map((d) => DAY_LETTERS[d]).join('') : 'TBA'
}

/** 570 → "9:30 AM"; compact: "9:30a". */
export function formatTime(minutes: number, compact = false): string {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  const suffix = h24 < 12 ? 'AM' : 'PM'
  if (compact) return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix[0].toLowerCase()}`
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`
}

/** "9:30 AM – 10:50 AM", or "TBA". Drops the first suffix when both share it. */
export function formatTimeRange(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'TBA'
  const a = formatTime(start)
  const b = formatTime(end)
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}–${b}`
  return `${a}–${b}`
}

export function formatLocation(m: Meeting): string {
  if (!m.building) return 'TBA'
  return m.room ? `${m.building} ${m.room}` : m.building
}

export function isScheduled(m: Meeting): m is Meeting & { start: number; end: number } {
  return m.days.length > 0 && m.start !== null && m.end !== null
}

export function formatUnits(units: number | null): string {
  return units === null ? 'VAR' : String(units)
}
