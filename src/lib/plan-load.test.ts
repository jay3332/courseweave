import { describe, expect, it } from 'vitest'
import type { CatalogEntry, CatalogIndex } from './catalog-types'
import type { FceMiniInfo } from './fce-minis'
import { HEAVY_UNITS, loadWarnings, suggestTerm, termTotals, type Plan } from './plan'

const fullTime = (): FceMiniInfo | null => null

describe('termTotals with minis', () => {
  it('peaks at the busier half: full courses count in both halves, minis in theirs', () => {
    const minis: Record<string, FceMiniInfo> = { m3: { share: 1, half: 'first' }, m4: { share: 0.8, half: 'second' }, rare: { share: 0.2, half: 'first' } }
    const hours: Record<string, number> = { a: 12, b: 10, m3: 14, m4: 9, rare: 6 }
    const t = termTotals(
      ['a', 'b', 'm3', 'm4', 'rare'].map((id) => ({ courseId: id, units: id.startsWith('m') ? 6 : id === 'rare' ? 9 : 12, passFail: false })),
      (id) => hours[id],
      (id) => minis[id] ?? null,
    )
    // Official units don't change for minis.
    expect(t.units).toBe(12 + 12 + 6 + 6 + 9)
    expect(t.minis).toBe(2)
    expect(t.fceHours).toBe(51)
    expect(t.peakHalf).toBe('first')
    expect(t.peakHours).toBe(12 + 10 + 6 + 14)
    expect(t.otherHalfHours).toBe(12 + 10 + 6 + 9)
    // Units suggest: full units (33) + 2 × the half's mini units (12).
    expect(t.peakExpected).toBe(33 + 12)
  })

  it('reads the same as a plain sum without minis, and honours an explicit half', () => {
    const t = termTotals([{ courseId: 'a', units: 12, passFail: false }, { courseId: 'b', units: 9, passFail: false }], () => 10, fullTime)
    expect(t.peakHalf).toBeNull()
    expect(t.peakHours).toBe(20)
    expect(t.peakExpected).toBe(21)
    const explicit = termTotals([{ courseId: 'a', units: 6, passFail: false, half: 'second' }], () => 12, fullTime)
    expect(explicit.peakHalf).toBe('second')
    expect(explicit.peakExpected).toBe(12)
  })

  it('warns on peak-half hours against what the units suggest', () => {
    // Two 6-unit minis in the same half at 12 h/wk each are exactly what their units suggest.
    const items = [
      { courseId: 'a', units: 12, passFail: false },
      { courseId: 'b', units: 12, passFail: false },
      { courseId: 'm1', units: 6, passFail: false, half: 'first' as const },
      { courseId: 'm2', units: 6, passFail: false, half: 'first' as const },
    ]
    const even = termTotals(items, (id) => (id.startsWith('m') ? 12 : 12), fullTime)
    expect(loadWarnings(even)).toEqual([])
    const heavy = termTotals(items, (id) => (id.startsWith('m') ? 20 : 18), fullTime)
    expect(loadWarnings(heavy)).toEqual([expect.stringContaining('peak at 76/week in the first half')])
  })

  it('counts only factorable units toward the overload warning', () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => ({ courseId: `c${i}`, units: 12, passFail: false })),
      { courseId: 'pf', units: 9, passFail: true },
    ]
    const t = termTotals(items, () => null, fullTime)
    expect(t.units).toBe(57)
    expect(t.factorable).toBe(48)
    expect(loadWarnings(t)).toEqual([])
    const over = termTotals([...items, { courseId: 'x', units: 9, passFail: false }], () => null, fullTime)
    expect(loadWarnings(over)).toEqual([`Over ${HEAVY_UNITS} factorable units, which usually needs your college's approval`])
  })
})

describe('suggestTerm load check', () => {
  const entry = (id: string, units: number, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
    id,
    code: `${id.slice(0, 2)}-${id.slice(2)}`,
    title: id,
    units,
    prereqs: null,
    coreqs: [],
    antireqs: [],
    equivalents: [],
    passFail: false,
    ...extra,
  })
  const catalog: CatalogIndex = {
    generatedAt: '',
    courses: {
      '15122': entry('15122', 12),
      '15150': entry('15150', 12),
      '21127': entry('21127', 12),
      '76101': entry('76101', 9),
      '69101': entry('69101', 3, { passFail: true }),
      '15251': entry('15251', 12),
      '57100': entry('57100', 9),
    },
  }
  const unitsOf = (id: string) => catalog.courses[id]?.units
  const plan = (terms: Record<string, { courseId: string; passFail?: boolean }[]>): Plan =>
    ({
      id: 'p',
      name: 'Plan',
      programs: [],
      terms: Object.entries(terms).map(([term, courses]) => ({ term, courses: courses.map((c, i) => ({ id: `${term}-${i}`, ...c })) })),
    }) as unknown as Plan

  it('ignores pass/fail courses when checking room', () => {
    // 45 factorable + 9 elected pass/fail: a 9-unit course still fits under 54 factorable.
    const p = plan({
      F26: [{ courseId: '15122' }, { courseId: '15150' }, { courseId: '21127' }, { courseId: '76101' }, { courseId: '57100', passFail: true }],
      S27: [],
    })
    expect(suggestTerm(p, '57100', catalog, 'F26', unitsOf)).toBe('F26')
    // A pass/fail-only course never needs room.
    const full = plan({ F26: [{ courseId: '15122' }, { courseId: '15150' }, { courseId: '21127' }, { courseId: '76101' }, { courseId: '57100' }], S27: [] })
    expect(suggestTerm(full, '69101', catalog, 'F26', unitsOf)).toBe('F26')
    expect(suggestTerm(full, '15251', catalog, 'F26', unitsOf)).toBe('S27')
  })
})
