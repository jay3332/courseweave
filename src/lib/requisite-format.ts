// Pure helpers for Requisite expressions, shared by scripts/build-catalog.ts and the app.
// Imports use explicit .ts extensions so Node can run the build script directly.
import type { Requisite } from './catalog-types.ts'

const toId = (code: string) => code.replace(/\D/g, '')

export function codeOf(id: string): string {
  return `${id.slice(0, 2)}-${id.slice(2)}`
}

/**
 * Best-effort parser for requisite text: "15112 or 02120", "(15-122 [] at least C) and (21-127 or 15-151)".
 * `and` binds tighter than `or`; commas read as `or`. Returns null for anything it can't interpret.
 */
export function parseRequisiteText(text: string): Requisite | null {
  const src = text.replace(/\[\s*\]/g, ' ')
  const tokens: string[] = []
  const re = /\s*(\(|\)|\band\b|\bor\b|\d{2}-?\d{3}|at least [A-D][+-]?|,)/iy
  let pos = 0
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) return null
    tokens.push(m[1].toLowerCase())
    pos = re.lastIndex
  }
  let i = 0
  const peek = () => tokens[i]
  function primary(): Requisite | null {
    const t = tokens[i++]
    if (t === '(') {
      const inner = orExpr()
      if (tokens[i++] !== ')') return null
      return inner
    }
    if (t && /^\d{2}-?\d{3}$/.test(t)) {
      const id = toId(t)
      const g = peek()?.match(/^at least ([a-d][+-]?)$/)
      if (g) {
        i++
        const grade = g[1].toUpperCase()
        return grade === 'D' ? { type: 'course', id } : { type: 'course', id, minGrade: grade }
      }
      return { type: 'course', id }
    }
    return null
  }
  function andExpr(): Requisite | null {
    const items = [primary()]
    while (peek() === 'and') {
      i++
      items.push(primary())
    }
    if (items.some((x) => !x)) return null
    return items.length === 1 ? items[0] : { type: 'all', items: items as Requisite[] }
  }
  function orExpr(): Requisite | null {
    const items = [andExpr()]
    while (peek() === 'or' || peek() === ',') {
      i++
      items.push(andExpr())
    }
    if (items.some((x) => !x)) return null
    return items.length === 1 ? items[0] : { type: 'any', items: items as Requisite[] }
  }
  if (!tokens.length) return null
  const result = orExpr()
  return result && i === tokens.length ? simplify(result) : null
}

/** Flattens same-kind nesting, collapses single-item groups, removes duplicate alternatives. */
export function simplify(r: Requisite): Requisite {
  if (r.type === 'course' || r.type === 'text') return r
  let items = r.items.map(simplify)
  if (r.type === 'all' || r.type === 'any') items = items.flatMap((x) => (x.type === r.type ? x.items : [x]))
  const seen = new Set<string>()
  items = items.filter((x) => {
    const k = JSON.stringify(x)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (items.length === 1) return items[0]
  if (r.type === 'atLeast') {
    if (r.n >= items.length) return { type: 'all', items }
    if (r.n <= 1) return { type: 'any', items }
    return { type: 'atLeast', n: r.n, items }
  }
  return { type: r.type, items }
}

/** Every course id mentioned anywhere in the expression, in first-seen order. */
export function requisiteCourses(req: Requisite | null): string[] {
  const out: string[] = []
  const walk = (r: Requisite) => {
    if (r.type === 'course') {
      if (!out.includes(r.id)) out.push(r.id)
    } else if (r.type !== 'text') r.items.forEach(walk)
  }
  if (req) walk(req)
  return out
}

/**
 * Whether `id` is unavoidable: every way of satisfying the expression needs it.
 * (For "15-122 and (21-127 or 15-151)", 15-122 is required, 21-127 is one option.)
 */
export function isRequired(req: Requisite | null, id: string): boolean {
  if (!req) return false
  switch (req.type) {
    case 'course':
      return req.id === id
    case 'text':
      return false
    case 'all':
      return req.items.some((x) => isRequired(x, id))
    case 'any':
      return req.items.every((x) => isRequired(x, id))
    case 'atLeast': {
      const avoidable = req.items.filter((x) => !isRequired(x, id)).length
      return avoidable < req.n
    }
  }
}

/** Plain-text rendering, e.g. "15-122 (min C) and (21-127 or 15-151)". */
export function formatRequisite(req: Requisite | null, nested = false): string {
  if (!req) return 'None'
  switch (req.type) {
    case 'course':
      return req.minGrade ? `${codeOf(req.id)} (min ${req.minGrade})` : codeOf(req.id)
    case 'text':
      return req.text
    case 'all':
    case 'any': {
      const s = req.items.map((x) => formatRequisite(x, true)).join(req.type === 'all' ? ' and ' : ' or ')
      return nested ? `(${s})` : s
    }
    case 'atLeast': {
      const s = `${req.n} of ${req.items.map((x) => formatRequisite(x, true)).join(', ')}`
      return nested ? `(${s})` : s
    }
  }
}

/** Number of leaf requirements, used to decide how compactly to render. */
export function requisiteSize(req: Requisite | null): number {
  if (!req) return 0
  if (req.type === 'course' || req.type === 'text') return 1
  return req.items.reduce((n, x) => n + requisiteSize(x), 0)
}
