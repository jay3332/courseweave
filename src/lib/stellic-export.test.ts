import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { Plan } from './plan'
import { buildSioScript, buildStellicScript, exportPlan, exportSchedule, sioText, stellicTerm, type ExportTerm, type ScheduleForExport } from './stellic-export'

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

/**
 * A small stand-in for SIO's Plan Course Schedule page: the "Viewing plan for" label, the add box, and per-course
 * section radios that appear after a (simulated) save, like SIO's GWT widgets.
 */
function fakeSio(opts: { viewing?: string; existing?: Record<string, string[]>; catalog: Record<string, string[]>; reject?: string[] }) {
  const saves: string[] = []
  const state = { pending: 0 }
  class XHR {
    listeners: (() => void)[] = []
    addEventListener(_: string, fn: () => void) {
      this.listeners.push(fn)
    }
    send() {}
  }
  const xhrSend = XHR.prototype.send
  const save = (label: string, after: () => void) => {
    const x = new XHR()
    XHR.prototype.send.call(x)
    saves.push(label)
    state.pending++
    setTimeout(() => {
      after()
      state.pending--
      x.listeners.forEach((fn) => fn())
    }, 30)
  }
  type Radio = { name: string; checked: boolean; offsetParent: object; section: string; closest(): { innerText: string }; click(): void }
  const radios: Radio[] = []
  let message = ''
  const makeRadios = (num: string, sections: string[]) =>
    sections.forEach((section, i) =>
      radios.push({
        name: num,
        checked: i === 0,
        offsetParent: {},
        section,
        closest: () => ({ innerText: `${section}\tInstructor\t09:00AM to 09:50AM F` }),
        click() {
          // Like SIO: selecting saves the plan; the choice only sticks once that save is done.
          save(`select ${num} ${section}`, () => radios.filter((r) => r.name === num).forEach((r) => (r.checked = r === this)))
        },
      }),
    )
  for (const [num, sections] of Object.entries(opts.existing ?? {})) makeRadios(num, sections)
  const box = { value: '', focus() {}, dispatchEvent() {} }
  const addButton = {
    textContent: 'Add',
    click() {
      const num = box.value
      save(`add ${num}`, () => {
        if (opts.reject?.includes(num) || !opts.catalog[num]) message = `Course ${num} is not offered this semester`
        else {
          makeRadios(num, opts.catalog[num])
          message = `Course: ${num.slice(0, 2)}-${num.slice(2)} added successfully!`
        }
      })
    },
  }
  const panel = {
    get innerText() {
      return `Add course to planned schedule\n${message}\nSearch for a course to add, or type the course number below and click 'Add'`
    },
    querySelector: (s: string) => (s === 'input.input-txt' ? box : null),
    querySelectorAll: (s: string) => (s === 'button' ? [addButton] : []),
  }
  const select = { offsetParent: {}, selectedIndex: 0, options: [{ text: 'My plan' }] }
  const document = {
    body: {
      get innerText() {
        return `Plan Course Schedule\n${opts.viewing ? `Viewing plan for ${opts.viewing}:\n` : ''}${panel.innerText}`
      },
    },
    querySelectorAll: (s: string) => (s === 'div' ? [panel] : s === 'select' ? [select] : s === 'input[type="radio"]' ? radios : []),
  }
  return { document, XMLHttpRequest: XHR, xhrSend, saves, radios, state }
}

async function runSio(terms: ExportTerm[], sio: ReturnType<typeof fakeSio>, opts: { confirm?: boolean; host?: string; hash?: string } = {}) {
  const alerts: string[] = []
  const confirms: string[] = []
  const window: Record<string, unknown> = {}
  await (runInNewContext(buildSioScript(terms), {
    location: { host: opts.host ?? 's3.andrew.cmu.edu', hash: opts.hash ?? '#schedule-plan' },
    document: sio.document,
    window,
    XMLHttpRequest: sio.XMLHttpRequest,
    Event: class {
      type: string
      constructor(type: string) {
        this.type = type
      }
    },
    RegExp,
    setTimeout,
    alert: (m: string) => alerts.push(m),
    confirm: (m: string) => (confirms.push(m), opts.confirm ?? true),
    console: { table: () => {}, log: () => {} },
  }) as Promise<void>)
  return { alerts, confirms }
}

describe('generated SIO script', () => {
  const fall = exportSchedule({ ...schedule, termId: 'F26' }, titleOf)!

  it('compiles', () => {
    expect(() => new Function(buildSioScript([fall]))).not.toThrow()
  })

  it("adds missing courses through SIO's box and selects their sections once each save is done", async () => {
    const sio = fakeSio({ viewing: 'Fall 2026', catalog: { '15122': ['A', 'B', 'C'], '21127': ['1', '2'] } })
    const { alerts, confirms } = await runSio([fall], sio)
    expect(confirms[0]).toMatch(/Add 2 courses to your Fall 2026 planned schedule "My plan"/)
    expect(sio.saves).toEqual(['add 15122', 'add 21127', 'select 21127 2'])
    expect(sio.radios.filter((r) => r.checked).map((r) => `${r.name} ${r.section}`)).toEqual(['15122 A', '21127 2'])
    expect(alerts.at(-1)).toBe('Added 2 of 2 courses to "My plan".')
  }, 15000)

  it('skips courses already in the plan and changes nothing when cancelled', async () => {
    const sio = fakeSio({ viewing: 'Fall 2026', existing: { '15122': ['A'] }, catalog: { '21127': ['1', '2'] } })
    const { confirms } = await runSio([fall], sio, { confirm: false })
    expect(confirms[0]).toMatch(/Add 1 course to/)
    expect(sio.saves).toEqual([])
  }, 15000)

  it('stops outside the plan page, without a plan, or on another semester', async () => {
    for (const [opts, viewing, expected] of [
      [{ hash: '#schedule-registration' }, 'Fall 2026', /Plan Course Schedule/],
      [{}, undefined, /Pick or create a planned schedule/],
      [{}, 'Spring 2027', /viewing a Spring 2027 plan, but this export is for Fall 2026/],
    ] as const) {
      const sio = fakeSio({ viewing, catalog: { '15122': ['A'] } })
      const { alerts } = await runSio([fall], sio, opts)
      expect(alerts[0]).toMatch(expected)
      expect(sio.saves).toEqual([])
    }
  }, 15000)

  it('reports courses SIO rejects', async () => {
    const sio = fakeSio({ viewing: 'Fall 2026', catalog: { '15122': ['A'] }, reject: ['21127'] })
    const { alerts } = await runSio([fall], sio)
    expect(alerts.at(-1)).toMatch(/^Added 1 of 2 courses/)
  }, 15000)
})
