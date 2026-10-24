// Builds the term-independent course catalog:
//   public/data/catalog/index.json         CatalogIndex (requisites, grading, offering pattern)
//   public/data/catalog/details/<NN>.json  descriptions and course profiles, per course-number prefix
//   data/derived/pass-fail.json            course ids graded pass/fail only (read by build-data)
//
// Sources:
//   1. Stellic course info exported by the ScottyLabs scraper: <scottylabsDir>/exported/*/courses_history/*/info.json
//      (requisite trees with minimum grades, grading options, offering tags, profiles).
//   2. SOC course detail pages cached in data/raw/soc-details.json (proper descriptions with punctuation,
//      prerequisite/corequisite text, cross-listings, notes) — fetched with `--fetch`.
//
// Usage: node scripts/build-catalog.ts            build from cached data (offline)
//        node scripts/build-catalog.ts --fetch    refresh the SOC detail cache first (network), then build

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogDetails, CatalogEntry, CatalogIndex, Requisite } from '../src/lib/catalog-types.ts'
import { parseRequisiteText, simplify } from '../src/lib/requisite-format.ts'
import { sameCourseTitle } from '../src/lib/substitutes.ts'
import { courseCode, dataDir, derivedDir, publicDataDir, scottylabsDir } from './lib/common.ts'

const SOC_BASE = 'https://enr-apps.as.cmu.edu'
const SOC_CACHE = join(dataDir, 'raw', 'soc-details.json')
const outDir = join(publicDataDir, 'catalog')

// ---------------------------------------------------------------- Stellic

interface StellicCourseRef {
  code: string
  /** The course's title, on equivalents (also for retired numbers). */
  name?: string
}

interface StellicConstraint {
  type: string
  data?: { is_and?: boolean; x?: number; grade?: string; course?: StellicCourseRef }
}

interface StellicNode {
  constraints?: StellicConstraint[]
  choices?: StellicNode[]
}

interface StellicInfo {
  code: string
  name: string
  long_desc?: string | null
  website?: string | null
  units?: number | null
  min_units?: number | null
  max_units?: number | null
  prereqs?: { req_obj?: StellicNode | null; text?: string | null; raw_pre_req?: string | null }
  co_reqs?: StellicCourseRef[]
  anti_reqs?: StellicCourseRef[]
  equiv?: StellicCourseRef[]
  grade_option?: { is_pass_fail?: boolean; never_graded?: boolean } | null
  offering_tags?: { name: string; sem?: number }[]
  offerings?: { campus_id: number; semesters: { semester: number; year: number }[] }[]
  attributes?: { name?: string }[]
  custom_fields?: Record<string, string | null>
  is_repeatable?: boolean
}

const toId = (code: string) => code.replace(/\D/g, '')
const isCourseId = (id: string) => /^\d{5}$/.test(id)

/** Newest info.json per course across every export directory. */
function findStellicInfos(): Map<string, string> {
  const exported = join(scottylabsDir(), 'exported')
  const best = new Map<string, { path: string; mtime: number }>()
  if (!existsSync(exported)) return new Map()
  for (const user of readdirSync(exported)) {
    const hist = join(exported, user, 'courses_history')
    if (!existsSync(hist)) continue
    for (const dir of readdirSync(hist)) {
      const path = join(hist, dir, 'info.json')
      if (!isCourseId(dir) || !existsSync(path)) continue
      const mtime = statSync(path).mtimeMs
      const prev = best.get(dir)
      if (!prev || mtime > prev.mtime) best.set(dir, { path, mtime })
    }
  }
  return new Map([...best].map(([id, v]) => [id, v.path]))
}

/** Stellic requirement tree → Requisite. Leaves are `course` constraints; groups carry `anyxof` and `mingrade`. */
function fromStellic(node: StellicNode, inheritedGrade?: string): Requisite | null {
  const cons = node.constraints ?? []
  const grade = cons.find((c) => c.type === 'mingrade')?.data?.grade ?? inheritedGrade
  const course = cons.find((c) => c.type === 'course')?.data?.course
  if (course) {
    const id = toId(course.code)
    if (!isCourseId(id)) return { type: 'text', text: course.code }
    return grade && grade !== 'D' ? { type: 'course', id, minGrade: grade } : { type: 'course', id }
  }
  const items = (node.choices ?? []).map((c) => fromStellic(c, grade)).filter((r): r is Requisite => r !== null)
  if (!items.length) return null
  const anyx = cons.find((c) => c.type === 'anyxof')?.data
  const n = anyx?.x ?? items.length
  if (anyx?.is_and || n >= items.length) return { type: 'all', items }
  if (n <= 1) return { type: 'any', items }
  return { type: 'atLeast', n, items }
}

// ---------------------------------------------------------------- SOC course details

