// Normalizes Stellic degree-program audit versions (ScottyLabs export) into requirement trees.
// Reads <scottylabsDir>/exported/*/programs/<catalogId>/<auditId>.json
// Writes public/data/programs/index.json (ProgramsIndex) and public/data/programs/<auditId>.json (ProgramVersion).
// Usage: node scripts/build-programs.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AttachedProgram, ConcentrationInfo, CountRule, DoubleCountRule, GroupRule, PoolSet, ProgramVersion, ReqNode } from '../src/lib/degree-types.ts'
import type { ProgramInfo, ProgramKind, ProgramsIndex, ProgramVersionInfo } from '../src/lib/plan-types.ts'
import { publicDataDir, scottylabsDir } from './lib/common.ts'

// ---------------------------------------------------------------------------
// Raw Stellic shapes (only the parts we read)

interface RawConstraint {
  type: string
  type_string?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

interface RawNode {
  id: number
  screen_name: string
  constraints?: RawConstraint[]
  choices?: RawNode[]
  is_concentration?: boolean
}

interface RawProgram {
  audit_id: number
  audit_name: string
  catalog_id: number
  program_name: string
  program_type: number
  program_reqs?: { concentrations?: { id: number; name: string }[] } | null
  tree: RawNode
}

const KINDS: Record<number, ProgramKind> = { 1: 'major', 2: 'minor', 3: 'additional-major', 4: 'requirements', 5: 'track' }

/** Course-number prefixes per CMU college, for Stellic "schools" course sets. */
const SCHOOL_PREFIXES: Record<string, string[]> = {
  'Carnegie Institute of Technology': ['06', '12', '14', '18', '19', '24', '27', '39', '42', '49'],
  'School of Computer Science': ['02', '05', '07', '08', '10', '11', '15', '16', '17'],
  'David A. Tepper School of Business': ['45', '46', '47', '70'],
  'Mellon College of Science': ['03', '09', '21', '33', '38'],
  'Carnegie Mellon University': ['99'],
  'College of Fine Arts': ['48', '51', '52', '53', '54', '57', '60', '62'],
  'Dietrich College of H&SS': ['36', '65', '66', '67', '73', '76', '79', '80', '82', '84', '85', '86', '88'],
  'H. John Heinz III College': ['90', '91', '92', '93', '94', '95'],
}

const CAMPUSES = ['Pittsburgh', 'Doha', 'Qatar', 'Africa', 'Rwanda', 'Kigali', 'Silicon Valley', 'Lisbon', 'Adelaide', 'Los Angeles', 'New York', 'Washington']

// ---------------------------------------------------------------------------
// Course codes, ranges and patterns

/** "15-122" → "15122"; null for anything that isn't a plain course code. */
function courseId(code: string): string | null {
  const m = /^(\d{2})-?(\d{3})$/.exec(code.trim())
  return m ? m[1] + m[2] : null
}

const WILD = /[*xX]/

/** "15-3**", "XX-4**", "99-x9x" → regex source over five-digit ids. */
function patternSource(code: string): string | null {
  const m = /^([0-9*xX]{2})-([0-9*xX]{1,4})$/.exec(code.trim())
  if (!m) return null
  const num = (m[2] + '***').slice(0, 3)
  const chars = (m[1] + num).split('').map((c) => (WILD.test(c) ? '\\d' : c))
  return `^${chars.join('')}$`
}

/** Splits a code into (dept, lo-number, hi-number) for range ends, expanding wildcards. */
function rangeEnd(code: string, high: boolean): { dept: string | null; num: number } | null {
  const m = /^([0-9*xX]{2})-([0-9*xX]{1,4})$/.exec(code.trim())
  if (!m) return null
  const dept = WILD.test(m[1]) ? null : m[1]
  const digits = m[2].slice(0, 3).padEnd(3, high ? '9' : '0')
  return { dept, num: Number(digits.replace(/[*xX]/g, high ? '9' : '0')) }
}

function rangeToSet(lo: string, hi: string, set: PoolSet): boolean {
  const a = rangeEnd(lo, false)
  const b = rangeEnd(hi, true)
  if (!a || !b) return false
  if (!a.dept || !b.dept) {
    ;(set.anyDeptRanges ??= []).push([a.num, b.num])
  } else {
    ;(set.ranges ??= []).push([a.dept + String(a.num).padStart(3, '0'), b.dept + String(b.num).padStart(3, '0')])
  }
  return true
}

function addCodes(set: PoolSet, codes: string[]) {
  for (const code of codes) {
    const id = courseId(code)
    if (id) {
      set.courses ??= []
      if (!set.courses.includes(id)) set.courses.push(id)
    } else {
      const src = patternSource(code)
      if (src) (set.patterns ??= []).push(src)
    }
  }
}

function addPatterns(set: PoolSet, patterns: string[]) {
  for (const p of patterns) {
    // "15-***" is a whole department; keep those as prefixes (cheaper and clearer).
    const dept = /^(\d{2})-[*xX]{3,4}$/.exec(p.trim())
    if (dept) {
      ;(set.depts ??= []).push(dept[1])
      continue
    }
    if (/^[*xX]{2}-[*xX]{3,4}$/.test(p.trim())) {
      set.any = true
      continue
    }
    const src = patternSource(p)
    if (src) (set.patterns ??= []).push(src)
  }
}

/** Stellic { semester: 1 fall | 2 spring | 3 summer, year } → "F22". */
function usemTerm(u: { semester?: number | null; year?: number | null } | null | undefined): string | undefined {
  if (!u || !u.year || !u.semester) return undefined
  const season = u.semester === 1 ? 'F' : u.semester === 2 ? 'S' : 'M'
  return `${season}${String(u.year % 100).padStart(2, '0')}`
}

function timeframeWindow(tf: { start_term?: number | null; start_year?: number | null; end_term?: number | null; end_year?: number | null } | null): { from?: string; to?: string } {
  if (!tf) return {}
  return { from: usemTerm({ semester: tf.start_term, year: tf.start_year }), to: usemTerm({ semester: tf.end_term, year: tf.end_year }) }
}

function isEmptySet(s: PoolSet): boolean {
  return !s.any && !s.courses?.length && !s.ranges?.length && !s.anyDeptRanges?.length && !s.depts?.length && !s.patterns?.length
}

let unknownPatterns = 0

/** Stellic conditional_course_sets → PoolSets (dropping empty ones). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function courseSets(raw: any[]): PoolSet[] {
  const out: PoolSet[] = []
  for (const s of raw ?? []) {
    const set: PoolSet = {}
    addCodes(set, s.courses ?? [])
    for (const [lo, hi] of s.code_ranges ?? []) if (!rangeToSet(lo, hi, set)) unknownPatterns++
    addPatterns(set, s.code_patterns ?? [])
    for (const school of s.schools ?? []) for (const p of SCHOOL_PREFIXES[school.name] ?? []) (set.depts ??= []).push(p)
    const win = timeframeWindow(s.timeframe)
    if (win.from) set.from = win.from
    if (win.to) set.to = win.to
    if (s.is_excluded) continue
    if (!isEmptySet(set)) out.push(set)
  }
  return out
}

// ---------------------------------------------------------------------------
// Node normalization

interface BuildContext {
  doubleCount: DoubleCountRule[]
  programName: (catalogId: number) => string
  notesSeen: Map<string, number>
}

/** Constraint types that only affect Stellic's display or GPA bookkeeping. */
const SILENT = new Set(['course', 'coursesection', 'customgpa', 'excludegpa', 'computationorder', 'checkfromreference'])

function groupRule(c: RawConstraint, childCount: number): GroupRule {
  const x = Number(c.data?.x ?? 1)
  if (c.data?.is_and) return { kind: 'all' }
  if (x <= 1) return { kind: 'any' }
  if (x >= childCount) return { kind: 'all' }
  return { kind: 'atLeast', n: x }
}

function normalize(raw: RawNode, ctx: BuildContext, isRoot = false): ReqNode {
  const kids = raw.choices ?? []
  const node: ReqNode = { id: raw.id, name: raw.screen_name.trim(), rule: { kind: 'all' }, children: [], notes: [] }
  const note = (c: RawConstraint) => {
    const text = (c.type_string ?? c.type).replace(/\s+/g, ' ').trim()
    if (text && !node.notes.includes(text)) node.notes.push(text)
    ctx.notesSeen.set(c.type, (ctx.notesSeen.get(c.type) ?? 0) + 1)
  }
  const pool: CountRule[] = []

  for (const c of raw.constraints ?? []) {
    const d = c.data ?? {}
    switch (c.type) {
      case 'course': {
        const id = courseId(d.course?.code ?? '')
        if (id) node.course = { id, ...(node.course?.section ? { section: node.course.section } : {}) }
        break
      }
      case 'coursesection': {
        const id = courseId(d.course?.code ?? '')
        if (id) node.course = { id, ...(d.section ? { section: String(d.section) } : {}) }
        break
      }
      case 'anyxof':
        node.rule = groupRule(c, kids.length)
        break
      case 'minxunits':
        if (d.is_each) node.minUnitsEach = Number(d.units)
        else node.minUnits = Math.max(node.minUnits ?? 0, Number(d.units))
        break
      case 'minxcourses':
        node.minCourses = Math.max(node.minCourses ?? 0, Number(d.x))
        break
      case 'xfromcourseset': {
        const sets = courseSets(d.conditional_course_sets)
        const x = Number(d.x ?? 0)
        const units = Boolean(d.is_units)
        if (!sets.length) {
          if (x > 0) note(c)
          break
        }
        if (d.inverse && x === 0) {
          ;(node.exclude ??= []).push(...sets)
        } else if (d.is_atmost) {
          ;(node.caps ??= []).push({ sets, units, max: x, ...(d.inverse ? { inverse: true } : {}) })
        } else {
          pool.push({ sets, units, ...(x > 0 ? { min: x } : {}), ...(d.is_exact && x > 0 ? { max: x } : {}), ...(d.inverse ? { inverse: true } : {}) })
        }
        break
      }
      case 'coderange': {
        const set: PoolSet = {}
        rangeToSet(d.code_start, d.code_end, set)
        addCodes(set, d.additional_courses ?? [])
        const x = Number(d.x ?? 0)
        if (!isEmptySet(set)) pool.push({ sets: [set], units: false, ...(x > 0 ? { min: x } : {}) })
        break
      }
      case 'xfromdepts': {
        const set: PoolSet = {}
        for (const dep of d.depts ?? []) if (/^\d{2}$/.test(String(dep.code))) (set.depts ??= []).push(String(dep.code))
        for (const school of d.schools ?? []) for (const p of SCHOOL_PREFIXES[school.name] ?? []) (set.depts ??= []).push(p)
        addCodes(set, d.additional_courses ?? [])
        const x = Number(d.x ?? 0)
        if (isEmptySet(set)) note(c)
        else pool.push({ sets: [set], units: Boolean(d.is_units), ...(x > 0 ? { min: x } : {}) })
        break
      }
      case 'xfromallcourses': {
        const x = Number(d.x ?? 0)
        pool.push({ sets: [{ any: true }], units: false, ...(x > 0 ? { min: x } : {}) })
        break
      }
      case 'notcountcourseset': {
        const set: PoolSet = {}
        addCodes(set, d.courses ?? [])
        for (const [lo, hi] of d.code_ranges ?? []) rangeToSet(lo, hi, set)
        addPatterns(set, d.code_patterns ?? [])
        if (!isEmptySet(set)) (node.exclude ??= []).push(set)
        break
      }
      case 'mingrade':
        if (d.grade) node.minGrade = String(d.grade)
        break
      case 'cancountungraded':
        node.allowPassFail = true
        break
      case 'repeatx': {
        const id = courseId(d.course?.code ?? '')
        if (id) node.repeat = { courses: [id], times: Number(d.x ?? 1), sameCourse: true }
        break
      }
      case 'repeatxcourses': {
        const ids = (d.courses ?? []).map((x: { code: string }) => courseId(x.code)).filter(Boolean) as string[]
        if (ids.length) node.repeat = { courses: ids, times: Number(d.x ?? 1), sameCourse: Boolean(d.same_course) }
        break
      }
      case 'notcountbeforeusem': {
        const from = usemTerm(d.usem)
        const to = usemTerm(d.end_usem)
        if (from || to) node.window = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
        else note(c)
        break
      }
      case 'noncourse':
        node.manual = true
        note(c)
        break
      case 'staticonly':
        if (d.name !== 'OTHERS_MAY_COUNT' && !kids.length) node.manual = true
        note(c)
        break
      case 'alwayshide':
        if (d.hide_unless_attempted) node.onlyIfAttempted = true
        break
      case 'dc': {
        const limit = Number(d.limit ?? 0)
        const units = Boolean(d.is_units)
        if (d.for_subrequirement || !isRoot) {
          // "… with other requirements" / "… within the following subrequirements": sharing inside this program.
          if (limit > 0) node.shareWithin = { limit, units }
        } else {
          const programs = (d.scope_programs ?? []).map((p: { id: number }) => p.id) as number[]
          const kind = d.scope_program_type != null ? KINDS[Number(d.scope_program_type)] : undefined
          ctx.doubleCount.push({
            programs,
            ...(kind ? { kinds: [kind] } : {}),
            programNames: (d.scope_programs ?? []).map((p: { id: number; name: string }) => p.name ?? ctx.programName(p.id)),
            limit,
            units,
            exceptions: (d.specific_subrequirements ?? []).map((s: { requirements: number[]; limit: number; is_units: boolean }) => ({
              nodes: s.requirements ?? [],
              limit: Number(s.limit ?? 0),
              units: Boolean(s.is_units),
            })),
          })
        }
        break
      }
      case 'programdependentanyxof': {
        const programs = (d.scope_programs ?? []).map((p: { id: number }) => p.id) as number[]
        if (programs.length && !d.is_inverse && !(d.concentrations ?? []).length && !(d.student_tags ?? []).length) {
          ;(node.programDependent ??= []).push({ programs, children: d.subrequirements ?? [], include: Boolean(d.is_include) })
        }
        note(c)
        break
      }
      default:
        if (!SILENT.has(c.type)) note(c)
    }
  }

  if (kids.length) {
    node.children = kids.map((k) => normalize(k, ctx))
    if (pool.length) node.conditions = pool
  } else if (!node.course) {
    if (pool.length) node.pool = pool
    else if ((node.minUnits || node.minCourses) && !node.repeat) node.pool = [{ sets: [{ any: true }], units: false }]
    else if (!node.repeat && !node.manual) {
      // An empty placeholder: nothing to evaluate. Keep it visible as a manual check.
      node.manual = true
    }
  }
  return node
}

// ---------------------------------------------------------------------------
// Version metadata

function entryYearOf(...names: string[]): number | null {
  for (const n of names) {
    const m = /EY\s?(\d{4})/i.exec(n) ?? /\((\d{4})\)/.exec(n)
    if (m) return Number(m[1])
  }
  return null
}

function campusOf(...names: string[]): string | null {
  for (const n of names) for (const c of CAMPUSES) if (n.includes(c)) return c === 'Qatar' ? 'Doha' : c
  return null
}

function versionName(raw: RawProgram): string {
  const a = raw.audit_name.trim()
  if (a && a.toLowerCase() !== 'published') {
    // "EY2025 Pittsburgh - BS in Computer Science" → "EY2025 Pittsburgh"
    const short = a.split(/\s+-\s+/)[0].trim()
    return short || a
  }
  const year = entryYearOf(raw.program_name)
  return year ? `EY${year}` : 'Current'
}

function isDeleted(raw: RawProgram): boolean {
  return /^\s*DELETE\b/i.test(raw.program_name) || /^\s*DELETE\b/i.test(raw.audit_name)
}

// ---------------------------------------------------------------------------
// Main

function findExportDirs(): string[] {
  const exported = join(scottylabsDir(), 'exported')
  if (!existsSync(exported)) return []
  return readdirSync(exported)
    .map((d) => join(exported, d, 'programs'))
    .filter((d) => existsSync(d) && statSync(d).isDirectory())
}

function main() {
  const dirs = findExportDirs()
  const outDir = join(publicDataDir, 'programs')
  if (!dirs.length) {
    console.log(`programs: no Stellic program exports under ${join(scottylabsDir(), 'exported')}; skipping`)
    return
  }

  // Newest file wins when several exports have the same audit version.
  const files = new Map<number, { path: string; mtime: number }>()
  for (const dir of dirs) {
    for (const cat of readdirSync(dir)) {
      const catDir = join(dir, cat)
      if (!statSync(catDir).isDirectory()) continue
      for (const f of readdirSync(catDir)) {
        if (!f.endsWith('.json')) continue
        const auditId = Number(f.replace(/\.json$/, ''))
        const path = join(catDir, f)
        const mtime = statSync(path).mtimeMs
        const prev = files.get(auditId)
        if (!prev || prev.mtime < mtime) files.set(auditId, { path, mtime })
      }
    }
  }

  const raws: RawProgram[] = []
  for (const { path } of files.values()) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as RawProgram
    if (!isDeleted(raw)) raws.push(raw)
  }

