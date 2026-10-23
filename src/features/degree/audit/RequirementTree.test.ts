/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { relatedAuditIds, runAudit } from '../../../lib/audit'
import type { CatalogIndex } from '../../../lib/catalog-types'
import type { ProgramVersion, ReqNode } from '../../../lib/degree-types'
import type { PlannedCourse } from '../../../lib/plan-types'
import { termLabel } from '../../../lib/requisites'
import { RequirementList, type TreeContext } from './RequirementTree'

const dir = join(process.cwd(), 'public', 'data')
const ready = existsSync(join(dir, 'programs', '19488.json')) && existsSync(join(dir, 'catalog', 'index.json'))

describe.skipIf(!ready)('RequirementList', () => {
  it('renders a real audit with progress, assignments and suggestions', () => {
    const load = (id: number): ProgramVersion => JSON.parse(readFileSync(join(dir, 'programs', `${id}.json`), 'utf8'))
    const catalog: CatalogIndex = JSON.parse(readFileSync(join(dir, 'catalog', 'index.json'), 'utf8'))
    const courses: PlannedCourse[] = ['15122', '15150', '21127', '76101', '15251'].map((id, i) => ({
      courseId: id,
      term: i < 3 ? 'F25' : 'S26',
      status: i < 3 ? 'completed' : 'planned',
      units: catalog.courses[id]?.units ?? 9,
      passFail: false,
    }))
    const input = { programs: [{ catalogId: 92, auditId: 19488 }], courses }
    const versions = new Map<number, ProgramVersion>([[19488, load(19488)]])
    for (const id of relatedAuditIds(input, versions)) versions.set(id, load(id))
    const result = runAudit(input, versions, catalog)

    const nodes = new Map<number, ReqNode>()
    const walk = (n: ReqNode) => {
      nodes.set(n.id, n)
      n.children.forEach(walk)
    }
    walk(versions.get(19488)!.root)
    const ctx: TreeContext = {
      termId: 'S27',
      termName: 'Spring 2027',
      offered: (id) => id.startsWith('15'),
      title: (id) => catalog.courses[id]?.title,
      units: (id) => catalog.courses[id]?.units ?? null,
      node: (id) => nodes.get(id) ?? null,
      catalog,
      inPlan: new Set(courses.map((c) => c.courseId)),
      onAddCourse: () => {},
      termLabel,
      href: (id) => `/S27/courses/${id}`,
    }
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RequirementList, { results: result.programs[0].root.children, ctx, depth: 0 })))
    expect(html).toContain('Computer Science')
    expect(html).toContain('15-122')
    expect(html).toContain('Fall 2025')
    expect(html).toContain('Ways to satisfy')
    expect(html).toContain('Add 15-210 to your plan')
  })
})
