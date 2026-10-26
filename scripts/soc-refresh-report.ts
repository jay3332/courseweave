// After `node scripts/fetch-soc.ts` (run by the weekly data workflow): keeps only real changes under data/raw/soc and
// writes a Markdown summary of what changed, course by course.
//
//   node scripts/soc-refresh-report.ts [--out summary.md]
//
// - A cached page whose only difference is the SOC's "last updated" stamp is restored, as is a meta.json (fetch
//   time) when nothing else in its term changed, so a quiet week leaves the tree clean.
// - Each remaining term is parsed before and after (with the same adapter the build uses) to list added, removed
//   and changed courses. A term whose pages changed without changing any course is restored too.
// - A configured term the SOC now lists but data/terms.json builds from something else (e.g. Spring 2027 from a CSV
//   before the SOC published it) is switched to the SOC as its primary source, keeping its Stellic supplement.
//   Terms not in data/terms.json at all are called out (adding one needs its academic calendar dates).
// Prints `changed=true|false` to $GITHUB_OUTPUT when set.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import type { Course, TermMeta } from '../src/lib/types.ts'
import { dataDir, root } from './lib/common.ts'
import { socSource } from './sources/soc.ts'
import type { SourceConfig } from './sources/types.ts'

const { values } = parseArgs({ options: { out: { type: 'string' } } })
const SOC_DIR = 'data/raw/soc'
/** Most courses listed per change type and term; the rest are counted. */
const LIST_LIMIT = 40

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const gitBuffer = (...args: string[]) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** The cached page with the SOC's per-day "last updated" stamp removed. */
function normalized(gz: Buffer): string {
  return gunzipSync(gz)
    .toString('utf8')
    .replace(/last updated:[^<\n]*/gi, '')
}

const inHead = (path: string) => {
  try {
    git('cat-file', '-e', `HEAD:${path}`)
    return true
  } catch {
    return false
  }
}

// ---- 1. Drop changes that are only the "last updated" stamp or the fetch time ----

const changedPaths = () =>
  git('status', '--porcelain', '--untracked-files=all', SOC_DIR)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3))

for (const path of changedPaths()) {
  if (!path.endsWith('.gz') || !inHead(path) || !existsSync(join(root, path))) continue
  if (normalized(gitBuffer('show', `HEAD:${path}`)) === normalized(readFileSync(join(root, path)))) git('checkout', '--', path)
}
const termOf = (path: string) => path.slice(SOC_DIR.length + 1).split('/')[0]
const remaining = changedPaths()
for (const term of new Set(remaining.map(termOf))) {
  const files = remaining.filter((p) => termOf(p) === term)
  const metaPath = `${SOC_DIR}/${term}/meta.json`
  if (files.length === 1 && files[0] === metaPath && inHead(metaPath)) git('checkout', '--', metaPath)
}

// ---- 2. Compare each changed term before and after ----

const terms = JSON.parse(readFileSync(join(dataDir, 'terms.json'), 'utf8')) as (Omit<TermMeta, 'sources'> & { sources: SourceConfig[] })[]
const socTermIds = new Set(terms.flatMap((t) => t.sources.filter((s) => s.type === 'soc').map((s) => s.term ?? t.id)))
const changedTerms = [...new Set(changedPaths().map(termOf))].sort()

function termMeta(id: string): TermMeta {
  const known = terms.find((t) => t.id === id)
  if (known) return { ...known, sources: known.sources.map((s) => s.type) }
  const season = id[0] === 'F' ? 'fall' : id[0] === 'S' ? 'spring' : 'summer'
  return { id, name: id, season, year: 2000 + Number(id.slice(1)), minis: [], classesBegin: '', classesEnd: '', noClasses: [] }
}

/** Courses parsed from a data/ directory's cached SOC pages for one term. */
async function load(dir: string, term: string): Promise<Map<string, Course>> {
  const courses = await socSource({ type: 'soc' }, termMeta(term), { dataDir: dir, scottylabsDir: '' })
  return new Map(courses.map((c) => [c.id, c]))
}

/** The committed version of a term's cache, extracted into a scratch data/ directory. */
function headCopy(term: string): string | null {
  let files: string[]
  try {
    files = git('ls-tree', '--name-only', `HEAD:${SOC_DIR}/${term}`).split('\n').filter(Boolean)
  } catch {
    return null // a semester new to the cache
  }
  if (!files.length) return null
  const dir = mkdtempSync(join(tmpdir(), 'soc-head-'))
  for (const f of files) {
    const out = join(dir, 'raw', 'soc', term, f)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, gitBuffer('show', `HEAD:${SOC_DIR}/${term}/${f}`))
  }
  return dir
}

const code = (id: string) => `${id.slice(0, 2)}-${id.slice(2)}`
const sectionKey = (c: Course) =>
  JSON.stringify(
    c.sections.map((s) => [s.name, s.instructors, s.meetings.map((m) => [m.days, m.start, m.end, m.building, m.room])]).sort(),
  )

