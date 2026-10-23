import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Requisite } from '../../lib/catalog-types'
import { RequisiteText } from './RequisiteText'

vi.mock('./chip-context', () => ({
  useChipContext: (status?: (id: string) => string | undefined) => ({
    termId: 'F26',
    termName: 'Fall 2026',
    offered: () => true,
    title: () => undefined,
    href: (id: string) => `/F26/courses/${id}`,
    status,
  }),
}))

const course = (id: string, minGrade?: string): Requisite => ({ type: 'course', id, ...(minGrade ? { minGrade } : {}) })
const text = (req: Requisite, status?: (id: string) => 'met' | 'planned' | 'missing' | undefined) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RequisiteText, { req, status })))
    .replace(/<[^>]+>/g, '')

describe('RequisiteText', () => {
  it('reads like a catalog: top-level groups bare, nested groups in parentheses', () => {
    const req: Requisite = { type: 'all', items: [course('15122', 'C'), { type: 'any', items: [course('21127'), course('15151')] }] }
    expect(text(req)).toBe('15-122 and (21-127 or 15-151)')
    expect(text({ type: 'atLeast', n: 2, items: [course('21127'), course('21128'), course('15151')] })).toBe('at least 2 of 21-127, 21-128, 15-151')
    expect(text({ type: 'any', items: [{ type: 'atLeast', n: 1, items: [course('21127'), course('21128')] }, course('15151')] })).toBe('at least 1 of (21-127, 21-128) or 15-151')
  })

  it('keeps each parenthesis on the same line as its course and labels status for screen readers', () => {
    const req: Requisite = { type: 'all', items: [course('15150'), { type: 'any', items: [course('21259'), course('21268')] }] }
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RequisiteText, { req, status: (id) => (id === '15150' ? 'met' : 'missing') })))
    expect(html).toMatch(/<span class="whitespace-nowrap"><span class="text-muted">\(<\/span><a[^>]*aria-label="21-259, not taken yet"/)
    expect(html).toMatch(/aria-label="15-150, completed"/)
    expect(html).toMatch(/21-268<\/span><\/a><span class="text-muted">\)<\/span><\/span>/)
  })
})
