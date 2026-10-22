// Weekly data check (run by the refresh workflow): what needs a manual refresh, since CI can't do it itself.
//
//   node scripts/data-status.ts [--soc-notes notes.md] [--out checklist.md]
//
// - FCE: compares the upstream export (ScottyLabs courses, data/fces.csv) with the one the last local build used
//   (data/derived/refreshed.json, written by build-fce.ts).
// - Stellic: terms built with a Stellic fetch (e.g. S27 recitations) that haven't ended, fetched over two weeks ago.
// - Deploy: the live site's data/build.json against the latest commit of the data inputs on DATA_REF (default HEAD).
// - Anything the SOC report flagged (--soc-notes), e.g. a new semester on the Schedule of Classes.
// Prints `pending=true|false` to $GITHUB_OUTPUT when set. Network failures become "couldn't check" lines, not errors.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DATA_INPUT_PATHS, dataDir, readRefreshRecord, root } from './lib/common.ts'

const { values } = parseArgs({ options: { 'soc-notes': { type: 'string' }, out: { type: 'string' } } })
const SITE = process.env.SITE_URL ?? 'https://courseweave.jay3332.tech'
/** Stellic sections older than this get a reminder while their term is still running. */
const STELLIC_MAX_AGE_DAYS = 14
const DAY = 24 * 60 * 60 * 1000

const today = new Date()
const record = readRefreshRecord()
const items: string[] = []
const checks: string[] = []
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10)

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'courseweave-data-check', ...headers }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`${url}: not JSON`)
  return res.json()
}

// ---- FCE: newer upstream export? ----
try {
  // The read-only GitHub mirror of git.cmu.dev/ScottyLabs/courses; GITHUB_TOKEN (when set) avoids the anonymous rate limit.
  const auth: Record<string, string> = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
  const commits = (await getJson('https://api.github.com/repos/ScottyLabs/courses/commits?path=data/fces.csv&per_page=1', auth)) as {
    sha: string
    commit: { committer: { date: string } }
  }[]
  const latest = commits[0]
  if (!latest) throw new Error('no commits for data/fces.csv')
  const built = record.fce
  if (!built || (latest.sha !== built.upstreamCommit && Date.parse(latest.commit.committer.date) > Date.parse(built.upstreamDate))) {
    items.push(
      `- [ ] **New FCE data** from ScottyLabs (${day(latest.commit.committer.date)}${built ? `; the site has ${day(built.upstreamDate)}` : ''}). ` +
        'Pull your ScottyLabs courses checkout, then `npm run data`, commit `data/derived/refreshed.json`, and `npm run deploy`.',
    )
  }
  checks.push(`FCE export: upstream ${day(latest.commit.committer.date)}, built ${built ? day(built.upstreamDate) : 'unknown'}`)
} catch (e) {
  checks.push(`FCE export: couldn't check (${(e as Error).message})`)
}

// ---- Stellic: stale fetches for running or upcoming terms ----
const terms = JSON.parse(readFileSync(join(dataDir, 'terms.json'), 'utf8')) as {
  id: string
  name: string
  classesEnd: string
  sources: { type: string; root?: string; dir?: string }[]
}[]
for (const t of terms) {
  // Only terms with their own Stellic fetch (data/raw/stellic/<TERM>); older terms use the ScottyLabs history.
  const fetched = t.sources.some((s) => s.type === 'stellic' && s.root === 'data' && String(s.dir).startsWith('raw/stellic/'))
  if (!fetched || Date.parse(t.classesEnd) + DAY < today.getTime()) continue
  const last = record.stellic?.[t.id]
  const age = last ? Math.floor((today.getTime() - Date.parse(last)) / DAY) : null
  checks.push(`${t.name} Stellic sections: ${last ? `fetched ${last} (${age} days ago)` : 'never recorded'}`)
  if (age === null || age > STELLIC_MAX_AGE_DAYS) {
    items.push(
      `- [ ] **Refresh ${t.name} from Stellic** (${last ? `last fetched ${last}, ${age} days ago` : 'no fetch recorded'}): recitations, rooms and instructors change until classes start. ` +
        `Sign in to Stellic, copy the Cookie header, run \`COOKIE_HEADER='…' npm run fetch:stellic -- ${t.id}\`, then \`npm run data\`, commit \`data/derived/refreshed.json\`, and \`npm run deploy\`.`,
    )
  }
}

// ---- Deploy: merged data the live site doesn't have yet ----
try {
  const ref = process.env.DATA_REF ?? 'HEAD'
  const head = execFileSync('git', ['log', '-1', '--format=%H %cI', ref, '--', ...DATA_INPUT_PATHS], { cwd: root, encoding: 'utf8' }).trim().split(' ')
  const live = (await getJson(`${SITE}/data/build.json`)) as { dataCommit?: string; dirty?: boolean }
  const liveCommit = live.dataCommit ?? ''
  let behind = Boolean(head[0]) && liveCommit !== head[0]
  if (behind && liveCommit) {
    try {
      // Live built from something newer than (or unrelated to) this branch's data, e.g. a local deploy: not behind.
      execFileSync('git', ['merge-base', '--is-ancestor', liveCommit, head[0]], { cwd: root })
    } catch {
      behind = false
    }
  }
  if (behind) items.push(`- [ ] **Deploy merged data updates**: the live site was built from data commit \`${liveCommit.slice(0, 7) || 'unknown'}\`, \`${ref.replace(/^origin\//, '')}\` has \`${head[0].slice(0, 7)}\` (${day(head[1])}). Run \`npm run deploy\`.`)
  checks.push(`Live data: ${liveCommit ? liveCommit.slice(0, 7) : 'unknown'}${live.dirty ? ' (built with uncommitted changes)' : ''}; latest data commit ${head[0].slice(0, 7)}`)
} catch (e) {
  checks.push(`Live data: couldn't check (${(e as Error).message})`)
}

// ---- SOC report notes (new semesters, etc.) ----
const socNotesPath = values['soc-notes']
if (socNotesPath && existsSync(socNotesPath)) {
  const notes = readFileSync(socNotesPath, 'utf8').split('## Needs attention')[1]
  if (notes?.trim()) items.push(...notes.trim().split('\n').map((l) => l.replace(/^- /, '- [ ] ')))
}

const pending = items.length > 0
const body = [
  pending
    ? 'Things the weekly data check can’t do on its own. It updates this issue each run and closes it once everything is current.'
    : 'Everything is current.',
  '',
  ...items,
  '',
  '<details><summary>What was checked</summary>',
  '',
  ...checks.map((c) => `- ${c}`),
  `- Checked ${today.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '</details>',
  '',
].join('\n')

if (values.out) writeFileSync(values.out, body)
else console.log(body)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending}\n`)
