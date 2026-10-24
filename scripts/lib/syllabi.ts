// Reads the ScottyLabs syllabus export (<scottylabsDir>/exported/syllabi/<term>/<dept>/<course>-<section>.<ext>), for
// scripts/build-syllabi.ts and scripts/upload-syllabi.ts.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isSyllabusKey, syllabusType } from '../../src/lib/syllabus-files.ts'
import { scottylabsDir } from './common.ts'

export interface SyllabusFile {
  courseId: string
  term: string
  /** Sections sharing the file (identical copies are merged); empty when it isn't per section. */
  sections: string[]
  /** "<term>/<dept>/<file name>": the storage key for hosted files. */
  key: string
  path: string
  size: number
  /** File type, or null for a Canvas page link (`.url`). */
  type: string | null
  /** For Canvas page links: the page. */
  url?: string
}

export function syllabiDir(): string {
  return join(scottylabsDir(), 'exported', 'syllabi')
}

/** "21241-1.pdf" or "21-241-1.pdf" → course 21241, section 1. Names without a short section ("48734_Notes.pdf") have none. */
export function parseSyllabusName(name: string): { courseId: string; sections: string[] } | null {
  const base = name.replace(/\.[^.]+$/, '')
  const m = /^(\d{2})-?(\d{3})(?:[-_ ](.+))?$/.exec(base)
  if (!m) return null
  return { courseId: m[1] + m[2], sections: m[3] && /^[A-Za-z0-9]{1,4}$/.test(m[3]) ? [m[3].toUpperCase()] : [] }
}

/** Every syllabus file and Canvas link in the export, plus what was skipped and why. */
export function scanSyllabi(dir = syllabiDir()): { files: SyllabusFile[]; skipped: string[] } {
  const files: SyllabusFile[] = []
  const skipped: string[] = []
  if (!existsSync(dir)) return { files, skipped }
  for (const term of readdirSync(dir).sort()) {
    if (!/^[SMNF]\d{2}$/.test(term)) continue
    for (const dept of readdirSync(join(dir, term)).sort()) {
      const deptDir = join(dir, term, dept)
      if (!statSync(deptDir).isDirectory()) continue
      for (const name of readdirSync(deptDir).sort()) {
        if (name.startsWith('.')) continue
        const path = join(deptDir, name)
        const key = `${term}/${dept}/${name}`
        const parsed = parseSyllabusName(name)
        if (!parsed) {
          skipped.push(`${key}: no course number`)
          continue
        }
        if (name.endsWith('.url')) {
          const url = readFileSync(path, 'utf8').trim()
          if (/^https:\/\/canvas\.cmu\.edu\/courses\/\d+\/pages\/[\w-]+$/.test(url)) files.push({ ...parsed, term, key, path, size: 0, type: null, url })
          else skipped.push(`${key}: not a Canvas page link`)
          continue
        }
        if (!syllabusType(name) || !isSyllabusKey(key)) {
          skipped.push(`${key}: unsupported file`)
          continue
        }
        files.push({ ...parsed, term, key, path, size: statSync(path).size, type: syllabusType(name) })
      }
    }
  }
  return { files: mergeDuplicates(files), skipped }
}

/**
 * One file per distinct syllabus: departments often upload the same file for every section. Copies (same course,
 * term, type and bytes) merge into the first, which collects their sections. Only same-size files are hashed.
 */
export function mergeDuplicates(files: SyllabusFile[], contentOf = (path: string) => readFileSync(path)): SyllabusFile[] {
  const out: SyllabusFile[] = []
  const bySize = new Map<string, SyllabusFile[]>()
  for (const f of files) {
    if (!f.type) {
      out.push(f)
      continue
    }
    const group = `${f.courseId}|${f.term}|${f.type}|${f.size}`
    const list = bySize.get(group)
    if (!list) bySize.set(group, [f])
    else list.push(f)
  }
  for (const list of bySize.values()) {
    const byHash = new Map<string, SyllabusFile>()
    for (const f of list) {
      const hash = list.length === 1 ? '' : createHash('sha256').update(contentOf(f.path)).digest('hex')
      const first = byHash.get(hash)
      if (first) first.sections = [...new Set([...first.sections, ...f.sections])]
      else {
        const copy = { ...f, sections: [...f.sections] }
        byHash.set(hash, copy)
        out.push(copy)
      }
    }
  }
  return out
}
