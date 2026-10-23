import { describe, expect, it } from 'vitest'
import type { Plan } from './plan'
import type { RecordEntry } from '../state/record'
import type { Schedule } from '../state/store'
import {
  mergePlanDoc,
  mergeRecordDoc,
  mergeSchedulesDoc,
  normalizePlanDoc,
  normalizeRecordDoc,
  normalizeSchedulesDoc,
  stableStringify,
  type PlanDoc,
  type RecordDoc,
  type SchedulesDoc,
} from './sync-merge'

const sched = (id: string, termId: string, updatedAt: number, courses: string[] = []): Schedule => ({
  id,
  termId,
  name: id,
  entries: courses.map((courseId, i) => ({ courseId, section: null, child: null, color: i, hidden: false, passFail: false })),
  createdAt: 1,
  updatedAt,
})
const schedDoc = (schedules: Schedule[], activeSchedule: Record<string, string> = {}, bookmarks: Record<string, string[]> = {}): SchedulesDoc => ({
  schedules: Object.fromEntries(schedules.map((s) => [s.id, s])),
  activeSchedule,
  bookmarks,
})

describe('mergeSchedulesDoc', () => {
  it('keeps schedules that exist on only one side', () => {
    const merged = mergeSchedulesDoc(schedDoc([sched('a', 'S27', 1)]), schedDoc([sched('b', 'S27', 1)]))
    expect(Object.keys(merged.schedules).sort()).toEqual(['a', 'b'])
  })
  it('takes the newer copy of a schedule edited on both devices, local on ties', () => {
    const local = schedDoc([sched('a', 'S27', 10, ['15122'])])
    const newer = schedDoc([sched('a', 'S27', 20, ['15150'])])
    expect(mergeSchedulesDoc(local, newer).schedules.a.entries[0].courseId).toBe('15150')
    expect(mergeSchedulesDoc(newer, local).schedules.a.entries[0].courseId).toBe('15150')
    const tie = schedDoc([sched('a', 'S27', 10, ['21127'])])
    expect(mergeSchedulesDoc(local, tie).schedules.a.entries[0].courseId).toBe('15122')
  })
  it('prefers this device’s active schedule when it still exists, else the server’s', () => {
    const local = schedDoc([sched('a', 'S27', 1)], { S27: 'a', F26: 'gone' })
    const remote = schedDoc([sched('b', 'S27', 1), sched('c', 'F26', 1)], { S27: 'b', F26: 'c' })
    expect(mergeSchedulesDoc(local, remote).activeSchedule).toEqual({ S27: 'a', F26: 'c' })
  })
  it('never points a term at a schedule from another term', () => {
    const local = schedDoc([sched('a', 'F26', 1)], { S27: 'a' })
    expect(mergeSchedulesDoc(local, schedDoc([])).activeSchedule).toEqual({})
  })
  it('unions bookmarks per term, local order first', () => {
    const merged = mergeSchedulesDoc(schedDoc([], {}, { S27: ['15122', '21127'] }), schedDoc([], {}, { S27: ['15150', '15122'], F26: ['76101'] }))
    expect(merged.bookmarks).toEqual({ S27: ['15122', '21127', '15150'], F26: ['76101'] })
  })
  it('never loses local data to an empty server copy', () => {
    const local = schedDoc([sched('a', 'S27', 1, ['15122'])], { S27: 'a' }, { S27: ['15122'] })
    expect(stableStringify(mergeSchedulesDoc(local, schedDoc([])))).toBe(stableStringify(local))
  })
})

const entry = (id: string, courseId: string | null, extra: Partial<RecordEntry> = {}): RecordEntry => ({ id, courseId, source: 'taken', addedAt: 1, ...extra })
const recDoc = (entries: RecordEntry[], extra: Partial<RecordDoc> = {}): RecordDoc => ({ entries, overrides: {}, profile: {}, ...extra })