interface SocDetail {
  semester: string
  title?: string
  units?: number | null
  description?: string
  prereqText?: string
  coreqs?: string[]
  crossListed?: string[]
  notes?: string
  permission?: boolean
  urls?: string[]
}

interface SocCache {
  fetchedAt: string
  courses: Record<string, SocDetail>
  /** Course ids requested but not found in any semester, to skip on re-runs. */
  missing: string[]
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

const stripTags = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()

function ddAfter(html: string, label: string): string | null {
  const m = new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i').exec(html)
  return m ? m[1] : null
}

function isNone(s: string | null): boolean {
  return s === null || /^\s*(none)?\s*$/i.test(stripTags(s))
}

function parseSocDetail(html: string, semester: string): SocDetail {
  const out: SocDetail = { semester }
  const title = /data-maintitle="\d{5}(?:&nbsp;|\s)+([^"]*)"/.exec(html)
  if (title) out.title = decodeEntities(title[1]).trim()
  const desc = /id="course-detail-description"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(html)
  if (desc) {
    const d = stripTags(desc[1]).replace(/\s{2,}/g, ' ')
    if (d && !/^none$/i.test(d)) out.description = d
  }
  const pre = ddAfter(html, 'Prerequisites')
  if (!isNone(pre)) out.prereqText = stripTags(pre!).replace(/\s+/g, ' ')
  const co = ddAfter(html, 'Corequisites')
  if (!isNone(co)) out.coreqs = [...stripTags(co!).matchAll(/\d{2}-?\d{3}/g)].map((m) => toId(m[0]))
  const cross = ddAfter(html, 'Cross-Listed Courses')
  if (!isNone(cross)) out.crossListed = [...stripTags(cross!).matchAll(/\d{2}-?\d{3}/g)].map((m) => toId(m[0]))
  const notes = ddAfter(html, 'Notes')
  if (!isNone(notes)) out.notes = stripTags(notes!).replace(/\n/g, '')
  const perm = ddAfter(html, 'Special Permission Required')
  if (perm) out.permission = /yes/i.test(stripTags(perm))
  const urls = /id="course-detail-related-urls"[\s\S]*?<\/dl>/.exec(html)
  if (urls) {
    const list = [...urls[0].matchAll(/href="([^"]+)"/g)].map((m) => decodeEntities(m[1]))
    if (list.length) out.urls = list
  }
  const units = /<td>\s*([\d.]+|VAR)\s*<\/td>/i.exec(html)
  if (units) out.units = /VAR/i.test(units[1]) ? null : Number(units[1])
  return out
}

/** Course ids listed in a SOC .dat dump, and its semester code (e.g. "F26"). */
function parseDat(text: string): { semester: string | null; ids: string[] } {
  const sem = /Semester:\s*(Fall|Spring|Summer)\s+(\d{4})/i.exec(text)
  const semester = sem ? `${{ fall: 'F', spring: 'S', summer: 'M' }[sem[1].toLowerCase() as 'fall']}${sem[2].slice(2)}` : null
  const ids = [...new Set([...text.matchAll(/^\t(\d{5})\t/gm)].map((m) => m[1]))]
  return { semester, ids }
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'courseweave-course-planner (personal use)' } })
      return { status: res.status, text: await res.text() }
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++
        await fn(items[i], i)
      }
    }),
  )
}

function readSocCache(): SocCache {
  return existsSync(SOC_CACHE) ? JSON.parse(readFileSync(SOC_CACHE, 'utf8')) : { fetchedAt: '', courses: {}, missing: [] }
}

/** Semester codes (e.g. "F25") a course was offered in at the Pittsburgh campus, newest first, per Stellic. */
function stellicSemesters(info: StellicInfo): string[] {
  const out: { code: string; order: number }[] = []
  for (const o of info.offerings ?? []) {
    if (o.campus_id !== 1) continue
    for (const s of o.semesters) {
      const letter = { 1: 'F', 2: 'S', 3: 'M' }[s.semester as 1 | 2 | 3]
      if (letter) out.push({ code: `${letter}${String(s.year).slice(2)}`, order: s.year * 10 + ({ S: 1, M: 2, F: 3 } as const)[letter as 'S'] })
    }
  }
  return out.sort((a, b) => b.order - a.order).map((x) => x.code)
}

