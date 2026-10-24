import { describe, expect, it } from 'vitest'
import { sameCourseTitle, substitutesFor } from './substitutes'

describe('sameCourseTitle', () => {
  it('matches the same course under another number', () => {
    expect(sameCourseTitle('Machine Learning in Practice', 'Machine Learning in Practice')).toBe(true)
    expect(sameCourseTitle('Responsible AI & AI Governance', 'Responsible AI and AI Governance')).toBe(true)
    expect(sameCourseTitle('Introduction to Probability Modeling', 'Intro to Probability Modeling')).toBe(true)
    expect(sameCourseTitle('Special Topics: Time Series', 'Time Series')).toBe(true)
    expect(sameCourseTitle('ST: Developing Blockchain Use Cases', 'Developing Blockchain Use Case')).toBe(true)
    expect(sameCourseTitle('Machine Learning with Large Datasets (Undergraduate)', 'Machine Learning with Large Datasets')).toBe(true)
    expect(sameCourseTitle('Structure of Materials (Minor Option)', 'Structure of Materials')).toBe(true)
    expect(sameCourseTitle('Grammar Formalisims', 'Grammar Formalisms')).toBe(true)
  })

  it("doesn't match courses that only overlap or meet together", () => {
    expect(sameCourseTitle('Matrices and Linear Transformations', 'Linear Algebra')).toBe(false)
    expect(sameCourseTitle('Differential and Integral Calculus', 'Calculus in Three Dimensions')).toBe(false)
    expect(sameCourseTitle('Intermediate French I', 'Intermediate French II')).toBe(false)
    expect(sameCourseTitle('Undergraduate Seminar I', 'Undergraduate Seminar III')).toBe(false)
    expect(sameCourseTitle('Principles of Macroeconomics', 'Principles of Microeconomics')).toBe(false)
    expect(sameCourseTitle('Physics I for Engineering Students', 'Physics I for Science Students')).toBe(false)
    expect(sameCourseTitle('Molecular Biology', 'Graduate Molecular Biology')).toBe(false)
    expect(sameCourseTitle('Mathematical Statistics (Honors)', 'Mathematical Statistics')).toBe(false)
    expect(sameCourseTitle('', '')).toBe(false)
  })
})

describe('substitutesFor', () => {
  it('follows chains from the more advanced course down', () => {
    const subs = substitutesFor([
      ['21269', '21268'],
      ['21268', '21266'],
    ])
    expect([...subs.get('21266')!].sort()).toEqual(['21268', '21269'])
    expect(subs.has('21269')).toBe(false)
  })
})
