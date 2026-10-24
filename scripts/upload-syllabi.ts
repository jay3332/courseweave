// Uploads past syllabi to the R2 bucket the Worker serves them from (wrangler.jsonc: SYLLABI → courseweave-syllabi).
// Only files the index lists (identical copies merged) and only ones not uploaded before: what's up is recorded per
// target in .wrangler/syllabi-uploaded-<local|remote>.json, so a rerun after an interruption or a new scrape picks up
// where it stopped.
//
// Uploads go through Cloudflare's account API (wrangler r2 bulk put), which allows about 1,200 requests per 5 minutes,
// so they're paced to stay under that, and a batch that hits the limit anyway waits and goes again.
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

const BATCH = 200
/** Uploads a second, under the account API's ~4/s. */
const RATE = 3.5
const RETRIES = 6

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

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const dir = mkdtempSync(join(tmpdir(), 'syllabi-'))
try {
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    const manifest = join(dir, 'batch.json')
    writeFileSync(manifest, JSON.stringify(batch.map((f) => ({ key: f.key, file: f.path }))))
    const started = Date.now()
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync('npx', ['wrangler', 'r2', 'bulk', 'put', bucket, '--filename', manifest, `--${target}`, '--concurrency', '4', '--force'], {
          cwd: root,
          stdio: 'inherit',
        })
        break
      } catch (e) {
        // Usually the API's rate limit; whatever made it up is simply uploaded again.
        if (attempt >= RETRIES) throw e
        const wait = 60_000 * attempt
        console.log(`upload-syllabi: batch failed (attempt ${attempt}); retrying in ${wait / 1000} s`)
        sleep(wait)
      }
    }
    for (const f of batch) uploaded[f.key] = f.size
    mkdirSync(join(root, '.wrangler'), { recursive: true })
    writeFileSync(recordPath, JSON.stringify(uploaded))
    console.log(`upload-syllabi: ${Math.min(i + BATCH, pending.length)} of ${pending.length} done`)
    if (target === 'remote') sleep(Math.max(0, (batch.length / RATE) * 1000 - (Date.now() - started)))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
