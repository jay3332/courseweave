// Stellic `getcoursesections` exports, as written by the ScottyLabs scraper (crates/courses-scraper):
//   <dir>/<5digit>/ly<lyear>_sm<sem>.json
// Options:
//   dir        courses_history directory; absolute, or relative to `root` (default "exported/jgtsao/courses_history")
//   root       "scottylabs" (default, ctx.scottylabsDir) or "data" (this repo's data/ dir)
//   lyear      Stellic academic-year offset from the exporting account's join term (see scraper docs/discovery.md)
//   sem        1 = fall, 2 = spring, 3 = summer
//              (both optional when <dir>/meta.json exists, as written by scripts/fetch-stellic.ts)
//   campuses   optional Stellic campus ids to keep (1 = Pittsburgh)
//   optional   true: a missing dir is skipped with a warning instead of failing the build
// Stellic sections include recitations/labs with parent links, rooms, instructors and enrollment caps,
// but no delivery mode or SOC department code (derived from the course-number prefix).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Course } from '../../src/lib/types.ts'
import { parseStellicCourse, type StellicSectionsFile } from '../lib/stellic-parse.ts'
import type { SourceAdapter } from './types.ts'

export const stellicSource: SourceAdapter = (source, term, ctx) => {
  const base = source.root === 'data' ? ctx.dataDir : ctx.scottylabsDir
  const rel = String(source.dir ?? 'exported/jgtsao/courses_history')
  const dir = isAbsolute(rel) ? rel : join(base, rel)
  if (!existsSync(dir)) {
    if (source.optional) {
      console.warn(`  ${term.id}: stellic dir not found, skipping (${dir})`)
      return []
    }
    throw new Error(`${term.id}: stellic dir not found: ${dir}`)
  }
  // scripts/fetch-stellic.ts records the lyear/sem it fetched.
  const metaPath = join(dir, 'meta.json')
  const meta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { lyear?: number; sem?: number }) : {}
  const lyear = Number(source.lyear ?? meta.lyear)
  const sem = Number(source.sem ?? meta.sem)
  if (!Number.isInteger(lyear) || ![1, 2, 3].includes(sem)) {
    throw new Error(`${term.id}: stellic source needs integer "lyear" and "sem" (1 fall, 2 spring, 3 summer), or a meta.json from fetch-stellic`)
  }
  const campuses = Array.isArray(source.campuses) ? source.campuses.map(Number) : undefined

  const fileName = `ly${lyear}_sm${sem}.json`
  const courses: Course[] = []
  for (const id of readdirSync(dir)) {
    if (!/^\d{5}$/.test(id)) continue
    const path = join(dir, id, fileName)
    if (!existsSync(path)) continue
    const file = JSON.parse(readFileSync(path, 'utf8')) as StellicSectionsFile
    const course = parseStellicCourse(id, file, term, { campuses })
    if (course) courses.push(course)
  }
  return courses
}
