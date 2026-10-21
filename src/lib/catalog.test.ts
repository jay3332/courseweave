import { describe, expect, it } from 'vitest'
import { buildUnlocks, prerequisiteDepth } from './catalog'
import type { CatalogEntry, CatalogIndex, Requisite } from './catalog-types'
import { formatRequisite, isRequired, parseRequisiteText, requisiteCourses, simplify } from './requisite-format'

const c = (id: string, minGrade?: string): Requisite => (minGrade ? { type: 'course', id, minGrade } : { type: 'course', id })

describe('parseRequisiteText', () => {
  it('reads SOC wording', () => {
    expect(parseRequisiteText('15112 or 02120')).toEqual({ type: 'any', items: [c('15112'), c('02120')] })
  })
  it('reads Stellic wording with minimum grades, D meaning any pass', () => {
    expect(parseRequisiteText('(15-150 [] at least C) and (15-122 [] at least D)')).toEqual({
      type: 'all',
      items: [c('15150', 'C'), c('15122')],
    })
  })
  it('binds and tighter than or', () => {
    expect(parseRequisiteText('15122 and 21127 or 15151')).toEqual({
      type: 'any',
      items: [{ type: 'all', items: [c('15122'), c('21127')] }, c('15151')],
    })
  })
  it('rejects text it cannot interpret', () => {
    expect(parseRequisiteText('Junior standing')).toBeNull()
    expect(parseRequisiteText('15122 and')).toBeNull()
    expect(parseRequisiteText('')).toBeNull()
  })
})

describe('simplify', () => {
  it('flattens, dedupes and collapses', () => {
    expect(simplify({ type: 'all', items: [{ type: 'all', items: [c('1'), c('2')] }, c('1')] })).toEqual({ type: 'all', items: [c('1'), c('2')] })
    expect(simplify({ type: 'any', items: [c('1')] })).toEqual(c('1'))
    expect(simplify({ type: 'atLeast', n: 2, items: [c('1'), c('2')] })).toEqual({ type: 'all', items: [c('1'), c('2')] })
  })
})

describe('requisite helpers', () => {
  const req: Requisite = { type: 'all', items: [c('15122', 'C'), { type: 'any', items: [c('21127'), c('15151')] }] }

  it('lists mentioned courses', () => {
    expect(requisiteCourses(req)).toEqual(['15122', '21127', '15151'])
  })
  it('formats as plain text', () => {
    expect(formatRequisite(req)).toBe('15-122 (min C) and (21-127 or 15-151)')
    expect(formatRequisite(null)).toBe('None')
  })
  it('knows which courses are unavoidable', () => {
    expect(isRequired(req, '15122')).toBe(true)
    expect(isRequired(req, '21127')).toBe(false)
    expect(isRequired({ type: 'any', items: [{ type: 'all', items: [c('1'), c('2')] }, { type: 'all', items: [c('1'), c('3')] }] }, '1')).toBe(true)
    expect(isRequired({ type: 'atLeast', n: 2, items: [c('1'), c('2'), c('3')] }, '1')).toBe(false)
  })
})

const entry = (id: string, prereqs: Requisite | null, coreqs: string[] = []): CatalogEntry => ({
  id,
  code: `${id.slice(0, 2)}-${id.slice(2)}`,
  title: id,
  units: 12,
  prereqs,
  coreqs,
  antireqs: [],
  equivalents: [],
  passFail: false,
})

const index: CatalogIndex = {
  generatedAt: '',
  courses: Object.fromEntries(
    [
      entry('15112', null),
      entry('15122', c('15112'), ['21127']),
      entry('15213', c('15122')),
      entry('15210', { type: 'all', items: [c('15122'), c('15150')] }),
      entry('15150', { type: 'any', items: [c('15112'), c('15122')] }),
      entry('21127', null),
    ].map((e) => [e.id, e]),
  ),
}

describe('buildUnlocks', () => {
  it('indexes prerequisites and corequisites in reverse', () => {
    const unlocks = buildUnlocks(index)
    expect(unlocks.get('15122')).toEqual([
      { id: '15150', via: 'prereq', required: false },
      { id: '15210', via: 'prereq', required: true },
      { id: '15213', via: 'prereq', required: true },
    ])
    expect(unlocks.get('21127')).toEqual([{ id: '15122', via: 'coreq', required: false }])
    expect(buildUnlocks(index)).toBe(unlocks)
  })
})

describe('prerequisiteDepth', () => {
  it('follows the shortest route through alternatives', () => {
    expect(prerequisiteDepth(index, '15112')).toBe(0)
    expect(prerequisiteDepth(index, '15213')).toBe(2)
    expect(prerequisiteDepth(index, '15150')).toBe(1)
    expect(prerequisiteDepth(index, '15210')).toBe(2)
  })
})
