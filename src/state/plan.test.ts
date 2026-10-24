import { beforeEach, describe, expect, it } from 'vitest'
import { addToTerm, linkTermToSchedule, moveInPlan, placeInTerm, removeFromPlan, setPlanPassFail, setPlanUnits, unlinkTerm } from '../features/degree/linkActions'
import { effectiveTermCourses, linkedCourseId } from '../lib/plan'
import { migratePlans, usePlans } from './plan'
import { useStore, type Schedule } from './store'

const entry = (courseId: string, extra: Partial<Schedule['entries'][number]> = {}) => ({ courseId, section: '1', child: null, color: 0, hidden: false, passFail: false, ...extra })

function setup() {
  usePlans.setState({ plans: {}, activePlanId: null })
  const schedule: Schedule = { id: 'sch1', termId: 'S27', name: 'Schedule 1', entries: [entry('15213'), entry('99101')], createdAt: 1, updatedAt: 1 }
  useStore.setState({ schedules: { sch1: schedule }, activeSchedule: { S27: 'sch1' } })
  const planId = usePlans.getState().createPlan({ startTerm: 'F26', terms: ['F26', 'S27'] })
  usePlans.getState().addCourse(planId, 'S27', '76101')
  usePlans.getState().addCourse(planId, 'S27', '15213', { units: 9 })
  return planId
}

const plan = (id: string) => usePlans.getState().plans[id]
const scheduleIds = () => useStore.getState().schedules.sch1.entries.map((e) => e.courseId)
const effective = (id: string, term: string) =>
  effectiveTermCourses(plan(id), useStore.getState().schedules)
    .get(term)!
    .courses.map((c) => c.courseId)

describe('syncing a plan semester with a schedule', () => {
  beforeEach(() => {
    useStore.setState({ schedules: {}, activeSchedule: {} })
  })

  it('merges planned courses into the schedule and snapshots the result', () => {
    const id = setup()
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'merge')
    const term = plan(id).terms.find((t) => t.term === 'S27')!
    expect(term.link).toEqual({ scheduleId: 'sch1' })
    expect(scheduleIds()).toEqual(['15213', '99101', '76101'])
    expect(term.courses.map((c) => c.courseId)).toEqual(['15213', '99101', '76101'])
    // The unit override for 15-213 survives into the snapshot and the effective courses.
    expect(term.courses.find((c) => c.courseId === '15213')?.units).toBe(9)
    expect(effectiveTermCourses(plan(id), useStore.getState().schedules).get('S27')!.courses[0].units).toBe(9)
  })

  it('uses the schedule as is when asked, dropping the other planned courses', () => {
    const id = setup()
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'as-is')
    expect(scheduleIds()).toEqual(['15213', '99101'])
    expect(effective(id, 'S27')).toEqual(['15213', '99101'])
  })

  it('routes adds, removes, moves and pass/fail to the synced schedule', () => {
    const id = setup()
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'as-is')

    expect(addToTerm(plan(id), 'S27', '15251')).toBe(linkedCourseId('sch1', '15251'))
    expect(scheduleIds()).toContain('15251')

    removeFromPlan(plan(id), linkedCourseId('sch1', '99101'))
    expect(scheduleIds()).not.toContain('99101')
    expect(plan(id).terms.find((t) => t.term === 'S27')!.courses.map((c) => c.courseId)).not.toContain('99101')

    // Out of the synced semester into a plain one, and back.
    moveInPlan(plan(id), linkedCourseId('sch1', '15251'), 'F26')
    expect(scheduleIds()).not.toContain('15251')
    expect(effective(id, 'F26')).toEqual(['15251'])
    const f26Id = plan(id).terms.find((t) => t.term === 'F26')!.courses[0].id
    moveInPlan(plan(id), f26Id, 'S27')
    expect(effective(id, 'F26')).toEqual([])
    expect(scheduleIds()).toContain('15251')

    setPlanPassFail(plan(id), linkedCourseId('sch1', '15213'), true)
    expect(useStore.getState().schedules.sch1.entries.find((e) => e.courseId === '15213')?.passFail).toBe(true)

    setPlanUnits(plan(id), linkedCourseId('sch1', '15251'), 6)
    expect(effectiveTermCourses(plan(id), useStore.getState().schedules).get('S27')!.courses.find((c) => c.courseId === '15251')?.units).toBe(6)
  })

  it('keeps the schedule courses as planned courses when syncing stops', () => {
    const id = setup()
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'as-is')
    useStore.getState().addCourse('sch1', '21127')
    unlinkTerm(plan(id), 'S27')
    const term = plan(id).terms.find((t) => t.term === 'S27')!
    expect(term.link).toBeNull()
    expect(term.courses.map((c) => c.courseId)).toEqual(['15213', '99101', '21127'])
  })

  it('falls back to the snapshot when the schedule is deleted', () => {
    const id = setup()
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'merge')
    useStore.getState().deleteSchedule('sch1')
    const eff = effectiveTermCourses(plan(id), useStore.getState().schedules).get('S27')!
    expect(eff.missing).toBe(true)
    expect(eff.courses.map((c) => c.courseId)).toEqual(['15213', '99101', '76101'])
    // Edits then go to the plan itself.
    addToTerm(plan(id), 'S27', '15251')
    expect(effective(id, 'S27')).toContain('15251')
  })
})

