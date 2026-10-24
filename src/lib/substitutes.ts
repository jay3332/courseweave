// Courses that count for another course but not the other way around: honors and more advanced versions. The catalog
// lists most equivalents (made symmetric), but misses these one-way relationships.

/**
 * `[higher, lower]`: `higher` counts for anything `lower` does (requirements and prerequisites that name `lower`, and
 * the courses the catalog lists as equivalent to `lower`). Chains are followed: 21-269 counts for 21-256.
 */
export const SUBSTITUTES: readonly (readonly [string, string])[] = [
  ['21425', '21325'], // Probability and Martingales → Probability
  ['21242', '21241'], // Matrix Theory → Matrices and Linear Transformations
  ['21128', '21127'], // Mathematical Concepts and Proofs → Concepts of Mathematics
  ['15151', '21127'], // Mathematical Foundations for Computer Science → Concepts of Mathematics
  ['21269', '21268'], // Vector Analysis → Multidimensional Calculus
  ['21268', '21266'], // Multidimensional Calculus → Vector Calculus using Matrix Algebra
  ['21266', '21259'], // Vector Calculus using Matrix Algebra → Calculus in Three Dimensions
  ['21259', '21256'], // Calculus in Three Dimensions → Multivariate Analysis
]

/** lower → every course that counts for it through `SUBSTITUTES` (following chains). */
export function substitutesFor(pairs: readonly (readonly [string, string])[] = SUBSTITUTES): Map<string, Set<string>> {
  const direct = new Map<string, string[]>()
  for (const [higher, lower] of pairs) direct.set(lower, [...(direct.get(lower) ?? []), higher])
  const out = new Map<string, Set<string>>()
  for (const lower of direct.keys()) {
    const seen = new Set<string>()
    const stack = [...direct.get(lower)!]
    while (stack.length) {
      const id = stack.pop()!
      if (id === lower || seen.has(id)) continue
      seen.add(id)
      stack.push(...(direct.get(id) ?? []))
    }
    out.set(lower, seen)
  }
  return out
}

// Stellic's "equivalent" courses mix the same course under another number (cross-listings, undergraduate and graduate
// versions, renumberings) with courses that only overlap: 21-241 and 21-341, Calculus I and III, Intermediate French I
// and II. The catalog build keeps a pair only when the titles name the same course.

/** "(Undergrad)", "(Minor Option)", …: the same course offered to another audience. "(Honors)" is a different course. */
const AUDIENCE = /\s*\((?:undergrad(?:uate)?|ug|grad(?:uate)?|master'?s|minor option|college in high school)\)\s*$/i
const TOPICS_PREFIX = /^(?:special topics?|st)\s*:\s*/i

function titleWords(title: string): string[] {
  return title
    .replace(AUDIENCE, '')
    .replace(TOPICS_PREFIX, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w === 'intro' ? 'introduction' : w))
}

/** Equal, a plural of the other, or one letter dropped from a long word (a typo: "Formalisims"). */
function sameWord(a: string, b: string): boolean {
  if (a === b || `${a}s` === b || `${b}s` === a) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (short.length < 5 || long.length !== short.length + 1) return false
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true
  return false
}

/** Whether two course titles name the same course (so the courses are interchangeable), not just related ones. */
export function sameCourseTitle(a: string, b: string): boolean {
  const x = titleWords(a)
  const y = titleWords(b)
  return x.length > 0 && x.length === y.length && x.every((w, i) => sameWord(w, y[i]))
}