describe('mergeRecordDoc', () => {
  it('unions entries by id, keeping this device’s version of a shared id', () => {
    const merged = mergeRecordDoc(recDoc([entry('a', '15122', { grade: 'A' })]), recDoc([entry('a', '15122', { grade: 'B' }), entry('b', '21127')]))
    expect(merged.entries.map((e) => [e.id, e.grade])).toEqual([
      ['a', 'A'],
      ['b', undefined],
    ])
  })
  it('collapses the same credit added on two devices to the earliest', () => {
    const merged = mergeRecordDoc(
      recDoc([entry('x', '21122', { source: 'transfer', units: 10, addedAt: 5 })]),
      recDoc([entry('y', '21122', { source: 'transfer', units: 10, addedAt: 2 })]),
    )
    expect(merged.entries.map((e) => e.id)).toEqual(['y'])
  })
  it('keeps entries that differ in any detail', () => {
    const merged = mergeRecordDoc(recDoc([entry('x', '15122', { term: 'F25', grade: 'A' })]), recDoc([entry('y', '15122', { term: 'F25', grade: 'B' })]))
    expect(merged.entries).toHaveLength(2)
  })
  it('keeps general transfer credit with no course id', () => {
    const merged = mergeRecordDoc(recDoc([]), recDoc([entry('g', null, { source: 'transfer', units: 9 })]))
    expect(merged.entries[0].courseId).toBeNull()
  })
  it('takes the newer override, or unions flags without timestamps', () => {
    const local = recDoc([], { overrides: { '15213': { prereqs: true, updatedAt: 10 }, '15251': { prereqs: true, updatedAt: 0 } } })
    const remote = recDoc([], { overrides: { '15213': { coreqs: true, updatedAt: 20 }, '15251': { coreqs: true, updatedAt: 0 }, '15150': { antireqs: true, updatedAt: 1 } } })
    const merged = mergeRecordDoc(local, remote).overrides
    expect(merged['15213']).toEqual({ coreqs: true, updatedAt: 20 })
    expect(merged['15251']).toEqual({ prereqs: true, coreqs: true, updatedAt: 0 })
    expect(merged['15150']).toEqual({ antireqs: true, updatedAt: 1 })
  })
  it('prefers non-empty local profile fields, filling blanks from the server', () => {
    const merged = mergeRecordDoc(
      recDoc([], { profile: { college: 'SCS', majors: [], entryTerm: '' } }),
      recDoc([], { profile: { college: 'MCS', majors: ['BS CS'], entryTerm: 'F25', expectedGraduation: 'S29' } }),
    )
    expect(merged.profile).toEqual({ college: 'SCS', majors: ['BS CS'], entryTerm: 'F25', expectedGraduation: 'S29' })
  })
})

const plan = (id: string, updatedAt: number, name = id): Plan => ({ id, name, programs: [], startTerm: 'F25', terms: [{ term: 'F25', courses: [] }], createdAt: 1, updatedAt })
const planDoc = (plans: Plan[], activePlanId: string | null = null): PlanDoc => ({ plans: Object.fromEntries(plans.map((p) => [p.id, p])), activePlanId })

describe('mergePlanDoc', () => {
  it('unions plans, newer copy wins', () => {
    const merged = mergePlanDoc(planDoc([plan('a', 5, 'Mine'), plan('b', 1)]), planDoc([plan('a', 9, 'Theirs'), plan('c', 1)]))
    expect(Object.keys(merged.plans).sort()).toEqual(['a', 'b', 'c'])
    expect(merged.plans.a.name).toBe('Theirs')
  })
  it('keeps the local active plan when valid, else the server’s, else none', () => {
    expect(mergePlanDoc(planDoc([plan('a', 1)], 'a'), planDoc([plan('b', 1)], 'b')).activePlanId).toBe('a')
    expect(mergePlanDoc(planDoc([], 'gone'), planDoc([plan('b', 1)], 'b')).activePlanId).toBe('b')
    expect(mergePlanDoc(planDoc([], 'gone'), planDoc([], 'also-gone')).activePlanId).toBeNull()
  })
})

