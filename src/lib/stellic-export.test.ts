import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { Plan } from './plan'
import { buildStellicScript, exportPlan, exportSchedule, sioText, stellicTerm, type ExportTerm, type ScheduleForExport } from './stellic-export'

const titles: Record<string, string> = { '15122': 'Principles of Imperative Computation', '21127': 'Concepts of Mathematics', '76101': 'Interpretation and Argument' }
const titleOf = (id: string) => titles[id] ?? id

const schedule: ScheduleForExport = {
  id: 's1',
  termId: 'S27',
  name: 'Schedule 1',
  entries: [
    { courseId: '15122', section: '1', child: 'A', hidden: false, passFail: false },
    { courseId: '21127', section: '2', child: null, hidden: false, passFail: false },
    { courseId: '76101', section: null, child: null, hidden: true, passFail: false },
  ],
}

describe('export building', () => {
  it('maps terms to Stellic semesters', () => {
    expect(stellicTerm('S27')).toEqual({ semId: 2, year: 2027, name: 'Spring 2027' })
    expect(stellicTerm('F26')).toMatchObject({ semId: 1, year: 2026 })
    expect(stellicTerm('M26')).toMatchObject({ semId: 3, year: 2026 })
  })

  it('exports a schedule with its chosen sections, leaving hidden courses out', () => {
    expect(exportSchedule(schedule, titleOf)).toEqual({
      term: 'S27',
      name: 'Spring 2027',
      semId: 2,
      year: 2027,
      source: 'Schedule 1',
      courses: [
        { code: '15-122', title: 'Principles of Imperative Computation', sections: ['1', 'A'] },
        { code: '21-127', title: 'Concepts of Mathematics', sections: ['2'] },
      ],
    })
  })

  it("exports a plan's current and future terms, using a synced schedule's sections", () => {
    const plan: Plan = {
      id: 'p',
      name: 'Main plan',
      programs: [],
      startTerm: 'F25',
      createdAt: 0,
      updatedAt: 0,
      terms: [
        { term: 'F25', courses: [{ id: 'a', courseId: '76101' }] },
        { term: 'S27', courses: [], link: { scheduleId: 's1' } },
        { term: 'F27', courses: [{ id: 'b', courseId: '21127' }, { id: 'c', courseId: 'credit:transfer' }] },
      ],
    }
    const out = exportPlan(plan, { s1: schedule }, 'F26', titleOf)
    expect(out.map((t) => [t.term, t.source, t.courses.map((c) => `${c.code}${c.sections.length ? ` ${c.sections.join('/')}` : ''}`)])).toEqual([
      ['S27', 'Main plan', ['15-122 1/A', '21-127 2']],
      ['F27', 'Main plan', ['21-127']],
    ])
  })

  it('lists course numbers and the section to register for, for SIO', () => {
    expect(sioText([exportSchedule(schedule, titleOf)!])).toBe(
      'Spring 2027 (Schedule 1)\nCourse\tSection\tTitle\n15122\tA\tPrinciples of Imperative Computation\n21127\t2\tConcepts of Mathematics',
    )
  })
})

