import { describe, expect, it } from 'vitest'
import type { InstructorFce } from '../../lib/fce'
import { NameIndex } from '../../lib/fce-names'
import type { TeachingData } from '../../lib/types'
import { buildAllInstructors, type AllInstructor } from './allInstructors'
import { scoreInstructor } from './instructorData'

// Made-up people and courses.
const teaching: TeachingData = {
  terms: ['S27', 'F26', 'S26'],
  instructors: {
    'Ada Example': { depts: ['CS'], terms: { S27: { courses: ['15213'], sections: 2 }, S26: { courses: ['15213', '15513'], sections: 3 } } },
    'Bo Sample': { depts: ['MATH'], terms: { F26: { courses: ['21241'], sections: 1 } } },
  },
}

const fceEntry = (name: string, courseIds: string[]): InstructorFce => ({
  name,
  courses: courseIds.map((courseId) => ({ courseId, terms: 1, responses: 10, teachingRate: 4, courseRate: 4, hours: 9, last: 'F20', first: 'F20' })),
  terms: [{ term: 'F20', teachingRate: 4, responses: 10 }],
})
const fce = new NameIndex<InstructorFce>()
fce.add('EXAMPLE, ADA', fceEntry('EXAMPLE, ADA', ['15213']))
fce.add('PAST, CORA', fceEntry('PAST, CORA', ['15251', '21127']))

const course = {
  title: (id: string) => ({ '15213': 'Introduction to Computer Systems', '15251': 'Great Ideas in Theoretical Computer Science' })[id],
  dept: (id: string) => ({ '15': 'CS', '21': 'MATH' })[id.slice(0, 2)],
}

describe('buildAllInstructors', () => {
  const all = buildAllInstructors(teaching, fce, course)
  const by = (name: string) => all.list.find((i) => i.name === name) as AllInstructor

  it('lists who teaches in each semester, newest first, with totals across them', () => {
    expect(by('Ada Example')).toMatchObject({
      slug: 'ada-example',
      depts: ['CS'],
      courseIds: ['15213', '15513'],
      sectionCount: 5,
      terms: [
        { term: 'S27', courses: ['15213'], sections: 2 },
        { term: 'S26', courses: ['15213', '15513'], sections: 3 },
      ],
    })
  })

  it('adds people only in the FCE history once, with their evaluated courses', () => {
    expect(all.list.map((i) => i.name)).toEqual(['Ada Example', 'Cora Past', 'Bo Sample'])
    expect(by('Cora Past')).toMatchObject({ slug: 'cora-past', depts: ['CS', 'MATH'], courseIds: ['15251', '21127'], sectionCount: 0, terms: [] })
    expect(all.bySlug.get('cora-past')?.name).toBe('Cora Past')
  })

  it('searches names, course numbers and course titles', () => {
    const doc = (name: string) => all.docs.find((d) => d.inst.name === name)!
    expect(scoreInstructor(doc('Cora Past'), '15-251')).toBeGreaterThan(0)
    expect(scoreInstructor(doc('Cora Past'), 'great ideas')).toBeGreaterThan(0)
    expect(scoreInstructor(doc('Bo Sample'), '15-251')).toBe(0)
  })

  it('works without FCEs', () => {
    expect(buildAllInstructors(teaching, null, course).list.map((i) => i.name)).toEqual(['Ada Example', 'Bo Sample'])
  })
})
