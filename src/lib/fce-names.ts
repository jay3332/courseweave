// Name and term helpers shared by scripts/build-fce.ts (Node) and the app. No imports, so both can load it.
//
// FCE instructor names are "LAST, First Middle" (often upper case); the Schedule of Classes uses
// "First Middle Last". Names are matched on (first given name, full last name), with a fallback on
// (first initial, last name) for initials and nicknames.

function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z\s,.-]/g, ' ')
}

function tokens(s: string): string[] {
  return s.split(/[\s.-]+/).filter(Boolean)
}

export interface NameKeys {
  /** "first|last name", e.g. "iliano|cervesato", "claire|le goues". */
  full: string
  /** "f|last name", for initials and nicknames. */
  initial: string
}

function keysOf(first: string[], last: string[]): NameKeys {
  const f = first[0] ?? ''
  const l = last.join(' ')
  return { full: `${f}|${l}`, initial: `${f.slice(0, 1)}|${l}` }
}

/** Keys for an FCE-style name ("CERVESATO, ILIANO"). Names without a comma are read as "First Last". */
export function fceNameKeys(name: string): NameKeys {
  const n = normalizeName(name)
  const comma = n.indexOf(',')
  if (comma === -1) return scheduleNameCandidates(name)[0] ?? { full: '|', initial: '|' }
  return keysOf(tokens(n.slice(comma + 1)), tokens(n.slice(0, comma)))
}

/**
 * Candidate keys for a schedule-style name ("Claire Le Goues"), one per way of splitting it into
 * first name and last name, shortest last name first.
 */
export function scheduleNameCandidates(name: string): NameKeys[] {
  const t = tokens(normalizeName(name).replace(/,/g, ' '))
  if (t.length < 2) return t.length ? [keysOf([], t)] : []
  const out: NameKeys[] = []
  for (let k = t.length - 1; k >= 1; k--) out.push(keysOf(t.slice(0, 1), t.slice(k)))
  return out
}

const firstOf = (k: NameKeys) => k.full.slice(0, k.full.indexOf('|'))

/** Whether an FCE-style name and a schedule-style name refer to the same person. */
export function sameInstructor(fceName: string, scheduleName: string): boolean {
  const k = fceNameKeys(fceName)
  const candidates = scheduleNameCandidates(scheduleName)
  if (candidates.some((c) => c.full === k.full)) return true
  const last = (x: NameKeys) => x.full.slice(x.full.indexOf('|') + 1)
  return candidates.some((c) => last(c) === last(k) && firstNamesCompatible(firstOf(c), firstOf(k)))
}

/** Common English nicknames → formal names. Only consulted when the last names already match. */
const NICKNAMES: Record<string, string[]> = {
  al: ['albert', 'alan', 'alfred', 'alexander'],
  bert: ['robert', 'albert', 'herbert'],
  beth: ['elizabeth'],
  betsy: ['elizabeth'],
  bill: ['william'],
  billy: ['william'],
  bob: ['robert'],
  bobby: ['robert'],
  cathy: ['catherine', 'cathleen'],
  charlie: ['charles'],
  chuck: ['charles'],
  cindy: ['cynthia'],
  dan: ['daniel'],
  danny: ['daniel'],
  dave: ['david'],
  dick: ['richard'],
  don: ['donald'],
  drew: ['andrew'],
  ed: ['edward', 'edwin'],
  eddie: ['edward'],
  hank: ['henry'],
  harry: ['harold', 'henry'],
  jack: ['john'],
  jen: ['jennifer'],
  jenny: ['jennifer'],
  jerry: ['gerald', 'jerome', 'jeremy'],
  jim: ['james'],
  jimmy: ['james'],
  joe: ['joseph'],
  kate: ['katherine', 'kathleen', 'catherine', 'kathryn'],
  katie: ['katherine', 'kathleen', 'catherine', 'kathryn'],
  kathy: ['katherine', 'kathleen', 'kathryn'],
  larry: ['lawrence'],
  len: ['leonard'],
  lenny: ['leonard'],
  liz: ['elizabeth'],
  maggie: ['margaret'],
  meg: ['margaret'],
  mike: ['michael'],
  nick: ['nicholas', 'dominick', 'dominic'],
  peggy: ['margaret'],
  rich: ['richard'],
  rick: ['richard', 'frederick'],
  rob: ['robert'],
  ron: ['ronald'],
  sandy: ['sandra', 'alexandra'],
  steve: ['steven', 'stephen'],
  sue: ['susan', 'suzanne'],
  ted: ['edward', 'theodore'],
  tom: ['thomas'],
  tony: ['anthony'],
  vicky: ['victoria'],
  zach: ['zachary'],
  zack: ['zachary'],
}

