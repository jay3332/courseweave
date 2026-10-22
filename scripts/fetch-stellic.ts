// Fetches Stellic course sections (with recitations/labs) for every course in one term, read-only.
// Unlike the ScottyLabs scraper, the course list comes from the term's own data (public/data/<TERM>.json,
// else data/raw/<TERM>.csv), so it works for terms that FCE and the public SOC don't list yet (e.g. S27).
//
// Usage:
//   COOKIE_HEADER='<full Cookie header from academicaudit.andrew.cmu.edu>' node scripts/fetch-stellic.ts S27 [--limit N] [--concurrency N]
//   (or put the header in a file and pass --cookie-file path)
//
// Output: data/raw/stellic/<TERM>/<5digit>/ly<L>_sm<S>.json (same shape as the scraper's courses_history)
// plus data/raw/stellic/<TERM>/meta.json, which the `stellic` source adapter reads for lyear/sem.
// Requests: one POST to /planner/getstudentprofile/ (reads your profile) and GETs to /planner/getcoursesectionsforusems/
// (or /planner/getcoursesections/ with --endpoint plan).
// Nothing in your Stellic plan is created or changed. The cookie is never written to disk or logged.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { dataDir, publicDataDir, readCsvRecords } from './lib/common.ts'

const BASE = 'https://academicaudit.andrew.cmu.edu'
const SEM_ID = { fall: 1, spring: 2, summer: 3 } as const

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'cookie-file': { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '6' },
    // "term" (default): /planner/getcoursesectionsforusems/, keyed by calendar term; works for terms outside the
    // account's four plan years and for terms whose plan view isn't open yet (e.g. S27 before registration).
    // "plan": /planner/getcoursesections/, keyed by the account's plan year (lyear 0–3).
    endpoint: { type: 'string', default: 'term' },
    out: { type: 'string' },
  },
})

const termId = positionals[0]
if (!termId) {
  console.error('Usage: node scripts/fetch-stellic.ts <TERM> [--limit N] [--concurrency N] [--cookie-file path]')
  process.exit(1)
}

const cookie = (values['cookie-file'] ? readFileSync(values['cookie-file'], 'utf8') : (process.env.COOKIE_HEADER ?? '')).trim()
const csrf = cookie
  .split(';')
  .map((p) => p.trim())
  .find((p) => p.startsWith('csrftoken='))
  ?.slice('csrftoken='.length)
if (!cookie || !csrf) {
  console.error(
    'Missing Stellic cookie. Sign in at https://academicaudit.andrew.cmu.edu, open DevTools → Network,\n' +
      'select the request to /planner/getstudentprofile/, copy the full "Cookie" request header, and pass it as\n' +
      'COOKIE_HEADER=... (or save it to a file and use --cookie-file). It must include csrftoken and sessionid.',
  )
  process.exit(1)
}

const terms = JSON.parse(readFileSync(join(dataDir, 'terms.json'), 'utf8')) as { id: string; season: keyof typeof SEM_ID; year: number; sources?: { type: string; path?: string }[] }[]
const term = terms.find((t) => t.id === termId)
if (!term) {
  console.error(`Unknown term ${termId}; add it to data/terms.json first.`)
  process.exit(1)
}

function courseIds(): string[] {
  const built = join(publicDataDir, `${termId}.json`)
  if (existsSync(built)) return (JSON.parse(readFileSync(built, 'utf8')).courses as { id: string }[]).map((c) => c.id)
  const csv = term!.sources?.find((s) => s.type === 'csv')?.path
  if (csv) return [...new Set(readCsvRecords(join(dataDir, csv)).map((r) => r.num).filter((n) => /^\d{5}$/.test(n)))]
  throw new Error(`No course list for ${termId}: run npm run data first.`)
}

const headers = {
  Cookie: cookie,
  'X-CSRFToken': csrf,
  'X-Requested-With': 'XMLHttpRequest',
  Referer: `${BASE}/app/courses`,
}

function stripXssi(body: string): string {
  return body.startsWith(")]}'") ? body.slice(body.indexOf('\n') + 1) : body
}

