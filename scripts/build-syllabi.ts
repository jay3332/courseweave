// Builds the past-syllabus index from the ScottyLabs Canvas Syllabus Registry export:
//   public/data/syllabi/<NN>.json   course id → syllabi (SyllabiChunk), for course numbers starting with NN
//
// Syllabi are CMU-internal (the registry needs a CMU Canvas login), so like FCEs the index is gitignored, pruned from
// deploys without sign-in, and served by the Worker only to signed-in CMU users. The files themselves go to R2 with
// scripts/upload-syllabi.ts. Without the export (CI, other machines) this does nothing.
//
// Usage: node scripts/build-syllabi.ts

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registryTermOrder, type SyllabiChunk, type SyllabusEntry } from '../src/lib/syllabus-files.ts'
import { publicDataDir } from './lib/common.ts'
import { scanSyllabi, syllabiDir, type SyllabusFile } from './lib/syllabi.ts'

const bySection = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Index entries for a course: newest term first, then by section; files before Canvas links. */
export function indexSyllabi(files: SyllabusFile[]): Record<string, SyllabiChunk> {
  const chunks: Record<string, SyllabiChunk> = {}
  for (const f of files) {
    const sections = f.sections.length ? { sections: [...f.sections].sort(bySection) } : {}
    const entry: SyllabusEntry = f.type ? { term: f.term, ...sections, key: f.key, type: f.type, size: f.size } : { term: f.term, ...sections, url: f.url! }
    const chunk = (chunks[f.courseId.slice(0, 2)] ??= {})
    ;(chunk[f.courseId] ??= []).push(entry)
  }
  for (const chunk of Object.values(chunks)) {
    for (const list of Object.values(chunk)) {
      list.sort(
        (a, b) =>
          registryTermOrder(b.term) - registryTermOrder(a.term) ||
          bySection(a.sections?.[0] ?? '', b.sections?.[0] ?? '') ||
          Number(Boolean(a.url)) - Number(Boolean(b.url)),
      )
    }
  }
  return chunks
}

function main() {
  const dir = syllabiDir()
  if (!existsSync(dir)) {
    console.log(`syllabi: no export at ${dir}; skipping (the syllabus index isn't rebuilt).`)
    return
  }
  const { files, skipped } = scanSyllabi(dir)
  const chunks = indexSyllabi(files)
  const out = join(publicDataDir, 'syllabi')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const [prefix, chunk] of Object.entries(chunks)) writeFileSync(join(out, `${prefix}.json`), JSON.stringify(chunk))

  const hosted = files.filter((f) => f.type)
  const courses = new Set(files.map((f) => f.courseId)).size
  const bytes = hosted.reduce((n, f) => n + f.size, 0)
  console.log(
    `syllabi: ${hosted.length} files (${(bytes / 1e9).toFixed(2)} GB) and ${files.length - hosted.length} Canvas links for ${courses} courses; ` +
      `${skipped.length} skipped`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