describe('normalizing server data', () => {
  it("keeps a plan's semester links", () => {
    const doc = normalizePlanDoc({
      plans: {
        p: {
          name: 'Main',
          startTerm: 'F26',
          programs: [],
          terms: [
            { term: 'F26', courses: [{ id: 'c1', courseId: '15122' }], link: { scheduleId: 's1' } },
            { term: 'S27', courses: [{ id: 'c2', courseId: '15150' }], link: { scheduleId: 7 } },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      },
      activePlanId: 'p',
    })
    expect(doc?.plans.p.terms).toEqual([
      { term: 'F26', courses: [{ id: 'c1', courseId: '15122' }], link: { scheduleId: 's1' } },
      { term: 'S27', courses: [{ id: 'c2', courseId: '15150' }] },
    ])
  })
  it('rejects non-objects', () => {
    expect(normalizeSchedulesDoc(null)).toBeNull()
    expect(normalizeRecordDoc([])).toBeNull()
    expect(normalizePlanDoc('x')).toBeNull()
  })
  it('drops malformed items and fills fields older app versions lacked', () => {
    const doc = normalizeSchedulesDoc({
      schedules: {
        ok: { termId: 'S27', name: 'Old', entries: [{ courseId: '15122', section: '1', color: 2, hidden: false }, { nope: true }], createdAt: 1, updatedAt: 2 },
        bad: { name: 'no term' },
      },
      activeSchedule: { S27: 'ok', F26: 5 },
      bookmarks: { S27: ['15122', 7] },
    })!
    expect(Object.keys(doc.schedules)).toEqual(['ok'])
    expect(doc.schedules.ok.entries).toEqual([{ courseId: '15122', section: '1', child: null, color: 2, hidden: false, passFail: false }])
    expect(doc.activeSchedule).toEqual({ S27: 'ok' })
    expect(doc.bookmarks).toEqual({ S27: ['15122'] })
  })
  it('validates record entries and plans', () => {
    const rec = normalizeRecordDoc({ entries: [{ id: 'a', courseId: '15122', source: 'taken', addedAt: 1 }, { id: 'b', courseId: 5, source: 'taken' }, { id: 'c', courseId: null, source: 'hacked' }] })!
    expect(rec.entries.map((e) => e.id)).toEqual(['a'])
    const plans = normalizePlanDoc({ plans: { p: { startTerm: 'F25', terms: [{ term: 'F25', courses: [{ id: 'x', courseId: '15122' }, { id: 'y' }] }], programs: [{ catalogId: 92, auditId: 19488 }, { catalogId: 'x' }] } } })!
    expect(plans.plans.p.terms[0].courses).toEqual([{ id: 'x', courseId: '15122' }])
    expect(plans.plans.p.programs).toEqual([{ catalogId: 92, auditId: 19488 }])
  })
})

describe('stableStringify', () => {
  it('ignores key order and undefined fields', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(stableStringify({ a: { d: 2 }, b: 1 }))
  })
})

describe('untrusted server data', () => {
  it('drops prototype-polluting keys', async () => {
    const { normalizeSchedulesDoc, normalizePlanDoc } = await import('./sync-merge')
    const doc = JSON.parse('{"schedules":{"__proto__":{"id":"x"},"constructor":{"id":"y"}},"activeSchedule":{"__proto__":"x","S27":"a"},"bookmarks":{"prototype":["1"]}}')
    const out = normalizeSchedulesDoc(doc)!
    expect(Object.keys(out.schedules)).toEqual([])
    expect(out.activeSchedule).toEqual({ S27: 'a' })
    expect(Object.getPrototypeOf(out.activeSchedule)).toBe(Object.prototype)
    expect(out.bookmarks).toEqual({})
    const plans = normalizePlanDoc(JSON.parse('{"plans":{"__proto__":{"id":"p"}},"activePlanId":null}'))!
    expect(Object.keys(plans.plans)).toEqual([])
    expect(({} as Record<string, unknown>).id).toBeUndefined()
  })
})