/** Runs the generated script against a fake Stellic and records what it sent. */
async function runScript(terms: ExportTerm[], opts: { confirm?: boolean[]; origin?: string; addCourse?: (body: URLSearchParams, n: number) => object } = {}) {
  const calls: { method: string; url: string; body: URLSearchParams | null }[] = []
  const alerts: string[] = []
  const confirms = [...(opts.confirm ?? [true, true])]
  let adds = 0
  const json = (value: object, status = 200) => ({ ok: status < 400, status, type: 'basic', text: async () => `)]}',\n${JSON.stringify(value)}` })
  const fetch = async (url: string, init: { method?: string; body?: URLSearchParams } = {}) => {
    calls.push({ method: init.method ?? 'GET', url, body: init.body ?? null })
    if (url === '/planner/getstudentprofile/') return json({ default_plan_id: 'plan-1', term_joined: { semester: 1, year: 2026 } })
    if (url === '/plans/plan-1/overview') return json({ plan: { academic_years: [{ logical_year: 1, terms: [{ semester_id: 1, physical_year: 2026, logical_year: 1 }, { semester_id: 2, physical_year: 2027, logical_year: 1 }] }] } })
    if (url === '/plans/plan-1/terms/2/1') return json({ term: { name: 'Spring 2027' }, courses: [{ id: 9, code: '21-127', name: 'Concepts of Mathematics' }] })
    if (url.startsWith('/planner/getcoursesectionsforusems/?course_code=15-122&sem_id=2&physical_year=2027'))
      return json({ data_list: [{ course: { code: '15-122' }, section_groups: [{ sections: [{ id: 101, name: '1' }, { id: 102, name: '2' }] }, { sections: [{ id: 201, name: 'A' }] }] }] })
    if (url === '/planner/add-course/') return json(opts.addCourse ? opts.addCourse(init.body!, adds++) : { success: true })
    return json({ success: false }, 404)
  }
  const result = runInNewContext(buildStellicScript(terms), {
    location: { origin: opts.origin ?? 'https://academicaudit.andrew.cmu.edu' },
    document: { cookie: 'sessionid=x; csrftoken=tok%3D' },
    fetch,
    confirm: () => confirms.shift() ?? false,
    alert: (m: string) => alerts.push(m),
    console: { table: () => {}, log: () => {}, error: () => {} },
    URLSearchParams,
    Map,
    Set,
  }) as Promise<void>
  await result
  return { calls, alerts, adds: calls.filter((c) => c.url === '/planner/add-course/') }
}

describe('generated Stellic script', () => {
  const terms = [exportSchedule(schedule, titleOf)!]

  it('compiles', () => {
    expect(() => new Function(buildStellicScript(terms))).not.toThrow()
  })

  it('adds missing courses with their section ids, skipping ones already planned', async () => {
    const { adds, alerts, calls } = await runScript(terms)
    expect(adds).toHaveLength(1)
    expect(Object.fromEntries(adds[0].body!)).toEqual({ plan_id: 'plan-1', course_code: '15-122', sem_id: '2', year: '1', campus_id: '1', section_ids: '101,201' })
    expect(calls.every((c) => c.method === 'GET' || c.url === '/planner/getstudentprofile/' || c.url === '/planner/add-course/')).toBe(true)
    expect(alerts.at(-1)).toMatch(/^Added 1 of 1 course/)
  })

  it('changes nothing when the preview is cancelled', async () => {
    const { adds } = await runScript(terms, { confirm: [false] })
    expect(adds).toHaveLength(0)
  })

  it('refuses to run outside Stellic', async () => {
    const { calls } = await runScript(terms, { origin: 'https://example.com' })
    expect(calls).toHaveLength(0)
  })

  it('asks before forcing past a Stellic warning, and retries without sections if they are rejected', async () => {
    const warn = await runScript(terms, {
      addCourse: (body) => (body.get('force') ? { success: true } : { success: false, message: { code: 494, text: 'Prerequisite not met' } }),
    })
    expect(warn.adds.map((c) => c.body!.get('force'))).toEqual([null, 'true'])
    expect(warn.alerts.at(-1)).toMatch(/^Added 1 of 1/)

    const declined = await runScript(terms, { confirm: [true, false], addCourse: () => ({ success: false, message: { code: 494, text: 'Prerequisite not met' } }) })
    expect(declined.adds).toHaveLength(1)

    const sections = await runScript(terms, { addCourse: (body) => (body.get('section_ids') ? { success: false, message: { code: 400, text: 'bad sections' } } : { success: true }) })
    expect(sections.adds.map((c) => c.body!.get('section_ids'))).toEqual(['101,201', null])
    expect(sections.alerts.at(-1)).toMatch(/^Added 1 of 1/)
  })
})