async function request(url: string, init: RequestInit = {}, attempt = 0): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'manual' })
  if (res.status >= 300 && res.status < 400) throw new Error('Stellic redirected to sign-in: the cookie has expired. Copy a fresh one.')
  if (res.status >= 500 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
    return request(url, init, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/plan_id=[^&]+/, 'plan_id=…')}`)
  const body = stripXssi(await res.text())
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Stellic returned a non-JSON page: the cookie is probably expired.')
  }
}

// Per-student state that must not be saved.
const PERSONAL_SECTION_FIELDS = [
  'enrolled', 'in_plan', 'selected', 'wait_list_position', 'allow_drop', 'allow_register', 'is_eligible_for_drop',
  'is_eligible_for_swap', 'show_warning', 'pccs_id', 'enrollment_level', 'support_permission_number',
]
const PERSONAL_COURSE_FIELDS = ['flags', 'is_registered', 'registration_status', 'id', 'year', 'semester', 'start_usem']

function scrub(json: { data_list?: Record<string, unknown>[] }) {
  for (const entry of json.data_list ?? []) {
    delete entry.current
    const course = entry.course as Record<string, unknown> | undefined
    if (course) for (const f of PERSONAL_COURSE_FIELDS) delete course[f]
    for (const group of (entry.section_groups as { sections?: Record<string, unknown>[] }[] | undefined) ?? []) {
      for (const s of group.sections ?? []) for (const f of PERSONAL_SECTION_FIELDS) delete s[f]
    }
  }
  return json
}

let profile: { default_plan_id: string; term_joined: { semester: number; year: number } }
try {
  profile = (await request(`${BASE}/planner/getstudentprofile/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: `${BASE}/app/home` },
    body: '',
  })) as typeof profile
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}

const ayStart = (semId: number, year: number) => (semId === 1 ? year : year - 1)
const anchor = ayStart(profile.term_joined.semester, profile.term_joined.year)
const sem = SEM_ID[term.season]
const byTerm = values.endpoint !== 'plan'
// In term mode lyear only names the output files; clamp it so the adapter's file pattern still matches.
const rawLyear = ayStart(sem, term.year) - anchor + 1
const lyear = byTerm ? Math.min(3, Math.max(0, rawLyear)) : rawLyear
if (!byTerm && (lyear < 0 || lyear > 3)) {
  console.error(`${termId} is lyear ${lyear} for this account; Stellic only serves lyear 0–3 from the account's join term.`)
  process.exit(1)
}

const outDir = values.out ?? join(dataDir, 'raw', 'stellic', termId)
mkdirSync(outDir, { recursive: true })
let ids = courseIds()
if (values.limit) ids = ids.slice(0, Number(values.limit))
console.log(`${termId}: fetching ${ids.length} courses (${byTerm ? 'by calendar term' : `as lyear ${lyear}`}, sem ${sem})`)

let done = 0
let saved = 0
let failed = 0
const queue = [...ids]
async function worker() {
  for (let id = queue.shift(); id; id = queue.shift()) {
    const code = `${id.slice(0, 2)}-${id.slice(2)}`
    const url = byTerm
      ? `${BASE}/planner/getcoursesectionsforusems/?course_code=${code}&sem_id=${sem}&physical_year=${term!.year}&campus_id=1`
      : `${BASE}/planner/getcoursesections/?campus_id=1&course_code=${code}&physical_year=${term!.year}&plan_id=${profile.default_plan_id}&sem_id=${sem}&year=${lyear}`
    try {
      let json = (await request(url)) as { data_list?: Record<string, unknown>[]; available_sections?: { sections?: { course_name?: string }[] }[] }
      if (byTerm) {
        // Same section_groups shape as getcoursesections; wrap it like a courses_history file.
        const groups = (json.available_sections ?? []).filter((g) => g.sections?.length)
        const name = groups[0]?.sections?.[0]?.course_name ?? null
        json = { data_list: groups.length ? [{ course: { code, name, units: null }, section_groups: groups }] : [] }
      }
      if (json.data_list?.length) {
        mkdirSync(join(outDir, id), { recursive: true })
        writeFileSync(join(outDir, id, `ly${lyear}_sm${sem}.json`), JSON.stringify(scrub(json)))
        saved++
      }
    } catch (e) {
      failed++
      if (String(e).includes('cookie')) throw e
      console.warn(`  ${code}: ${(e as Error).message}`)
    }
    if (++done % 250 === 0) console.log(`  ${done}/${ids.length} (${saved} with sections, ${failed} failed)`)
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(values.concurrency)) }, worker))

writeFileSync(join(outDir, 'meta.json'), JSON.stringify({ term: termId, endpoint: byTerm ? 'term' : 'plan', lyear, sem, fetchedAt: new Date().toISOString(), courses: ids.length, saved }, null, 2))
console.log(`${termId}: ${saved} courses with sections saved to ${outDir} (${failed} failed)`)
