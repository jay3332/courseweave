// Pure merge logic for cloud sync. Every merge is a union: nothing on this device is ever dropped because the
// server lacks it. Deletions aren't tracked (no tombstones), so something deleted on one device can reappear
// once from another device's copy; deleting it again sticks once both copies agree.
import type { Plan, PlanCourse, PlanTerm } from './plan'
import type { RecordEntry, StoredOverride, StudentProfile } from '../state/record'
import type { Schedule, ScheduleEntry } from '../state/store'

export interface SchedulesDoc {
  schedules: Record<string, Schedule>
  /** termId → active schedule id. */
  activeSchedule: Record<string, string>
  /** termId → bookmarked course ids. */
  bookmarks: Record<string, string[]>
}

export interface RecordDoc {
  entries: RecordEntry[]
  overrides: Record<string, StoredOverride>
  profile: StudentProfile
}

export interface PlanDoc {
  plans: Record<string, Plan>
  activePlanId: string | null
}

// ---------------------------------------------------------------------------
// Validation: server data is opaque JSON (possibly from another app version), so keep only well-formed parts.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null)

function normalizeEntry(v: unknown): ScheduleEntry | null {
  if (!isObj(v) || !isStr(v.courseId)) return null
  return {
    courseId: v.courseId,
    section: strOrNull(v.section),
    child: strOrNull(v.child),
    color: isNum(v.color) ? v.color : 0,
    hidden: v.hidden === true,
    passFail: v.passFail === true,
  }
}

function normalizeSchedule(id: string, v: unknown): Schedule | null {
  if (!isObj(v) || !isStr(v.termId)) return null
  const entries = Array.isArray(v.entries) ? v.entries.map(normalizeEntry).filter((e): e is ScheduleEntry => e !== null) : []
  return {
    id,
    termId: v.termId,
    name: isStr(v.name) ? v.name : 'Schedule',
    entries,
    createdAt: isNum(v.createdAt) ? v.createdAt : 0,
    updatedAt: isNum(v.updatedAt) ? v.updatedAt : 0,
  }
}

/**
 * Keys that would reach Object.prototype machinery when assigned with `obj[key] = …` ("__proto__" changes the
 * object's prototype). Server data is untrusted input, so these are dropped wherever it's read.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Own entries of a server object, minus prototype-polluting keys. */
function safeEntries(v: Record<string, unknown>): [string, unknown][] {
  return Object.entries(v).filter(([k]) => !UNSAFE_KEYS.has(k))
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isObj(v)) for (const [k, x] of safeEntries(v)) if (isStr(x)) out[k] = x
  return out
}

function stringListMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (isObj(v)) for (const [k, x] of safeEntries(v)) if (Array.isArray(x)) out[k] = x.filter(isStr)
  return out
}

export function normalizeSchedulesDoc(v: unknown): SchedulesDoc | null {
  if (!isObj(v)) return null
  const schedules: Record<string, Schedule> = {}
  if (isObj(v.schedules)) {
    for (const [id, s] of safeEntries(v.schedules)) {
      const n = normalizeSchedule(id, s)
      if (n) schedules[id] = n
    }
  }
  return { schedules, activeSchedule: stringMap(v.activeSchedule), bookmarks: stringListMap(v.bookmarks) }
}

function normalizeRecordEntry(v: unknown): RecordEntry | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.source)) return null
  if (!['taken', 'transfer', 'exam', 'waiver'].includes(v.source)) return null
  if (v.courseId !== null && !isStr(v.courseId)) return null
  const e: RecordEntry = { id: v.id, courseId: v.courseId, source: v.source as RecordEntry['source'], addedAt: isNum(v.addedAt) ? v.addedAt : 0 }
  if (isStr(v.term)) e.term = v.term
  if (isStr(v.grade)) e.grade = v.grade
  if (isNum(v.units)) e.units = v.units
  if (isObj(v.exam) && isStr(v.exam.id) && isStr(v.exam.score)) e.exam = { id: v.exam.id, score: v.exam.score }
  if (isStr(v.institution)) e.institution = v.institution
  if (isStr(v.label)) e.label = v.label
  if (isStr(v.note)) e.note = v.note
  return e
}

