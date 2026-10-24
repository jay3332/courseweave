// Search-engine files, written into dist/ after `vite build` (they need its index.html, with the hashed bundle names):
//   dist/all/courses/<code>.html   one page per course: the app's index.html with the course's title, description,
//                                  canonical link, social preview tags and schema.org Course data in the head, and a
//                                  plain summary in <noscript> for crawlers that don't run scripts. The body is
//                                  otherwise untouched, so visitors get exactly the app they'd get from index.html.
//   dist/sitemap.xml               the home page, the course list and every course page
//
// /all/courses/<code> (the all-semesters view) is each course's canonical address: it doesn't change from semester to
// semester. Only public catalog data goes into these pages: never FCEs or syllabi, which need CMU sign-in.
//
// Usage: node scripts/build-seo.ts   (part of `npm run build`)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CatalogDetails, CatalogIndex } from '../src/lib/catalog-types.ts'
import { formatRequisite } from '../src/lib/requisite-format.ts'
import { SITE } from '../src/lib/site.ts'
import type { OfferingsData, TermIndexEntry } from '../src/lib/types.ts'
import { publicDataDir, root } from './lib/common.ts'

const DESCRIPTION_MAX = 158

export interface SeoCourse {
  id: string
  code: string
  title: string
  units: number | null
  unitsMax?: number
  description?: string
  prereqs?: string
  /** Offering term names, newest first. */
  offered: string[]
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cut at a word boundary, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.]+$/, '')}…`
}

const unitsText = (c: SeoCourse) => (c.units === null ? 'variable units' : c.unitsMax ? `${c.units}–${c.unitsMax} units` : `${c.units} units`)

/** The course's search snippet: what it is, then the start of its description. */
export function courseDescription(c: SeoCourse): string {
  const lead = `${c.code} ${c.title}, ${unitsText(c)} at Carnegie Mellon University.`
  return clip(c.description ? `${lead} ${c.description}` : `${lead} Prerequisites, offerings, workload and requirements on Courseweave.`, DESCRIPTION_MAX)
}

/** index.html with a course's head tags and a <noscript> summary. */
export function coursePage(template: string, c: SeoCourse): string {
  const url = `${SITE}/all/courses/${c.code}`
  const title = `${c.code} ${c.title} · CMU course · Courseweave`
  const description = courseDescription(c)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: c.title,
    courseCode: c.code,
    url,
    ...(c.description ? { description: clip(c.description, 1000) } : {}),
    ...(c.prereqs ? { coursePrerequisites: c.prereqs } : {}),
    provider: { '@type': 'CollegeOrUniversity', name: 'Carnegie Mellon University', sameAs: 'https://www.cmu.edu' },
  }
  const head = [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeHtml(`${c.code} ${c.title}`)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    // JSON in a script element: "<" escaped so text can't close it.
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ')
  const summary = [
    `<h1>${escapeHtml(`${c.code} ${c.title}`)}</h1>`,
    `<p>${escapeHtml(unitsText(c))}, Carnegie Mellon University</p>`,
    c.description ? `<p>${escapeHtml(c.description)}</p>` : '',
    `<p>Prerequisites: ${escapeHtml(c.prereqs ?? 'none listed')}</p>`,
    c.offered.length ? `<p>Offered: ${escapeHtml(c.offered.join(', '))}</p>` : '',
    `<p>Courseweave needs JavaScript to show sections, workloads and planning tools.</p>`,
  ]
    .filter(Boolean)
    .join('')

  const out = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    // The generic social tags from index.html give way to the course's.
    .replace(/\s*<meta property="og:(?:title|description|url|type)" content="[^"]*" \/>/g, '')
    .replace('</head>', `  ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<noscript><main>${summary}</main></noscript>\n    <div id="root"></div>`)
  if (!out.includes(`<link rel="canonical" href="${url}"`) || !out.includes('<noscript><main>')) throw new Error('build-seo: index.html no longer has the expected shape')
  return out
}

export function sitemap(urls: { loc: string; lastmod?: string }[]): string {
  const rows = urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}

/**
 * Every course worth a page: offered in a semester here, or described in the catalog. Catalog entries with nothing
 * but a number and a title would be empty pages.
 */
export function seoCourses(catalog: CatalogIndex, details: Record<string, CatalogDetails>, offerings: OfferingsData, termName: (id: string) => string): SeoCourse[] {
  const ids = new Set([...Object.keys(offerings.courses), ...Object.keys(catalog.courses).filter((id) => details[id]?.description)])
  const out: SeoCourse[] = []
  for (const id of [...ids].sort()) {
    const entry = catalog.courses[id]
    const offered = offerings.courses[id]
    const title = offered?.title ?? entry?.title
    if (!title || /^\d{2}-?\d{3}$/.test(title.trim())) continue
    const prereqs = entry?.prereqs ? formatRequisite(entry.prereqs) : undefined
    out.push({
      id,
      code: `${id.slice(0, 2)}-${id.slice(2)}`,
      title,
      units: entry?.units ?? null,
      ...(entry?.unitsMax !== undefined ? { unitsMax: entry.unitsMax } : {}),
      ...(details[id]?.description ? { description: details[id].description } : {}),
      ...(prereqs && prereqs !== 'None' ? { prereqs } : {}),
      offered: (offered?.terms ?? []).map(termName),
    })
  }
  return out
}

function main() {
  const dist = join(root, 'dist')
  const templatePath = join(dist, 'index.html')
  if (!existsSync(templatePath)) throw new Error('build-seo: dist/index.html not found; run vite build first.')
  const catalogPath = join(publicDataDir, 'catalog', 'index.json')
  const offeringsPath = join(publicDataDir, 'offerings.json')
  if (!existsSync(catalogPath) || !existsSync(offeringsPath)) {
    console.log('build-seo: no catalog or offerings data; writing the sitemap without course pages.')
  }
  const template = readFileSync(templatePath, 'utf8')
  const catalog: CatalogIndex = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { generatedAt: '', courses: {} }
  const offerings: OfferingsData = existsSync(offeringsPath) ? JSON.parse(readFileSync(offeringsPath, 'utf8')) : { terms: [], courses: {} }
  const details: Record<string, CatalogDetails> = {}
  const detailsDir = join(publicDataDir, 'catalog', 'details')
  if (existsSync(detailsDir)) for (const f of readdirSync(detailsDir)) Object.assign(details, JSON.parse(readFileSync(join(detailsDir, f), 'utf8')))
  const terms: TermIndexEntry[] = existsSync(join(publicDataDir, 'terms.json')) ? JSON.parse(readFileSync(join(publicDataDir, 'terms.json'), 'utf8')) : []
  const names = new Map(terms.map((t) => [t.id, t.name]))

  const courses = seoCourses(catalog, details, offerings, (id) => names.get(id) ?? id)
  const out = join(dist, 'all', 'courses')
  mkdirSync(out, { recursive: true })
  for (const c of courses) writeFileSync(join(out, `${c.code}.html`), coursePage(template, c))

  const lastmod = (catalog.generatedAt || new Date().toISOString()).slice(0, 10)
  writeFileSync(
    join(dist, 'sitemap.xml'),
    sitemap([{ loc: `${SITE}/` }, { loc: `${SITE}/all/courses`, lastmod }, ...courses.map((c) => ({ loc: `${SITE}/all/courses/${c.code}`, lastmod }))]),
  )
  console.log(`build-seo: ${courses.length} course pages and a sitemap of ${courses.length + 2} addresses`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
