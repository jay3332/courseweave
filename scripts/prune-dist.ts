// Runs before `wrangler deploy`: removes data that must not be published from dist/.
// FCE results are CMU-internal, so they're left out unless INCLUDE_FCE=1, which you should only set when the
// deployment is behind CMU-only access control (see README, "Deploying to Cloudflare").

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './lib/common.ts'

const dist = join(root, 'dist')
if (!existsSync(dist)) {
  console.error('dist/ not found; run npm run build first.')
  process.exit(1)
}

const fce = join(dist, 'data', 'fce')
if (process.env.INCLUDE_FCE === '1') {
  console.log('prune-dist: keeping FCE data (INCLUDE_FCE=1). Make sure this deployment is behind CMU-only access.')
} else if (existsSync(fce)) {
  rmSync(fce, { recursive: true })
  console.log('prune-dist: removed dist/data/fce (set INCLUDE_FCE=1 to keep it on a protected deployment).')
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