function normalizeOverride(v: unknown): StoredOverride | null {
  if (!isObj(v)) return null
  const o: StoredOverride = { updatedAt: isNum(v.updatedAt) ? v.updatedAt : 0 }
  if (v.prereqs === true) o.prereqs = true
  if (v.coreqs === true) o.coreqs = true
  if (v.antireqs === true) o.antireqs = true
  if (isStr(v.note)) o.note = v.note
  return o
}

function normalizeProfile(v: unknown): StudentProfile {
  const p: StudentProfile = {}
  if (!isObj(v)) return p
  if (isStr(v.entryTerm)) p.entryTerm = v.entryTerm
  if (isStr(v.expectedGraduation)) p.expectedGraduation = v.expectedGraduation
  if (isStr(v.college)) p.college = v.college
  if (Array.isArray(v.majors)) p.majors = v.majors.filter(isStr)
  if (Array.isArray(v.minors)) p.minors = v.minors.filter(isStr)
  if (v.level === 'undergraduate' || v.level === 'graduate') p.level = v.level
  return p
}

export function normalizeRecordDoc(v: unknown): RecordDoc | null {
  if (!isObj(v)) return null
  const entries = Array.isArray(v.entries) ? v.entries.map(normalizeRecordEntry).filter((e): e is RecordEntry => e !== null) : []
  const overrides: Record<string, StoredOverride> = {}
  if (isObj(v.overrides)) {
    for (const [id, o] of safeEntries(v.overrides)) {
      const n = normalizeOverride(o)
      if (n) overrides[id] = n
    }
  }
  return { entries, overrides, profile: normalizeProfile(v.profile) }
}

function normalizePlanCourse(v: unknown): PlanCourse | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.courseId)) return null
  const c: PlanCourse = { id: v.id, courseId: v.courseId }
  if (v.passFail === true) c.passFail = true
  if (isNum(v.units)) c.units = v.units
  return c
}

function normalizePlan(id: string, v: unknown): Plan | null {
  if (!isObj(v) || !isStr(v.startTerm)) return null
  const terms: PlanTerm[] = Array.isArray(v.terms)
    ? v.terms
        .filter((t): t is Record<string, unknown> => isObj(t) && isStr(t.term))
        .map((t) => ({
          term: t.term as string,
          courses: Array.isArray(t.courses) ? t.courses.map(normalizePlanCourse).filter((c): c is PlanCourse => c !== null) : [],
          // Keep a semester's sync with a schedule (it used to be dropped when plans arrived from another device).
          ...(isObj(t.link) && isStr(t.link.scheduleId) ? { link: { scheduleId: t.link.scheduleId } } : {}),
        }))
    : []
  const programs = Array.isArray(v.programs)
    ? v.programs
        .filter((p): p is Record<string, unknown> => isObj(p) && isNum(p.catalogId) && isNum(p.auditId))
        .map((p) => ({
          catalogId: p.catalogId as number,
          auditId: p.auditId as number,
          ...(Array.isArray(p.concentrations) ? { concentrations: p.concentrations.filter(isNum) } : {}),
        }))
    : []
  return {
    id,
    name: isStr(v.name) ? v.name : 'Plan',
    programs,
    startTerm: v.startTerm,
    terms,
    createdAt: isNum(v.createdAt) ? v.createdAt : 0,
    updatedAt: isNum(v.updatedAt) ? v.updatedAt : 0,
  }
}

export function normalizePlanDoc(v: unknown): PlanDoc | null {
  if (!isObj(v)) return null
  const plans: Record<string, Plan> = {}
  if (isObj(v.plans)) {
    for (const [id, p] of safeEntries(v.plans)) {
      const n = normalizePlan(id, p)
      if (n) plans[id] = n
    }
  }
  return { plans, activePlanId: isStr(v.activePlanId) ? v.activePlanId : null }
}

// ---------------------------------------------------------------------------
// Merges. `local` is this device; `remote` is the server's copy.

/** Union by id; for ids on both sides the newer `updatedAt` wins (ties keep local). */
function mergeById<T extends { updatedAt: number }>(local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...remote }
  for (const [id, item] of Object.entries(local)) {
    const other = remote[id]
    out[id] = !other || item.updatedAt >= other.updatedAt ? item : other
  }
  return out
}

