// Downloads CMU's open Schedule of Classes into data/raw/soc/<TERM>/ so builds stay offline.
//
//   node scripts/fetch-soc.ts                 every semester the SOC search offers
//   node scripts/fetch-soc.ts F26 S26         just these
//   node scripts/fetch-soc.ts --details=all   also cache every course's detail page (slow: ~1 request per course)
//   node scripts/fetch-soc.ts --extras=all    read every course's reservations now (default: a rotating slice)
//
// Per term it saves (gzipped):
//   search-U.html.gz, search-G.html.gz   POST /SOCServlet/search for undergrad and grad courses (the two
//                                        together are the full schedule, and tell us each course's level)
//   details.json.gz                      { courseId: courseDetails HTML } for courses whose lecture → section
//                                        grouping is ambiguous in the flat search listing (several lectures
//                                        plus lettered sections). --details=all fetches every course.
//   extras.json                          { courseId: { reservations?: { section: [lines] }, permission?: true } }
//                                        from each course's detail page. For the current and upcoming semesters a
//                                        run reads courses it hasn't yet plus a rotating slice of the rest, so the
//                                        twice-weekly workflow stays short and each course is re-read every few runs.
//                                        Past semesters don't change: their courses are read once (a backfill spread
//                                        over a few runs) and then left alone.
//   meta.json                            fetch time, semester label, department code map

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { dataDir } from './lib/common.ts'
import { isLecture, parseDetailsExtras, parseSearchPage, responseText, selectOptions } from './lib/soc-parse.ts'

const BASE = 'https://enr-apps.as.cmu.edu/open/SOC/SOCServlet'
const DELAY_MS = 150
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string, init?: RequestInit, attempt = 1): Promise<string> {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': 'courseweave (CMU course planner; weekly schedule refresh)', ...init?.headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return responseText(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'))
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

type Extras = { reservations?: Record<string, string[]>; permission?: true }

/** Courses re-read per term and run, besides ones never read (~5 minutes at ~3 requests a second). */
const EXTRAS_SLICE = 900
/** At most this many per term and run, never-read ones first, so a newly published term fits the workflow's time limit. */
const EXTRAS_MAX = 1500
/** Past semesters' backfill per term and run. */
const EXTRAS_BACKFILL = 1200
const RUN_SPACING_MS = 3.5 * 24 * 60 * 60 * 1000 // the workflow runs twice a week

const ordinal = (term: string) => Number(term.slice(1)) * 3 + ({ S: 0, M: 1, F: 2 } as Record<string, number>)[term[0]]
/** The semester under way (or next to start) today: spring through May, summer through August, then fall. */
function currentTerm(now = new Date()): string {
  const m = now.getMonth()
  return `${m <= 4 ? 'S' : m <= 7 ? 'M' : 'F'}${String(now.getFullYear() % 100).padStart(2, '0')}`
}

/** One course per line, sorted, so a refresh's diff shows exactly which courses' reservations changed. */
function writeExtras(path: string, extras: Record<string, Extras>) {
  const lines = Object.keys(extras)
    .sort()
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(extras[id])}`)
  writeFileSync(path, `{\n${lines.join(',\n')}\n}\n`)
}

const args = process.argv.slice(2)
const detailsMode = (args.find((a) => a.startsWith('--details='))?.split('=')[1] ?? 'ambiguous') as 'ambiguous' | 'all' | 'none'
const extrasMode = (args.find((a) => a.startsWith('--extras='))?.split('=')[1] ?? 'rotate') as 'rotate' | 'all' | 'none'
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
  const all = [...new Set([...parseSearchPage(pages.U), ...parseSearchPage(pages.G)].map((r) => r.course).filter(Boolean))].sort()
  const fresh = new Set<string>()
  if (detailsMode !== 'none') {
    const wanted = detailsMode === 'all' ? all : [...ambiguousCourses(pages.U), ...ambiguousCourses(pages.G)]
    let n = 0
    for (const course of wanted) {
      try {
        details[course] = await get(`${BASE}/courseDetails?COURSE=${course}&SEMESTER=${term}`)
        fresh.add(course)
      } catch (e) {
        console.warn(`${term} ${course}: ${(e as Error).message}`)
      }
      if (++n % 50 === 0) console.log(`${term} details: ${n}/${wanted.length}`)
      await sleep(DELAY_MS)
    }
    console.log(`${term} details: ${wanted.length} courses`)
  }
  writeFileSync(detailsPath, gzipSync(JSON.stringify(details)))

  if (extrasMode !== 'none') {
    const past = ordinal(term) < ordinal(currentTerm())
    const extrasPath = join(dir, 'extras.json')
    const old: Record<string, Extras> = existsSync(extrasPath) ? JSON.parse(readFileSync(extrasPath, 'utf8')) : {}
    const extras: Record<string, Extras> = {}
    for (const id of all) if (old[id]) extras[id] = old[id]
    const unread = all.filter((id) => !old[id])
    let wanted = all
    if (extrasMode === 'rotate' && past) {
      wanted = unread.slice(0, EXTRAS_BACKFILL)
    } else if (extrasMode === 'rotate') {
      const slices = Math.max(1, Math.ceil(all.length / EXTRAS_SLICE))
      const at = (Math.floor(Date.now() / RUN_SPACING_MS) % slices) * EXTRAS_SLICE
      wanted = [...new Set([...unread, ...all.slice(at, at + EXTRAS_SLICE)])].slice(0, EXTRAS_MAX)
    }
    let n = 0
    for (const course of wanted) {
      try {
        const html = fresh.has(course) ? details[course] : await get(`${BASE}/courseDetails?COURSE=${course}&SEMESTER=${term}`)
        const { reservations, permission } = parseDetailsExtras(html)
        extras[course] = { ...(Object.keys(reservations).length ? { reservations } : {}), ...(permission ? { permission: true as const } : {}) }
      } catch (e) {
        console.warn(`${term} ${course} reservations: ${(e as Error).message}`)
      }
      if (++n % 100 === 0) console.log(`${term} reservations: ${n}/${wanted.length}`)
      if (!fresh.has(course)) await sleep(DELAY_MS)
    }
    writeExtras(extrasPath, extras)
    console.log(`${term} reservations: read ${wanted.length} of ${all.length} courses; ${Object.values(extras).filter((x) => x.reservations).length} have some`)
  }

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
