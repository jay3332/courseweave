import { describe, expect, it } from 'vitest'
import type { CatalogIndex } from '../src/lib/catalog-types.ts'
import { clip, coursePage, courseDescription, seoCourses, sitemap, type SeoCourse } from './build-seo.ts'

const template = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="Generic." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Courseweave" />
    <meta property="og:image" content="https://courseweave.jay3332.tech/og.png" />
    <title>Courseweave</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`

const course: SeoCourse = {
  id: '15122',
  code: '15-122',
  title: 'Principles of Imperative Computation',
  units: 12,
  description: 'Teaches imperative programming </script><script>alert(1)</script> & "methods".',
  prereqs: '15-112 (min C)',
  offered: ['Spring 2027', 'Fall 2026'],
}

describe('course pages', () => {
  const page = coursePage(template, course)

  it('puts the course in the head and keeps the app untouched', () => {
    expect(page).toContain('<title>15-122 Principles of Imperative Computation · CMU course · Courseweave</title>')
    expect(page).toContain('<link rel="canonical" href="https://courseweave.jay3332.tech/all/courses/15-122" />')
    expect(page).toContain('<meta property="og:title" content="15-122 Principles of Imperative Computation" />')
    expect(page).toContain('<meta property="og:image" content="https://courseweave.jay3332.tech/og.png" />')
    expect(page.match(/og:title/g)).toHaveLength(1)
    expect(page).toContain('<script type="module" crossorigin src="/assets/index-abc.js"></script>')
    expect(page).toContain('<div id="root"></div>')
  })

  it('escapes course text in HTML and in the structured data', () => {
    expect(page).not.toContain('</script><script>alert(1)')
    expect(page).toContain('&lt;/script&gt;')
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(page)![1]
    expect(JSON.parse(ld)).toMatchObject({ '@type': 'Course', courseCode: '15-122', coursePrerequisites: '15-112 (min C)' })
  })

  it('summarizes the course for crawlers without scripts, out of sight otherwise', () => {
    expect(page).toMatch(/<noscript><main><h1>15-122 Principles of Imperative Computation<\/h1>.*Offered: Spring 2027, Fall 2026.*<\/main><\/noscript>/)
  })

  it('fails loudly if index.html changes shape', () => {
    expect(() => coursePage('<html><head></head><body></body></html>', course)).toThrow(/expected shape/)
  })
})

describe('descriptions', () => {
  it('lead with the course and fit a search snippet', () => {
    const d = courseDescription({ ...course, description: 'word '.repeat(80) })
    expect(d.startsWith('15-122 Principles of Imperative Computation, 12 units at Carnegie Mellon University. word')).toBe(true)
    expect(d.length).toBeLessThanOrEqual(158)
    expect(d.endsWith('…')).toBe(true)
    expect(courseDescription({ ...course, description: undefined, units: null })).toContain('variable units')
  })

  it('clip at a word', () => {
    expect(clip('one two three', 9)).toBe('one two…')
    expect(clip('short', 10)).toBe('short')
  })
})

describe('which courses get pages', () => {
  const catalog: CatalogIndex = {
    generatedAt: '2026-10-24T00:00:00Z',
    courses: {
      '15122': { id: '15122', code: '15-122', title: 'Principles of Imperative Computation', units: 12, prereqs: { type: 'course', id: '15112', minGrade: 'C' }, coreqs: [], antireqs: [], equivalents: [], passFail: false },
      '15999': { id: '15999', code: '15-999', title: 'Old Course', units: 9, prereqs: null, coreqs: [], antireqs: [], equivalents: [], passFail: false },
      '15998': { id: '15998', code: '15-998', title: 'Described Old Course', units: 9, prereqs: null, coreqs: [], antireqs: [], equivalents: [], passFail: false },
      '15101': { id: '15101', code: '15-101', title: '15-101', units: 9, prereqs: null, coreqs: [], antireqs: [], equivalents: [], passFail: false },
    },
  }
  const offerings = { terms: ['S27'], courses: { '15122': { title: 'Principles of Imperative Computation', dept: 'CS', level: 'U', terms: ['S27'] }, '15101': { title: '15-101', dept: 'CS', level: 'U', terms: ['S27'] } } }
  const details = { '15998': { description: 'Still in the catalog.' } }

  it('offered courses and described catalog courses, never number-only titles', () => {
    const courses = seoCourses(catalog, details, offerings, (id) => (id === 'S27' ? 'Spring 2027' : id))
    expect(courses.map((c) => c.code)).toEqual(['15-122', '15-998'])
    expect(courses[0]).toMatchObject({ prereqs: '15-112 (min C)', offered: ['Spring 2027'], units: 12 })
  })
})

describe('sitemap', () => {
  it('lists addresses with their dates', () => {
    const xml = sitemap([{ loc: 'https://courseweave.jay3332.tech/' }, { loc: 'https://courseweave.jay3332.tech/all/courses/15-122', lastmod: '2026-10-24' }])
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<url><loc>https://courseweave.jay3332.tech/all/courses/15-122</loc><lastmod>2026-10-24</lastmod></url>')
  })
})
