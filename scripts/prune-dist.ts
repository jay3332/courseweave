// Runs before `wrangler deploy` / `wrangler dev`: decides what data ships in dist/ and checks Cloudflare's limits.
//
// FCE results are CMU-internal. The Worker only serves them to signed-in CMU users, so they're kept when sign-in is
// configured (OIDC_CLIENT_ID set in wrangler.jsonc) and removed otherwise. INCLUDE_FCE=1 / INCLUDE_FCE=0 overrides.
//
// Usage: node scripts/prune-dist.ts [--deploy]   (--deploy also refuses the placeholder D1 database id)

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './lib/common.ts'

const PLACEHOLDER_DB = '00000000-0000-0000-0000-000000000000'

/** Parses wrangler.jsonc: strips comments and trailing commas outside strings. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += ch
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

interface WranglerConfig {
  vars?: Record<string, string>
  d1_databases?: { binding: string; database_id?: string }[]
}

const config = parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')) as WranglerConfig
const signInConfigured = Boolean(config.vars?.OIDC_CLIENT_ID?.trim())
const deploying = process.argv.includes('--deploy')

if (deploying && config.d1_databases?.some((d) => !d.database_id || d.database_id === PLACEHOLDER_DB)) {
  console.error(
    'wrangler.jsonc still has the placeholder D1 database id. Create the database once with\n' +
      '  npx wrangler d1 create courseweave\n' +
      'paste the printed database_id into wrangler.jsonc, run npm run db:migrate:remote, then deploy again.',
  )
  process.exit(1)
}

const dist = join(root, 'dist')
if (!existsSync(dist)) {
  console.error('dist/ not found; run npm run build first.')
  process.exit(1)
}

const override = process.env.INCLUDE_FCE
const keepFce = override === '1' ? true : override === '0' ? false : signInConfigured
const fce = join(dist, 'data', 'fce')
if (keepFce) {
  if (existsSync(fce)) {
    console.log(
      signInConfigured
        ? 'prune-dist: keeping FCE data; the Worker serves it only to signed-in CMU users.'
        : 'prune-dist: keeping FCE data (INCLUDE_FCE=1) without sign-in configured; the Worker will refuse to serve it until sign-in is set up.',
    )
  }
} else if (existsSync(fce)) {
  rmSync(fce, { recursive: true })
  console.log(`prune-dist: removed dist/data/fce (${override === '0' ? 'INCLUDE_FCE=0' : 'sign-in isn’t configured: set OIDC_CLIENT_ID in wrangler.jsonc'}).`)
}

// Cloudflare's per-file limit for static assets is 25 MiB; fail early rather than mid-upload.
let files = 0
let largest = { path: '', size: 0 }
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path)
    else {
      files++
      if (st.size > largest.size) largest = { path, size: st.size }
    }
  }
}
walk(dist)
console.log(`prune-dist: ${files} files, largest ${(largest.size / 1024 / 1024).toFixed(1)} MiB (${largest.path.slice(dist.length + 1)})`)
if (largest.size > 25 * 1024 * 1024) {
  console.error('A file exceeds Cloudflare’s 25 MiB static asset limit.')
  process.exit(1)
}
if (files > 20000) {
  console.error('More than 20,000 files: over the Workers Free plan limit for static assets.')
  process.exit(1)
}
