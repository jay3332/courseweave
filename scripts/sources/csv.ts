// Schedule CSV export: num,title,units,section,lecture,days,begin,end,bldg,room,mode,level,dept,instructors
// One row per meeting; a section can span several rows. `lecture` is set only on lecture rows.

import { join } from 'node:path'
import type { Course, Section } from '../../src/lib/types.ts'
import { addInstructors, addMeeting, cleanTitle, courseCode, location, miniOf, mostCommon, parseDays, parseTime, readCsvRecords, splitInstructors } from '../lib/common.ts'
import type { SourceAdapter } from './types.ts'

export const csvSource: SourceAdapter = (source, term, ctx) => {
  const rows = readCsvRecords(join(ctx.dataDir, String(source.path)))

  const byCourse = new Map<string, Record<string, string>[]>()
  for (const r of rows) {
    if (!/^\d{5}$/.test(r.num)) continue
    const list = byCourse.get(r.num) ?? []
    list.push(r)
    byCourse.set(r.num, list)
  }

  const courses: Course[] = []
  for (const [id, courseRows] of byCourse) {
    const title = cleanTitle(mostCommon(courseRows.map((r) => r.title)))
    const units = Number(mostCommon(courseRows.map((r) => r.units)))

    const sections = new Map<string, Section>()
    for (const r of courseRows) {
      let section = sections.get(r.section)
      if (!section) {
        const sectionTitle = cleanTitle(r.title)
        section = {
          name: r.section,
          kind: r.lecture ? 'lecture' : 'section',
          parent: null,
          mini: miniOf(r.section, term),
          mode: r.mode,
          instructors: [],
          meetings: [],
          ...(sectionTitle !== title ? { title: sectionTitle } : {}),
        }
        sections.set(r.section, section)
      }
      addInstructors(section.instructors, splitInstructors(r.instructors))
      addMeeting(section, {
        days: parseDays(r.days),
        start: parseTime(r.begin),
        end: parseTime(r.end),
        building: location(r.bldg),
        room: location(r.room),
      })
    }

    courses.push({
      id,
      code: courseCode(id),
      title,
      units: units < 0 || Number.isNaN(units) ? null : units,
      dept: mostCommon(courseRows.map((r) => r.dept)),
      level: mostCommon(courseRows.map((r) => r.level)) === 'G' ? 'G' : 'U',
      instructors: [],
      sections: [...sections.values()],
      crossListed: [],
    })
  }
  return courses
}
