// Uploads past syllabi to the R2 bucket the Worker serves them from (wrangler.jsonc: SYLLABI → courseweave-syllabi).
// Only files the index lists (identical copies merged) and only ones not uploaded before: what's up is recorded per
// target in .wrangler/syllabi-uploaded-<local|remote>.json, so a rerun after an interruption or a new scrape picks up
// where it stopped.
//
// Usage: node scripts/upload-syllabi.ts --local|--remote [--only 15,21] [--bucket courseweave-syllabi]
//   --local    the bucket `wrangler dev` uses (.wrangler/state), for trying it out
//   --remote   the deployed bucket
//   --only     course-number prefixes to upload (testing with a few departments)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './lib/common.ts'
import { scanSyllabi } from './lib/syllabi.ts'

const BATCH = 1000

const args = process.argv.slice(2)
const target = args.includes('--remote') ? 'remote' : args.includes('--local') ? 'local' : null
if (!target) {
  console.error('Pass --local (the wrangler dev bucket) or --remote (the deployed bucket).')
  process.exit(1)
}
const option = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const bucket = option('--bucket') ?? 'courseweave-syllabi'
const only = option('--only')?.split(',').map((p) => p.trim()) ?? null

const recordPath = join(root, '.wrangler', `syllabi-uploaded-${target}.json`)
const uploaded: Record<string, number> = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {}

const { files } = scanSyllabi()
const pending = files.filter((f) => f.type && uploaded[f.key] !== f.size && (!only || only.some((p) => f.courseId.startsWith(p))))
const bytes = pending.reduce((n, f) => n + f.size, 0)
console.log(`upload-syllabi: ${pending.length} files (${(bytes / 1e9).toFixed(2)} GB) to ${target} bucket ${bucket}; ${Object.keys(uploaded).length} already there`)

const dir = mkdtempSync(join(tmpdir(), 'syllabi-'))
try {
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    const manifest = join(dir, 'batch.json')
    writeFileSync(manifest, JSON.stringify(batch.map((f) => ({ key: f.key, file: f.path }))))
    execFileSync('npx', ['wrangler', 'r2', 'bulk', 'put', bucket, '--filename', manifest, `--${target}`, '--concurrency', '20'], {
      cwd: root,
      stdio: 'inherit',
    })
    for (const f of batch) uploaded[f.key] = f.size
    mkdirSync(join(root, '.wrangler'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify(uploaded))
    console.log(`upload-syllabi: ${Math.min(i + BATCH, pending.length)} of ${pending.length} done`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