describe('plan store migration', () => {
  it('gives v1 semesters an empty link', () => {
    const v1 = { plans: { p: { id: 'p', name: 'Plan', programs: [], startTerm: 'F25', terms: [{ term: 'F25', courses: [] }], createdAt: 0, updatedAt: 0 } }, activePlanId: 'p' }
    const migrated = migratePlans(v1, 1)
    expect(migrated.plans.p.terms[0]).toEqual({ term: 'F25', courses: [], link: null })
    expect(migrated.activePlanId).toBe('p')
  })
})

describe('reordering courses in a semester', () => {
  const ids = (id: string, term: string) => plan(id).terms.find((t) => t.term === term)!.courses.map((c) => c.courseId)
  const courseId = (id: string, term: string, code: string) => plan(id).terms.find((t) => t.term === term)!.courses.find((c) => c.courseId === code)!.id

  it('moves a course before another or to the end of its own semester', () => {
    const id = setup()
    usePlans.getState().addCourse(id, 'S27', '21241')
    expect(ids(id, 'S27')).toEqual(['76101', '15213', '21241'])
    moveInPlan(plan(id), courseId(id, 'S27', '21241'), 'S27', courseId(id, 'S27', '76101'))
    expect(ids(id, 'S27')).toEqual(['21241', '76101', '15213'])
    moveInPlan(plan(id), courseId(id, 'S27', '21241'), 'S27', null)
    expect(ids(id, 'S27')).toEqual(['76101', '15213', '21241'])
    // Without a position, "moving" to its own semester does nothing.
    moveInPlan(plan(id), courseId(id, 'S27', '21241'), 'S27')
    expect(ids(id, 'S27')).toEqual(['76101', '15213', '21241'])
  })

  it('places a course moved from another semester where it was dropped', () => {
    const id = setup()
    usePlans.getState().addCourse(id, 'F26', '15122')
    moveInPlan(plan(id), courseId(id, 'F26', '15122'), 'S27', courseId(id, 'S27', '15213'))
    expect(ids(id, 'S27')).toEqual(['76101', '15122', '15213'])
    expect(ids(id, 'F26')).toEqual([])
  })

  it("reorders a synced semester's schedule, leaving hidden entries in order", () => {
    const id = setup()
    useStore.setState((st) => ({ schedules: { sch1: { ...st.schedules.sch1, entries: [entry('15213'), entry('99999', { hidden: true }), entry('99101')] } } }))
    linkTermToSchedule(plan(id), 'S27', useStore.getState().schedules.sch1, 'as-is')
    placeInTerm(plan(id), linkedCourseId('sch1', '99101'), 'S27', linkedCourseId('sch1', '15213'))
    expect(scheduleIds()).toEqual(['99101', '15213', '99999'])
    expect(effective(id, 'S27')).toEqual(['99101', '15213'])
  })
})

describe('createPlan', () => {
  it('takes semesters with their courses, as an import gives them', () => {
    usePlans.setState({ plans: {}, activePlanId: null })
    const id = usePlans.getState().createPlan({
      name: 'Stellic plan',
      startTerm: 'F26',
      terms: [{ term: 'S27', courses: [{ courseId: '15213' }, { courseId: '10999', units: 12 }] }, 'F26'],
    })
    const p = plan(id)
    expect(usePlans.getState().activePlanId).toBe(id)
    expect(p.name).toBe('Stellic plan')
    expect(p.terms.map((t) => [t.term, t.courses.map((c) => [c.courseId, c.units])])).toEqual([
      ['F26', []],
      ['S27', [['15213', undefined], ['10999', 12]]],
    ])
    expect(new Set(p.terms[1].courses.map((c) => c.id)).size).toBe(2)
  })
})