  // Index first: needed to resolve attached programs and concentrations.
  const infos = new Map<number, ProgramInfo>()
  for (const raw of raws) {
    let info = infos.get(raw.catalog_id)
    if (!info) {
      info = { catalogId: raw.catalog_id, name: raw.program_name.trim(), kind: KINDS[raw.program_type] ?? 'requirements', versions: [] }
      infos.set(raw.catalog_id, info)
    }
    info.versions.push({
      auditId: raw.audit_id,
      name: versionName(raw),
      entryYear: entryYearOf(raw.audit_name, raw.program_name),
      campus: campusOf(raw.audit_name, raw.program_name),
    })
  }
  for (const info of infos.values()) {
    info.versions.sort(
      (a, b) =>
        (b.entryYear ?? 0) - (a.entryYear ?? 0) ||
        Number(b.campus === 'Pittsburgh') - Number(a.campus === 'Pittsburgh') ||
        b.auditId - a.auditId,
    )
  }

  const pickVersion = (catalogId: number, entryYear: number | null, campus: string | null): ProgramVersionInfo | null => {
    const versions = infos.get(catalogId)?.versions ?? []
    if (!versions.length) return null
    const sameCampus = versions.filter((v) => !campus || !v.campus || v.campus === campus)
    const pool = sameCampus.length ? sameCampus : versions
    if (entryYear !== null) {
      const fit = pool.find((v) => v.entryYear !== null && v.entryYear <= entryYear)
      if (fit) return fit
    }
    return pool[0]
  }

