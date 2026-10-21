import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, evaluate, generateSchedules, type GeneratorCourse, type Preferences } from './generator'
import type { Day, Section } from './types'

function sec(name: string, days: Day[], start: number | null, end: number | null, mini: number | null = null, parent: string | null = null): Section {
  return {
    name,
    kind: 'section',
    parent,
    mini,
    mode: 'IPE',
    instructors: [],
    meetings: [{ days, start, end, building: null, room: null }],
  }
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes
const prefs = (p: Partial<Preferences> = {}): Preferences => ({ ...DEFAULT_PREFERENCES, ...p })

/** A course whose candidates are standalone sections. */
const flat = (courseId: string, sections: Section[], preferred: string | null = null): GeneratorCourse => ({
  courseId,
  options: sections.map((section) => ({ section, child: null })),
  preferred: preferred ? { section: preferred, child: null } : null,
})

/** A lecture course: every (lecture, recitation) pair. */
const lectured = (courseId: string, lectures: { lecture: Section; recitations: Section[] }[]): GeneratorCourse => ({
  courseId,
  options: lectures.flatMap(({ lecture, recitations }) => recitations.map((child) => ({ section: lecture, child }))),
})

const pick = (r: { sections: Record<string, { section: string; child: string | null }> }, id: string) => {
  const c = r.sections[id]
  return c.child ? `${c.section}/${c.child}` : c.section
}

describe('generateSchedules', () => {
  it('enumerates only conflict-free combinations', () => {
    const a = flat('A', [sec('1', [0, 2], h(9), h(10)), sec('2', [0, 2], h(11), h(12))])
    const b = flat('B', [sec('1', [0], h(9, 30), h(10, 30)), sec('2', [1], h(9), h(10))])
    const { results, truncated, found } = generateSchedules([a, b], prefs())
    expect(truncated).toBe(false)
    expect(found).toBe(3)
    const combos = results.map((r) => `${pick(r, 'A')}${pick(r, 'B')}`).sort()
    // A1+B1 overlap on Monday; the other three combinations fit.
    expect(combos).toEqual(['12', '21', '22'])
  })

  it('treats mini 3 and mini 4 sections at the same time as compatible', () => {
    const a = flat('A', [sec('A3', [1, 3], h(14), h(15, 20), 3)])
    const b = flat('B', [sec('A4', [1, 3], h(14), h(15, 20), 4)])
    const c = flat('C', [sec('A', [1], h(15), h(16))])
    expect(generateSchedules([a, b], prefs()).results).toHaveLength(1)
    expect(generateSchedules([a, c], prefs()).results).toHaveLength(0)
  })

  it('never conflicts on unscheduled sections and collapses identical times', () => {
    const tba = flat('T', [sec('A', [], null, null), sec('B', [], null, null)])
    const a = flat('A', [sec('1', [0], h(9), h(10)), sec('2', [0], h(9), h(10)), sec('3', [1], h(9), h(10))], '2')
    const { results } = generateSchedules([tba, a], prefs())
    expect(results).toHaveLength(2)
    const monday = results.find((r) => r.sections.A.section !== '3')!
    expect(monday.sections.A).toEqual({ section: '2', child: null })
    expect(monday.alternatives.A).toEqual([{ section: '1', child: null }])
    expect(monday.alternatives.T).toEqual([{ section: 'B', child: null }])
  })

  it('respects locked courses (single candidate)', () => {
    const a = flat('A', [sec('2', [0], h(11), h(12))])
    const b = flat('B', [sec('1', [0], h(11), h(12)), sec('2', [0], h(13), h(14))])
    const { results } = generateSchedules([a, b], prefs())
    expect(results.map((r) => `${pick(r, 'A')}${pick(r, 'B')}`)).toEqual(['22'])
  })

  it('keeps the best results and reports when the search budget runs out', () => {
    const many = (id: string) => flat(id, Array.from({ length: 10 }, (_, i) => sec(String(i), [(i % 5) as Day], h(8 + i), h(8 + i, 50))))
    const capped = generateSchedules([many('A'), many('B'), many('C')], prefs(), { maxResults: 50 })
    expect(capped.results).toHaveLength(50)
    expect(capped.truncated).toBe(false)
    expect(capped.found).toBeGreaterThan(50)

    const budget = generateSchedules([many('A'), many('B'), many('C')], prefs(), { maxResults: 50, maxVisited: 100 })
    expect(budget.truncated).toBe(true)
    expect(budget.found).toBe(100)
    // Results stay sorted best first.
    const penalties = budget.results.map((r) => r.penalty)
    expect([...penalties].sort((x, y) => x - y)).toEqual(penalties)
  })

  it('reports pairs that always conflict when nothing fits', () => {
    const a = flat('A', [sec('1', [0], h(9), h(10))])
    const b = flat('B', [sec('1', [0], h(9), h(10)), sec('2', [0], h(9, 30), h(10, 30))])
    const c = flat('C', [sec('1', [4], h(9), h(10))])
    const out = generateSchedules([a, b, c, { courseId: 'D', options: [] }], prefs())
    expect(out.results).toHaveLength(0)
    expect(out.blockingPairs).toEqual([['A', 'B']])
    expect(out.skipped).toEqual(['D'])
  })

  it('ranks by preferences', () => {
    const a = flat('A', [sec('early', [0, 2, 4], h(8), h(8, 50)), sec('late', [0, 2, 4], h(13), h(13, 50))])
    const noEarly = generateSchedules([a], prefs({ earliestStart: h(9) })).results
    expect(pick(noEarly[0], 'A')).toBe('late')
    expect(noEarly[1].breakdown.earlyClasses).toBe(3)

    const b = flat('B', [sec('MWF', [0, 2, 4], h(10), h(10, 50)), sec('TR', [1, 3], h(10), h(11, 20))])
    const noFriday = generateSchedules([b], prefs({ daysOff: [4] })).results
    expect(pick(noFriday[0], 'B')).toBe('TR')
    expect(noFriday[1].breakdown.daysOffUsed).toEqual([4])
  })
})

describe('generateSchedules with recitations', () => {
  const lec1 = sec('1', [1, 3], h(9, 30), h(10, 50))
  const lec2 = sec('2', [1, 3], h(11), h(12, 20))
  const recs = (parent: string) => [
    sec('A', [4], h(9), h(9, 50), null, parent),
    sec('B', [4], h(10), h(10, 50), null, parent),
    // Same time as A: should collapse into A's group.
    sec('C', [4], h(9), h(9, 50), null, parent),
  ]
  const course = lectured('15122', [
    { lecture: lec1, recitations: recs('1') },
    { lecture: lec2, recitations: recs('2') },
  ])

  it('chooses a lecture and one of its recitations together', () => {
    const { results, found } = generateSchedules([course], prefs())
    // 2 lectures × 2 distinct recitation times.
    expect(found).toBe(4)
    for (const r of results) {
      expect(['1', '2']).toContain(r.sections['15122'].section)
      expect(['A', 'B', 'C']).toContain(r.sections['15122'].child)
    }
  })

  it('collapses recitations that meet at the same time and lists them as alternatives', () => {
    const { results } = generateSchedules([course], prefs())
    const a = results.find((r) => r.sections['15122'].section === '1' && r.sections['15122'].child !== 'B')!
    expect(a.sections['15122'].child).toBe('A')
    expect(a.alternatives['15122']).toEqual([{ section: '1', child: 'C' }])
  })

  it('rejects combinations where only the recitation conflicts', () => {
    // Busy Friday 9–10: only recitation B (10:00) is possible.
    const fri = flat('X', [sec('A', [4], h(9), h(9, 50))])
    const { results } = generateSchedules([course, fri], prefs())
    expect(results.map((r) => r.sections['15122'].child).sort()).toEqual(['B', 'B'])
  })

  it('locks a course to its current lecture and recitation', () => {
    const locked: GeneratorCourse = { courseId: '15122', options: [{ section: lec2, child: recs('2')[1] }] }
    const { results } = generateSchedules([locked], prefs())
    expect(results.map((r) => r.sections['15122'])).toEqual([{ section: '2', child: 'B' }])
  })

  it('prefers the current choice as a group representative', () => {
    const preferred: GeneratorCourse = { ...course, preferred: { section: '1', child: 'C' } }
    const { results } = generateSchedules([preferred], prefs())
    const group = results.find((r) => r.sections['15122'].section === '1' && r.sections['15122'].child !== 'B')!
    expect(group.sections['15122']).toEqual({ section: '1', child: 'C' })
  })

  it('handles many courses with many recitations quickly', () => {
    const big = (id: string, offset: number): GeneratorCourse =>
      lectured(
        id,
        [0, 1].map((l) => ({
          lecture: sec(String(l + 1), l ? [1, 3] : [0, 2], h(8 + offset + l), h(8 + offset + l, 50)),
          recitations: Array.from({ length: 12 }, (_, r) => sec(String.fromCharCode(65 + r), [(r % 5) as Day], h(8 + r), h(8 + r, 50), null, String(l + 1))),
        })),
      )
    const started = performance.now()
    const out = generateSchedules([big('A', 0), big('B', 2), big('C', 4), big('D', 6), big('E', 8), big('F', 1)], prefs())
    expect(performance.now() - started).toBeLessThan(3000)
    expect(out.results.length).toBeGreaterThan(0)
  })
})

describe('evaluate', () => {
  it('measures gaps beyond passing time', () => {
    const { breakdown } = evaluate([sec('a', [0], h(9), h(9, 50)), sec('b', [0], h(10), h(10, 50)), sec('c', [0], h(13), h(13, 50))], prefs())
    // 9:50→10:00 is passing time; 10:50→1:00 is 130 minutes, 120 beyond passing.
    expect(breakdown.gapMinutes).toBe(120)
    expect(breakdown.daysOnCampus).toBe(1)
  })

  it('checks for a free lunch stretch', () => {
    const lunch = { start: h(11, 30), end: h(13, 30), minutes: 45 }
    const blocked = evaluate([sec('a', [0], h(11), h(12, 20)), sec('b', [0], h(12, 30), h(13, 50))], prefs({ lunch }))
    expect(blocked.breakdown.lunchBlockedDays).toBe(1)
    const free = evaluate([sec('a', [0], h(11), h(12, 20))], prefs({ lunch }))
    expect(free.breakdown.lunchBlockedDays).toBe(0)
  })

  it('scores each half of the semester separately with minis', () => {
    const full = sec('full', [0], h(9), h(9, 50))
    const m3 = sec('m3', [0], h(13), h(13, 50), 3)
    const m4 = sec('m4', [2], h(13), h(13, 50), 4)
    const { breakdown } = evaluate([full, m3, m4], prefs(), [3, 4])
    // Mini 3 half: Monday 9:00 and 1:00 (gap 180 − 10). Mini 4 half: Monday and Wednesday.
    expect(breakdown.gapMinutes).toBe(180)
    expect(breakdown.daysOnCampus).toBe(2)
  })
})
