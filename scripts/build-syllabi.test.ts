import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isSyllabusKey, registryTermLabel, registryTermOrder } from '../src/lib/syllabus-files.ts'
import { indexSyllabi } from './build-syllabi.ts'
import { parseSyllabusName, scanSyllabi } from './lib/syllabi.ts'

// A made-up export: <term>/<dept>/<course>-<section>.<ext>.
const dir = mkdtempSync(join(tmpdir(), 'syllabi-test-'))
const put = (path: string, content: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), content)
}
put('F25/MSC/21241-1.pdf', 'same syllabus')
put('F25/MSC/21241-2.pdf', 'same syllabus')
put('F25/MSC/21241-3.pdf', 'other syllabus')
put('F25/MSC/21241-W.url', 'https://canvas.cmu.edu/courses/123/pages/21241-w')
put('N24/MSC/21241-A.docx', 'docx')
put('S25/H00/65411-A.pdf', 'pdf')
put('S25/SDS/88-150-A.pdf', 'dashed number')
put('S25/III/notes.pdf', 'no course number')
put('S25/ISM/95794-A1.ics', 'calendar')
put('S25/MSC/21120-1.url', 'https://example.com/elsewhere')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('syllabus export', () => {
  const { files, skipped } = scanSyllabi(dir)

  it('reads course numbers and sections from file names', () => {
    expect(parseSyllabusName('21241-1.pdf')).toEqual({ courseId: '21241', sections: ['1'] })
    expect(parseSyllabusName('88-150-A.pdf')).toEqual({ courseId: '88150', sections: ['A'] })
    expect(parseSyllabusName('73103.pdf')).toEqual({ courseId: '73103', sections: [] })
    expect(parseSyllabusName('48734_Possibilistic_Design.pdf')).toEqual({ courseId: '48734', sections: [] })
    expect(parseSyllabusName('notes.pdf')).toBeNull()
  })

  it('merges identical copies, keeps Canvas page links, and skips what it can’t serve', () => {
    const f25 = files.filter((f) => f.courseId === '21241' && f.term === 'F25')
    expect(f25.map((f) => [f.key, f.sections, f.type])).toEqual([
      ['F25/MSC/21241-W.url', ['W'], null],
      ['F25/MSC/21241-1.pdf', ['1', '2'], 'pdf'],
      ['F25/MSC/21241-3.pdf', ['3'], 'pdf'],
    ])
    expect(files.some((f) => f.key === 'S25/H00/65411-A.pdf')).toBe(true)
    expect(skipped.sort()).toEqual([
      'S25/III/notes.pdf: no course number',
      'S25/ISM/95794-A1.ics: unsupported file',
      'S25/MSC/21120-1.url: not a Canvas page link',
    ])
  })

  it('indexes by course-number prefix, newest term first, files before links', () => {
    const chunks = indexSyllabi(files)
    expect(Object.keys(chunks).sort()).toEqual(['21', '65', '88'])
    expect(chunks['21']['21241']).toEqual([
      { term: 'F25', sections: ['1', '2'], key: 'F25/MSC/21241-1.pdf', type: 'pdf', size: 13 },
      { term: 'F25', sections: ['3'], key: 'F25/MSC/21241-3.pdf', type: 'pdf', size: 14 },
      { term: 'F25', sections: ['W'], url: 'https://canvas.cmu.edu/courses/123/pages/21241-w' },
      { term: 'N24', sections: ['A'], key: 'N24/MSC/21241-A.docx', type: 'docx', size: 4 },
    ])
  })
})

describe('syllabus keys and terms', () => {
  it('accepts only registry-shaped keys with a served type', () => {
    expect(isSyllabusKey('F25/MSC/21241-1.pdf')).toBe(true)
    expect(isSyllabusKey('S25/H00/65411-A.PDF')).toBe(true)
    expect(isSyllabusKey('F25/MSC/../secret.pdf')).toBe(false)
    expect(isSyllabusKey('../F25/MSC/21241-1.pdf')).toBe(false)
    expect(isSyllabusKey('F25/MSC/.hidden.pdf')).toBe(false)
    expect(isSyllabusKey('F25/MSC/21241-1.exe')).toBe(false)
    expect(isSyllabusKey('X25/MSC/21241-1.pdf')).toBe(false)
  })

  it('labels and orders registry terms, summer sessions included', () => {
    expect(['F24', 'N24', 'S24', 'M24'].sort((a, b) => registryTermOrder(a) - registryTermOrder(b))).toEqual(['S24', 'M24', 'N24', 'F24'])
    expect(registryTermLabel('N24')).toBe('Summer Two 2024')
    expect(registryTermLabel('F25')).toBe('Fall 2025')
  })
})