function describe(before: Course, after: Course): string {
  const parts: string[] = []
  const names = (c: Course) => new Set(c.sections.map((s) => s.name))
  const added = [...names(after)].filter((n) => !names(before).has(n))
  const removed = [...names(before)].filter((n) => !names(after).has(n))
  if (added.length) parts.push(`added ${added.join(', ')}`)
  if (removed.length) parts.push(`removed ${removed.join(', ')}`)
  if (before.title !== after.title) parts.push('title')
  if (before.units !== after.units) parts.push(`units ${before.units ?? 'var'} → ${after.units ?? 'var'}`)
  if (!!before.permissionRequired !== !!after.permissionRequired) parts.push(after.permissionRequired ? 'now needs special permission' : 'no longer needs special permission')
  const same = after.sections.filter((s) => names(before).has(s.name))
  const was = (s: Course['sections'][number]) => before.sections.find((b) => b.name === s.name)!
  const withoutReservations = (s: Course['sections'][number]) => JSON.stringify({ ...s, reservations: undefined })
  if (!parts.length || sectionKey(before) !== sectionKey(after)) {
    const changedSections = same.filter((s) => withoutReservations(s) !== withoutReservations(was(s)))
    if (changedSections.length) parts.push(`times, rooms or instructors (${changedSections.map((s) => s.name).join(', ')})`)
  }
  const reserved = same.filter((s) => JSON.stringify(s.reservations ?? []) !== JSON.stringify(was(s).reservations ?? []))
  if (reserved.length) parts.push(`reservations (${reserved.map((s) => s.name).join(', ')})`)
  return parts.join('; ')
}

const list = (items: string[]) => (items.length > LIST_LIMIT ? [...items.slice(0, LIST_LIMIT), `…and ${items.length - LIST_LIMIT} more`] : items)

const lines: string[] = []
for (const term of changedTerms) {
  const name = termMeta(term).name
  const after = await load(dataDir, term)
  const headDir = headCopy(term)
  if (!headDir) {
    lines.push(`### ${name}`, '', `New on the Schedule of Classes: ${after.size} courses.`, '')
    continue
  }
  const before = await load(headDir, term)
  rmSync(headDir, { recursive: true, force: true })
  const added = [...after.keys()].filter((id) => !before.has(id)).sort()
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort()
  const changed = [...after.keys()]
    .filter((id) => before.has(id) && JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)))
    .sort()
  if (!added.length && !removed.length && !changed.length) {
    // The pages differ, but not in anything the site shows: keep the committed copy.
    git('checkout', '--', `${SOC_DIR}/${term}`)
    continue
  }
  lines.push(`### ${name}`, '', `${after.size} courses (${added.length} added, ${removed.length} removed, ${changed.length} changed).`, '')
  if (added.length) lines.push('**Added**', '', ...list(added.map((id) => `- ${code(id)} ${after.get(id)!.title}`)), '')
  if (removed.length) lines.push('**Removed**', '', ...list(removed.map((id) => `- ${code(id)} ${before.get(id)!.title}`)), '')
  if (changed.length)
    lines.push('**Changed**', '', ...list(changed.map((id) => `- ${code(id)} ${after.get(id)!.title}: ${describe(before.get(id)!, after.get(id)!) || 'details'}`)), '')
}

// ---- 3. Terms the SOC offers that the site doesn't build from it ----

const cached = existsSync(join(root, SOC_DIR)) ? readdirSync(join(root, SOC_DIR)).filter((d) => /^[FSM]\d\d$/.test(d)) : []
const notes: string[] = []
const switched: string[] = []
for (const term of cached.filter((t) => !socTermIds.has(t)).sort()) {
  const configured = terms.find((t) => t.id === term)
  if (!configured) {
    notes.push(`- **${term}** is on the Schedule of Classes but isn't in data/terms.json. Add it (calendar dates and minis from the academic calendar) to show it on the site.`)
    continue
  }
  // The SOC is now the authority on which sections exist and when they meet (like the other terms). The earlier sources
  // only fill in instructors and rooms, so a schedule CSV that was primary stays on as a supplement.
  const [previous, ...supplements] = configured.sources
  if (previous?.type === 'csv') supplements.push({ ...previous, role: 'supplement' })
  configured.sources = [
    { type: 'soc', term },
    ...supplements.map((s) => (s.type === 'stellic' || s.type === 'csv' ? { ...s, addMissingSections: false } : s)),
  ]
  switched.push(`- **${configured.name}** is on the Schedule of Classes now, so this switches its primary source from ${previous?.type} to the SOC (its Stellic sections and schedule CSV still add instructors and rooms where the SOC has none).`)
}
if (switched.length) writeFileSync(join(dataDir, 'terms.json'), `${JSON.stringify(terms, null, 2)}\n`)

const changedAny = changedPaths().length > 0 || switched.length > 0
const summary = [
  changedAny ? '## Schedule of Classes changes' : '## No Schedule of Classes changes',
  '',
  ...(switched.length ? ['## New on the Schedule of Classes', '', ...switched, ''] : []),
  ...(changedAny ? lines : ['Every cached term matches what the SOC lists now.', '']),
  ...(notes.length ? ['## Needs attention', '', ...notes, ''] : []),
].join('\n')

if (values.out) writeFileSync(values.out, summary)
else console.log(summary)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changedAny}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