async function refreshSocCache(infos: Map<string, StellicInfo>) {
  const cache = readSocCache()
  // Which semesters the SOC servlet currently serves.
  const search = await fetchText(`${SOC_BASE}/open/SOC/SOCServlet/search`)
  const available = [...search.text.matchAll(/<option\s+value="([FSM]\d{2})"/g)].map((m) => m[1])
  console.log(`catalog: SOC serves ${available.join(', ') || 'no semesters'}`)

  // Course lists for the current fall/spring dumps; Stellic offerings cover the rest.
  const listed = new Map<string, string[]>()
  for (const season of ['fall', 'spring']) {
    const dat = await fetchText(`${SOC_BASE}/assets/SOC/sched_layout_${season}.dat`)
    if (dat.status !== 200) continue
    const { semester, ids } = parseDat(dat.text)
    if (!semester || !available.includes(semester)) continue
    for (const id of ids) listed.set(id, [...(listed.get(id) ?? []), semester])
  }
  for (const [id, info] of infos) {
    const sems = stellicSemesters(info).filter((s) => available.includes(s))
    if (sems.length) listed.set(id, [...new Set([...(listed.get(id) ?? []), ...sems])])
  }

  const missing = new Set(cache.missing)
  const todo = [...listed].filter(([id]) => !cache.courses[id] && !missing.has(id))
  console.log(`catalog: fetching SOC details for ${todo.length} courses (${Object.keys(cache.courses).length} cached)`)
  let done = 0
  await pool(todo, 6, async ([id, sems]) => {
    for (const sem of sems) {
      const res = await fetchText(`${SOC_BASE}/open/SOC/SOCServlet/courseDetails?COURSE=${id}&SEMESTER=${sem}`)
      if (res.status === 200 && res.text.includes('course-detail-modal-body')) {
        cache.courses[id] = parseSocDetail(res.text, sem)
        break
      }
    }
    if (!cache.courses[id]) missing.add(id)
    if (++done % 250 === 0) {
      console.log(`  ${done}/${todo.length}`)
      writeFileSync(SOC_CACHE, JSON.stringify({ ...cache, missing: [...missing] }))
    }
  })
  cache.fetchedAt = new Date().toISOString()
  cache.missing = [...missing].sort()
  mkdirSync(join(dataDir, 'raw'), { recursive: true })
  writeFileSync(SOC_CACHE, JSON.stringify(cache))
}

// ---------------------------------------------------------------- build