/** Same person by first name: equal, an initial, a 3+ letter prefix (Ben / Benjamin), or a known nickname (Liz / Elizabeth). */
function firstNamesCompatible(a: string, b: string): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length === 1 || b.length === 1) return a[0] === b[0]
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 3 && long.startsWith(short)) return true
  return Boolean(NICKNAMES[a]?.includes(b) || NICKNAMES[b]?.includes(a))
}

/**
 * Lookup of values keyed by FCE-style names, queried with schedule-style names.
 * Exact (first, last) matches win; otherwise a unique compatible first name with the same last name.
 */
export class NameIndex<T> {
  private byFull = new Map<string, T>()
  private byLast = new Map<string, { first: string; value: T }[]>()

  add(fceName: string, value: T) {
    this.addKey(fceNameKeys(fceName).full, value)
  }

  /** Adds under a precomputed full key ("first|last"), as written by build-fce. */
  addKey(full: string, value: T) {
    if (this.byFull.has(full)) return
    this.byFull.set(full, value)
    const bar = full.indexOf('|')
    const last = full.slice(bar + 1)
    const list = this.byLast.get(last) ?? []
    list.push({ first: full.slice(0, bar), value })
    this.byLast.set(last, list)
  }

  /** Every value, in the order added. */
  values(): T[] {
    return [...this.byFull.values()]
  }

  get(scheduleName: string): T | undefined {
    const candidates = scheduleNameCandidates(scheduleName)
    for (const c of candidates) {
      const hit = this.byFull.get(c.full)
      if (hit !== undefined) return hit
    }
    for (const c of candidates) {
      const last = c.full.slice(c.full.indexOf('|') + 1)
      const hits = (this.byLast.get(last) ?? []).filter((h) => firstNamesCompatible(h.first, firstOf(c)))
      if (hits.length === 1) return hits[0].value
    }
    return undefined
  }
}

/** "CERVESATO, ILIANO" → "Iliano Cervesato". Leaves mixed-case words alone. */
export function displayFceName(name: string): string {
  const comma = name.indexOf(',')
  const ordered = comma === -1 ? name : `${name.slice(comma + 1)} ${name.slice(0, comma)}`
  return ordered
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() ? w.toLowerCase().replace(/(^|[-'.])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase()) : w))
    .join(' ')
}

// ---- Terms ----

export type FceSeason = 'Spring' | 'Summer' | 'Fall'
const SEASON_LETTER: Record<FceSeason, string> = { Spring: 'S', Summer: 'M', Fall: 'F' }
const LETTER_SEASON: Record<string, FceSeason> = { S: 'Spring', M: 'Summer', F: 'Fall' }
const SEASON_ORDER: Record<string, number> = { S: 0, M: 1, F: 2 }

/** (2026, "Spring") → "S26". */
export function fceTermCode(year: number, season: FceSeason): string {
  return `${SEASON_LETTER[season]}${String(year % 100).padStart(2, '0')}`
}

/** Sortable index: later terms are larger. */
export function termOrder(code: string): number {
  const year = 2000 + Number(code.slice(1))
  return year * 3 + (SEASON_ORDER[code[0]] ?? 0)
}

/** "S26" → "Spring 2026". */
export function termName(code: string): string {
  return `${LETTER_SEASON[code[0]] ?? code[0]} ${2000 + Number(code.slice(1))}`
}

/** FCE course numbers come as "15122", "15-122", "6222" (leading zero dropped) or "FA14-12-100". */
export function normalizeFceCourse(num: string): string | null {
  const digits = num.replace(/\D/g, '')
  if (digits.length >= 5) return digits.slice(-5)
  if (digits.length === 4) return `0${digits}`
  return null
}

// ---- Minis ----

/** Mini numbers by season: fall minis 1/2, spring 3/4, summer 5/6 (odd = first half, even = second). */
const SEASON_MINIS: Record<FceSeason, [number, number]> = { Fall: [1, 2], Spring: [3, 4], Summer: [5, 6] }

/**
 * Mini number of an FCE section name, or null for full-semester sections.
 * Minis end in the mini digit after a letter code ("A3", "B4", "M1") or a lecture number ("13" is lecture 1 in
 * mini 3, as the Schedule of Classes names them). Single digits ("1") are full-semester lectures.
 */
export function fceSectionMini(section: string, season: FceSeason): number | null {
  const m = /^(?:[A-Z]{1,3}|\d)([1-6])$/i.exec(section.trim())
  if (!m) return null
  const n = Number(m[1])
  return SEASON_MINIS[season].includes(n) ? n : null
}

/** Which half of its semester a mini runs in. */
export function miniHalf(mini: number): 'first' | 'second' {
  return mini % 2 === 1 ? 'first' : 'second'
}
