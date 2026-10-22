// Downloads CMU's open Schedule of Classes into data/raw/soc/<TERM>/ so builds stay offline.
//
//   node scripts/fetch-soc.ts                 every semester the SOC search offers
//   node scripts/fetch-soc.ts F26 S26         just these
//   node scripts/fetch-soc.ts --details=all   also cache every course's detail page (slow: ~1 request per course)
//
// Per term it saves (gzipped):
//   search-U.html.gz, search-G.html.gz   POST /SOCServlet/search for undergrad and grad courses (the two
//                                        together are the full schedule, and tell us each course's level)
//   details.json.gz                      { courseId: courseDetails HTML } for courses whose lecture → section
//                                        grouping is ambiguous in the flat search listing (several lectures
//                                        plus lettered sections). --details=all fetches every course.
//   meta.json                            fetch time, semester label, department code map

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dataDir } from './lib/common.ts'
import { isLecture, parseSearchPage, selectOptions } from './lib/soc-parse.ts'

const BASE = 'https://enr-apps.as.cmu.edu/open/SOC/SOCServlet'
const DELAY_MS = 150
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string, init?: RequestInit, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': 'courseweave (CMU course planner; weekly schedule refresh)', ...init?.headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return new TextDecoder('latin1').decode(await res.arrayBuffer())
  } catch (e) {
    if (attempt >= 3) throw e
    await sleep(1000 * attempt)
    return get(url, init, attempt + 1)
  }
}

function search(term: string, level: 'U' | 'G'): Promise<string> {
  const body = new URLSearchParams({
    SEMESTER: term,
    MINI: 'NO',
    GRAD_UNDER: level,
    PRG_LOCATION: 'All',
    DEPT: 'All',
    COURSE: '',
    TITLE: '',
    BEG_TIME: 'All',
    KEYWORD: '',
    TITLE_ONLY: 'NO',
    SUBMIT: '',
  })
  return get(`${BASE}/search`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
}

/** Courses listing 2+ lectures and some non-lecture section: the flat listing can't say which lecture owns which section. */
function ambiguousCourses(html: string): string[] {
  const out: string[] = []
  let course = ''
  let lectures = 0
  let others = 0
  const flush = () => {
    if (course && lectures >= 2 && others > 0) out.push(course)
  }
  for (const row of parseSearchPage(html)) {
    if (row.course) {
      flush()
      course = row.course
      lectures = 0
      others = 0
    }
    if (!row.section) continue
    if (isLecture(row.section)) lectures++
    else others++
  }
  flush()
  return out
}

const args = process.argv.slice(2)
const detailsMode = (args.find((a) => a.startsWith('--details='))?.split('=')[1] ?? 'ambiguous') as 'ambiguous' | 'all' | 'none'
const requested = args.filter((a) => !a.startsWith('--'))

const landing = await get(`${BASE}/search`)
const semesters = selectOptions(landing, 'SEMESTER')
const deptOptions = selectOptions(landing, 'DEPT').filter((o) => o.value !== 'All')
const terms = requested.length ? requested : semesters.map((s) => s.value)
console.log(`SOC offers: ${semesters.map((s) => `${s.value} (${s.label})`).join(', ')}`)

for (const term of terms) {
  const label = semesters.find((s) => s.value === term)?.label
  if (!label) console.warn(`${term}: not in the SOC semester list; trying anyway`)
  const dir = join(dataDir, 'raw', 'soc', term)
  mkdirSync(dir, { recursive: true })

  const pages: Record<'U' | 'G', string> = { U: '', G: '' }
  for (const level of ['U', 'G'] as const) {
    pages[level] = await search(term, level)
    writeFileSync(join(dir, `search-${level}.html.gz`), gzipSync(pages[level]))
    console.log(`${term} ${level}: ${parseSearchPage(pages[level]).filter((r) => r.course).length} courses`)
    await sleep(DELAY_MS)
  }

  const detailsPath = join(dir, 'details.json.gz')
  const details: Record<string, string> = existsSync(detailsPath) ? JSON.parse(gunzipSync(readFileSync(detailsPath)).toString('utf8')) : {}
  if (detailsMode !== 'none') {
    const all = [...new Set([...parseSearchPage(pages.U), ...parseSearchPage(pages.G)].map((r) => r.course).filter(Boolean))]
    const wanted = detailsMode === 'all' ? all : [...ambiguousCourses(pages.U), ...ambiguousCourses(pages.G)]
    let n = 0
    for (const course of wanted) {
      try {
        details[course] = await get(`${BASE}/courseDetails?COURSE=${course}&SEMESTER=${term}`)
      } catch (e) {
        console.warn(`${term} ${course}: ${(e as Error).message}`)
      }
      if (++n % 50 === 0) console.log(`${term} details: ${n}/${wanted.length}`)
      await sleep(DELAY_MS)
    }
    console.log(`${term} details: ${wanted.length} courses`)
  }
  writeFileSync(detailsPath, gzipSync(JSON.stringify(details)))

  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify(
      {
        term,
        label: label ?? null,
        fetchedAt: new Date().toISOString(),
        detailsMode,
        departments: deptOptions.map((o) => ({ code: o.value, name: o.label.replace(/\s*\(\d{2}XXX\)\s*$/, ''), prefix: /\((\d{2})XXX\)/.exec(o.label)?.[1] ?? null })),
      },
      null,
      2,
    ) + '\n',
  )
}