  const requirementBundles = [...infos.values()].filter((i) => i.kind === 'requirements')
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2 && !['and', 'the', 'for', 'concentration', 'requirements', 'track'].includes(t)),
    )

  const concentrationsFor = (raw: RawProgram, entryYear: number | null, campus: string | null): ConcentrationInfo[] => {
    const parentTokens = tokens(raw.program_name)
    return (raw.program_reqs?.concentrations ?? []).map((c) => {
      const want = c.name.toLowerCase()
      const scored = requirementBundles
        .filter((b) => b.name.toLowerCase().includes(want))
        .map((b) => {
          const name = b.name.toLowerCase()
          let score = 0
          if (/concentration|track/.test(name)) score += 3
          for (const t of tokens(b.name)) if (parentTokens.has(t)) score += 1
          if (/^ey\d{4}/.test(name) && entryYear) score += 0
          return { b, score }
        })
        .sort((x, y) => y.score - x.score || x.b.name.localeCompare(y.b.name))
        .slice(0, 3)
      return {
        id: c.id,
        name: c.name,
        programs: scored
          .map(({ b }) => {
            const v = pickVersion(b.catalogId, entryYear, campus)
            return v ? { catalogId: b.catalogId, auditId: v.auditId, name: b.name } : null
          })
          .filter((x): x is { catalogId: number; auditId: number; name: string } => x !== null),
      }
    })
  }

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const notesSeen = new Map<string, number>()
  let bytes = 0
  for (const raw of raws) {
    const ctx: BuildContext = { doubleCount: [], programName: (id) => infos.get(id)?.name ?? `Program ${id}`, notesSeen }
    const root = normalize(raw.tree, ctx, true)
    const info = infos.get(raw.catalog_id)!
    const vinfo = info.versions.find((v) => v.auditId === raw.audit_id)!

    // Root "at least N units" is the degree total; keep it off the node so it isn't double-reported.
    const totalUnits = root.minUnits ?? null
    if (info.kind === 'major' || info.kind === 'additional-major') delete root.minUnits

    const attached: AttachedProgram[] = []
    for (const rule of ctx.doubleCount) {
      rule.programs.forEach((id, i) => {
        const target = infos.get(id)
        const isBundle = target ? target.kind === 'requirements' : /general education|degree check|core requirements/i.test(rule.programNames[i] ?? '')
        if (!isBundle || attached.some((a) => a.catalogId === id)) return
        const v = target ? pickVersion(id, vinfo.entryYear, vinfo.campus) : null
        attached.push({ catalogId: id, name: target?.name ?? rule.programNames[i] ?? `Program ${id}`, auditId: v?.auditId ?? null })
      })
    }

    const version: ProgramVersion = {
      auditId: raw.audit_id,
      catalogId: raw.catalog_id,
      programName: info.name,
      name: vinfo.name,
      kind: info.kind,
      entryYear: vinfo.entryYear,
      campus: vinfo.campus,
      totalUnits,
      attached,
      doubleCount: ctx.doubleCount,
      concentrations: concentrationsFor(raw, vinfo.entryYear, vinfo.campus),
      root,
    }
    const json = JSON.stringify(version)
    bytes += json.length
    writeFileSync(join(outDir, `${raw.audit_id}.json`), json)
  }

  const index: ProgramsIndex = {
    generatedAt: new Date().toISOString(),
    programs: [...infos.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
  const indexJson = JSON.stringify(index)
  writeFileSync(join(outDir, 'index.json'), indexJson)

  const kinds = new Map<ProgramKind, number>()
  for (const p of infos.values()) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)
  console.log(
    `programs: ${infos.size} programs, ${raws.length} versions (${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}); ` +
      `index ${(indexJson.length / 1024).toFixed(0)} KB, trees ${(bytes / 1024 / 1024).toFixed(1)} MB total`,
  )
  if (unknownPatterns) console.log(`programs: ${unknownPatterns} course ranges couldn't be parsed`)
  if (process.argv.includes('--verbose')) console.log('noted constraint types:', Object.fromEntries(notesSeen))
}

main()