function cleanText(s: string | null | undefined): string | undefined {
  const t = (s ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  return t || undefined
}

function idList(refs: StellicCourseRef[] | undefined, self: string): string[] {
  return [...new Set((refs ?? []).map((r) => toId(r.code)).filter((id) => isCourseId(id) && id !== self))].sort()
}

function offeredFrom(info: StellicInfo): { offered?: CatalogEntry['offered']; intermittent?: boolean } {
  const tags = info.offering_tags ?? []
  const seasons = new Set<'fall' | 'spring' | 'summer'>()
  for (const t of tags) if (t.name === 'specific_sem' && t.sem) seasons.add(({ 1: 'fall', 2: 'spring', 3: 'summer' } as const)[t.sem as 1 | 2 | 3])
  const intermittent = tags.some((t) => t.name === 'intermittent')
  const order = ['fall', 'spring', 'summer'] as const
  return {
    ...(seasons.size ? { offered: order.filter((s) => seasons.has(s)) } : {}),
    ...(intermittent ? { intermittent } : {}),
  }
}

async function main() {
  const infoPaths = findStellicInfos()
  const infos = new Map<string, StellicInfo>()
  for (const [id, path] of infoPaths) infos.set(id, JSON.parse(readFileSync(path, 'utf8')))
  console.log(`catalog: ${infos.size} Stellic course records`)

  if (process.argv.includes('--fetch')) await refreshSocCache(infos)
  const soc = readSocCache().courses

  const entries: Record<string, CatalogEntry> = {}
  const details: Record<string, Record<string, CatalogDetails>> = {}
  const stats = { tree: 0, socText: 0, textOnly: 0, none: 0, socDescriptions: 0, stellicDescriptions: 0, relatedDropped: 0 }

  for (const id of [...new Set([...infos.keys(), ...Object.keys(soc)])].sort()) {
    const info = infos.get(id)
    const s = soc[id]

    let prereqs: Requisite | null = null
    let prereqText: string | undefined
    const tree = info?.prereqs?.req_obj
    if (tree) {
      prereqs = fromStellic(tree)
      if (prereqs) stats.tree++
    }
    if (!prereqs && s?.prereqText) {
      prereqs = parseRequisiteText(s.prereqText)
      if (prereqs) stats.socText++
      else {
        prereqs = { type: 'text', text: s.prereqText }
        stats.textOnly++
      }
    }
    if (!prereqs) {
      const text = cleanText(info?.prereqs?.text) ?? cleanText(info?.prereqs?.raw_pre_req)
      if (text) {
        prereqs = parseRequisiteText(text) ?? { type: 'text', text }
        stats.textOnly++
      } else stats.none++
    }
    if (prereqs) prereqs = simplify(prereqs)
    // Keep the SOC wording when it doesn't round-trip to a course expression (e.g. standing requirements).
    if (s?.prereqText && prereqs?.type !== 'text' && !parseRequisiteText(s.prereqText)) prereqText = s.prereqText

    const minUnits = info?.min_units ?? info?.units ?? null
    const maxUnits = info?.max_units ?? null
    const units = minUnits ?? (s?.units === undefined ? null : s.units)
    const passFail = Boolean(info?.grade_option && (info.grade_option.is_pass_fail || info.grade_option.never_graded))

    const coreqs = [...new Set([...idList(info?.co_reqs, id), ...(s?.coreqs ?? []).filter((c) => c !== id)])].sort()
    // Stellic's equivalents and SOC's cross-listings both include courses that only overlap or meet together
    // (21-241 and 21-341; Intermediate French I and II): keep the ones whose titles name the same course. A course
    // whose title we don't know (a retired number) gets the benefit of the doubt.
    const title = cleanText(info?.name) ?? s?.title
    const titleOf = (other: string) => cleanText(infos.get(other)?.name) ?? soc[other]?.title
    const same = (other: string, name?: string) => {
      const t = cleanText(name) ?? titleOf(other)
      const ok = !title || !t || sameCourseTitle(title, t)
      if (!ok) stats.relatedDropped++
      return ok
    }
    const equivalents = [
      ...new Set([
        ...idList(
          (info?.equiv ?? []).filter((r) => same(toId(r.code), r.name)),
          id,
        ),
        ...(s?.crossListed ?? []).filter((c) => c !== id && isCourseId(c) && same(c)),
      ]),
    ].sort()

    const entry: CatalogEntry = {
      id,
      code: courseCode(id),
      title: cleanText(info?.name) ?? s?.title ?? courseCode(id),
      units: units !== null && units >= 0 ? units : null,
      ...(maxUnits !== null && minUnits !== null && maxUnits > minUnits ? { unitsMax: maxUnits } : {}),
      prereqs,
      ...(prereqText ? { prereqText } : {}),
      coreqs,
      antireqs: idList(info?.anti_reqs, id),
      equivalents,
      passFail,
      ...(info ? offeredFrom(info) : {}),
      ...(info?.is_repeatable ? { repeatable: true } : {}),
    }
    entries[id] = entry

    const description = cleanText(s?.description) ?? cleanText(info?.long_desc)
    if (s?.description) stats.socDescriptions++
    else if (info?.long_desc) stats.stellicDescriptions++
    const cf = info?.custom_fields ?? {}
    const profile = Object.fromEntries(
      Object.entries({
        goals: cleanText(cf.goals),
        keyTopics: cleanText(cf.key_topics),
        assessment: cleanText(cf.assessment_structure),
        resources: cleanText(cf.learning_resources),
        background: cleanText(cf.prerequisite_knowledge),
        relevance: cleanText(cf.relevance),
      }).filter(([, v]) => v),
    )
    const attributes = [...new Set((info?.attributes ?? []).map((a) => cleanText(a.name)).filter((x): x is string => Boolean(x)))]
    const website = cleanText(info?.website) ?? s?.urls?.find((u) => !/^https?:\/\/www\.[a-z]+\.cmu\.edu\/?$/i.test(u))
    const d: CatalogDetails = {
      ...(description ? { description } : {}),
      ...(website ? { website } : {}),
      ...(attributes.length ? { attributes } : {}),
      ...(Object.keys(profile).length ? { profile } : {}),
      ...(s?.notes ? { notes: s.notes } : {}),
      ...(s?.permission ? { permissionRequired: true } : {}),
    }
    if (Object.keys(d).length) (details[id.slice(0, 2)] ??= {})[id] = d
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(join(outDir, 'details'), { recursive: true })
  const index: CatalogIndex = { generatedAt: new Date().toISOString(), courses: entries }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  for (const [prefix, chunk] of Object.entries(details)) writeFileSync(join(outDir, 'details', `${prefix}.json`), JSON.stringify(chunk))

  mkdirSync(derivedDir, { recursive: true })
  const passFail = Object.values(entries)
    .filter((e) => e.passFail)
    .map((e) => e.id)
  writeFileSync(join(derivedDir, 'pass-fail.json'), JSON.stringify(passFail, null, 0) + '\n')

  const n = Object.keys(entries).length
  console.log(
    `catalog: ${n} courses; prerequisites from Stellic trees ${stats.tree}, parsed SOC text ${stats.socText}, text only ${stats.textOnly}, none ${stats.none}; ` +
      `descriptions SOC ${stats.socDescriptions}, Stellic ${stats.stellicDescriptions}; pass/fail ${passFail.length}; ` +
      `equivalents dropped as only related ${stats.relatedDropped}`,
  )
}

await main()
