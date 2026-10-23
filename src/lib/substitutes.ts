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