/** Local items first in their order, then remote additions. */
function unionList(local: string[], remote: string[]): string[] {
  const out = [...local]
  for (const x of remote) if (!out.includes(x)) out.push(x)
  return out
}

export function mergeSchedulesDoc(local: SchedulesDoc, remote: SchedulesDoc): SchedulesDoc {
  const schedules = mergeById(local.schedules, remote.schedules)
  const activeSchedule: Record<string, string> = {}
  for (const term of new Set([...Object.keys(remote.activeSchedule), ...Object.keys(local.activeSchedule)])) {
    const mine = local.activeSchedule[term]
    const theirs = remote.activeSchedule[term]
    const pick = mine && schedules[mine]?.termId === term ? mine : theirs && schedules[theirs]?.termId === term ? theirs : undefined
    if (pick) activeSchedule[term] = pick
  }
  const bookmarks: Record<string, string[]> = {}
  for (const term of new Set([...Object.keys(local.bookmarks), ...Object.keys(remote.bookmarks)])) {
    bookmarks[term] = unionList(local.bookmarks[term] ?? [], remote.bookmarks[term] ?? [])
  }
  return { schedules, activeSchedule, bookmarks }
}

/** Everything about an entry except its identity, for spotting the same credit added on two devices. */
function entryContent(e: RecordEntry): string {
  const { id: _id, addedAt: _added, ...rest } = e
  return stableStringify(rest)
}

function mergeOverride(a: StoredOverride, b: StoredOverride): StoredOverride {
  // Both carry timestamps from the store; the newer edit wins outright. Without them, keep every waiver.
  if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  const out: StoredOverride = { updatedAt: Math.max(a.updatedAt, b.updatedAt) }
  if (a.prereqs || b.prereqs) out.prereqs = true
  if (a.coreqs || b.coreqs) out.coreqs = true
  if (a.antireqs || b.antireqs) out.antireqs = true
  const note = a.note ?? b.note
  if (note !== undefined) out.note = note
  return out
}

function mergeProfile(local: StudentProfile, remote: StudentProfile): StudentProfile {
  const out: StudentProfile = { ...remote }
  for (const [k, v] of Object.entries(local) as [keyof StudentProfile, StudentProfile[keyof StudentProfile]][]) {
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    if (!empty) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export function mergeRecordDoc(local: RecordDoc, remote: RecordDoc): RecordDoc {
  // Same id on both sides: this device's version wins. New ids from the server are appended.
  const byId = new Map<string, RecordEntry>()
  for (const e of local.entries) byId.set(e.id, e)
  for (const e of remote.entries) if (!byId.has(e.id)) byId.set(e.id, e)
  // The same credit added separately on two devices (different ids, same content) collapses to the earliest.
  const byContent = new Map<string, RecordEntry>()
  for (const e of byId.values()) {
    const key = entryContent(e)
    const seen = byContent.get(key)
    if (!seen || e.addedAt < seen.addedAt) byContent.set(key, e)
  }
  const keep = new Set([...byContent.values()].map((e) => e.id))
  const entries = [...byId.values()].filter((e) => keep.has(e.id))

  const overrides: Record<string, StoredOverride> = { ...remote.overrides }
  for (const [id, o] of Object.entries(local.overrides)) overrides[id] = remote.overrides[id] ? mergeOverride(o, remote.overrides[id]) : o

  return { entries, overrides, profile: mergeProfile(local.profile, remote.profile) }
}

export function mergePlanDoc(local: PlanDoc, remote: PlanDoc): PlanDoc {
  const plans = mergeById(local.plans, remote.plans)
  const activePlanId =
    local.activePlanId && plans[local.activePlanId] ? local.activePlanId : remote.activePlanId && plans[remote.activePlanId] ? remote.activePlanId : null
  return { plans, activePlanId }
}

// ---------------------------------------------------------------------------

/** JSON with object keys sorted, so equal documents compare equal as strings. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(sortKeys(v))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (isObj(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && !UNSAFE_KEYS.has(k)) out[k] = sortKeys(v[k])
    return out
  }
  return v
}
