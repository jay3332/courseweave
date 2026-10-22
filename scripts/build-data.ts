// Builds public/data/<TERM>.json for every term in data/terms.json, plus public/data/terms.json.
// Each term lists one or more sources (see scripts/sources/types.ts); the first is primary.
// Usage: npm run data   (or: node scripts/build-data.ts [TERM ...] to rebuild only some terms)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Course, Section, TermData, TermIndexEntry, TermMeta } from '../src/lib/types.ts'
import { DATA_INPUT_PATHS, dataDir, derivedDir, finalizeCourse, meetingKey, publicDataDir, root, scottylabsDir } from './lib/common.ts'
import { mergeSupplement } from './lib/merge.ts'
import { csvSource } from './sources/csv.ts'
import { socSource } from './sources/soc.ts'
import { stellicSource } from './sources/stellic.ts'
import type { SourceAdapter, SourceConfig } from './sources/types.ts'

const ADAPTERS: Record<string, SourceAdapter> = { csv: csvSource, soc: socSource, stellic: stellicSource }

interface TermConfig extends Omit<TermMeta, 'sources'> {
  sources: SourceConfig[]
}

/** Course ids graded pass/fail only (non-factorable units), written by build-catalog. */
function readPassFail(): Set<string> {
  const path = join(derivedDir, 'pass-fail.json')
  return new Set(existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as string[]) : [])
}

/** Lectures first in source order, each followed by its child sections; orphans become top-level. */
function orderSections(sections: Section[]): Section[] {
  const names = new Set(sections.map((s) => s.name))
  for (const s of sections) if (s.parent !== null && !names.has(s.parent)) s.parent = null
  const out: Section[] = []
  for (const top of sections.filter((s) => s.parent === null)) {
    out.push(top, ...sections.filter((s) => s.parent === top.name))
  }
  return out
}

/** Courses with a section meeting at exactly the same scheduled times in the same real room. */
function detectCrossListings(courses: Course[]) {
  const bySignature = new Map<string, Set<string>>()
  for (const c of courses) {
    for (const s of c.sections) {
      if (s.parent !== null) continue
      const located = s.meetings.filter((m) => m.days.length && m.start !== null && m.building && m.room)
      if (!located.length || located.length !== s.meetings.length) continue
      const sig = `${s.mini}#` + located.map(meetingKey).sort().join(';')
      const set = bySignature.get(sig) ?? new Set()
      set.add(c.id)
      bySignature.set(sig, set)
    }
  }
  const byId = new Map(courses.map((c) => [c.id, c]))
  for (const ids of bySignature.values()) {
    if (ids.size < 2 || ids.size > 6) continue
    for (const id of ids) {
      const course = byId.get(id)!
      for (const other of ids) {
        const o = byId.get(other)!
        const sharesInstructor = !course.instructors.length || course.instructors.some((n) => o.instructors.includes(n))
        if (other !== id && sharesInstructor && !course.crossListed.includes(other)) course.crossListed.push(other)
      }
    }
  }
  for (const c of courses) c.crossListed.sort()
}

async function buildTerm(config: TermConfig, passFail: Set<string>): Promise<TermData> {
  const { sources, ...term } = config
  const ctx = { dataDir, scottylabsDir: scottylabsDir() }
  const merged = new Map<string, Course>()

  for (const [i, source] of sources.entries()) {
    const adapter = ADAPTERS[source.type]
    if (!adapter) throw new Error(`${term.id}: unknown source type "${source.type}"`)
    const courses = await adapter(source, term, ctx)
    const role = source.role ?? (i === 0 ? 'primary' : 'supplement')
    if (role === 'primary') {
      if (i !== 0) throw new Error(`${term.id}: only the first source can be primary`)
      for (const c of courses) merged.set(c.id, c)
    } else {
      mergeSupplement(merged, courses, source.addMissingCourses === true, source.addMissingSections !== false)
    }
    console.log(`  ${term.id} ${source.type} (${role}): ${courses.length} courses`)
  }

  const courses = [...merged.values()]
  for (const c of courses) {
    c.sections = orderSections(c.sections)
    finalizeCourse(c)
    c.crossListed = []
    if (passFail.has(c.id)) c.passFail = true
    else delete c.passFail
  }
  detectCrossListings(courses)
  courses.sort((a, b) => a.id.localeCompare(b.id))

  // Flag thin data instead of silently showing blanks (e.g. SOC without the Stellic supplement).
  const notes = [...(term.notes ?? [])]
  const sections = courses.flatMap((c) => c.sections)
  const withInstructors = sections.filter((s) => s.instructors.length).length
  if (sections.length && withInstructors / sections.length < 0.05) notes.push("Instructors and rooms aren't listed for this term.")
  if (sections.some((s) => s.kind === 'lecture') && !sections.some((s) => s.parent !== null)) {
    notes.push("Recitation and lab sections aren't available for this term yet; only lectures and standalone sections are listed.")
  }
  return { term: { ...term, notes: notes.length ? notes : undefined, sources: sources.map((s) => s.type) }, generatedAt: new Date().toISOString(), courses }
}

const only = process.argv.slice(2)
const configs: TermConfig[] = JSON.parse(readFileSync(join(dataDir, 'terms.json'), 'utf8'))
mkdirSync(publicDataDir, { recursive: true })
const passFail = readPassFail()

const index: TermIndexEntry[] = []
for (const config of configs) {
  const outPath = join(publicDataDir, `${config.id}.json`)
  let data: TermData
  if (only.length && !only.includes(config.id) && existsSync(outPath)) {
    data = JSON.parse(readFileSync(outPath, 'utf8'))
  } else {
    data = await buildTerm(config, passFail)
    writeFileSync(outPath, JSON.stringify(data))
  }
  const sectionCount = data.courses.reduce((n, c) => n + c.sections.length, 0)
  index.push({ ...data.term, courseCount: data.courses.length, sectionCount })
  console.log(`${data.term.id}: ${data.courses.length} courses, ${sectionCount} sections`)
}

// Newest term first.
const seasonOrder = { spring: 0, summer: 1, fall: 2 }
index.sort((a, b) => b.year - a.year || seasonOrder[b.season] - seasonOrder[a.season])
writeFileSync(join(publicDataDir, 'terms.json'), JSON.stringify(index, null, 2))

// Which commit of the data inputs this build reflects, so the weekly data check can tell when merged updates aren't
// deployed yet. `dirty` marks builds with uncommitted input changes.
try {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const dataCommit = git('log', '-1', '--format=%H', '--', ...DATA_INPUT_PATHS)
  const dirty = git('status', '--porcelain', '--', ...DATA_INPUT_PATHS) !== ''
  writeFileSync(join(publicDataDir, 'build.json'), JSON.stringify({ dataCommit, dirty }))
} catch {
  // Not a git checkout: no build marker.
}
