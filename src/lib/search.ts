import type { Course } from './types'

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** "15-122", "15122", "15 122", "15-1" → digits-only form, or null if the query isn't course-number-like. */
export function codeQuery(q: string): string | null {
  const m = /^\s*(\d{2})(?:\s*[-\s]?\s*(\d{0,3}))?\s*$/.exec(q)
  if (!m) return null
  return m[1] + (m[2] ?? '')
}

/** Normalized text for each course, built once per term. */
export interface SearchDoc {
  course: Course
  title: string
  instructors: string
  sectionTitles: string
}

export function buildSearchDocs(courses: Course[]): SearchDoc[] {
  return courses.map((course) => ({
    course,
    title: normalize(course.title),
    instructors: normalize(course.instructors.join(' | ')),
    sectionTitles: normalize(
      course.sections
        .map((s) => s.title)
        .filter(Boolean)
        .join(' | '),
    ),
  }))
}

/** What scoring reads: a term's search docs, or lighter docs for courses from other terms (see lib/offerings). */
export type ScoredDoc = Pick<SearchDoc, 'title' | 'instructors' | 'sectionTitles'> & { course: Pick<Course, 'id' | 'dept'> }

/** Whether `token` occurs at the start of a word in `haystack`. */
export function wordStarts(haystack: string, token: string): boolean {
  let i = haystack.indexOf(token)
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(haystack[i - 1])) return true
    i = haystack.indexOf(token, i + 1)
  }
  return false
}

/**
 * Score a course against a free-text query. 0 = no match; higher is better.
 * Matches course numbers ("15-122", "15122", "15-1"), title words, topic titles and instructor names.
 */
export function scoreCourse(doc: ScoredDoc, query: string): number {
  const q = normalize(query).trim()
  if (!q) return 1

  const code = codeQuery(q)
  if (code) {
    if (doc.course.id === code) return 1000
    if (doc.course.id.startsWith(code)) return 900 - (doc.course.id.length - code.length)
    return 0
  }

  const tokens = q.split(/\s+/).filter(Boolean)
  let score = 0
  for (const t of tokens) {
    const tokenCode = codeQuery(t)
    if (tokenCode && doc.course.id.startsWith(tokenCode)) {
      score += 200
    } else if (wordStarts(doc.title, t)) {
      score += 40
    } else if (doc.title.includes(t)) {
      score += 15
    } else if (wordStarts(doc.sectionTitles, t)) {
      score += 12
    } else if (wordStarts(doc.instructors, t)) {
      score += 25
    } else if (normalize(doc.course.dept) === t) {
      score += 20
    } else {
      return 0
    }
  }
  if (doc.title === q) score += 300
  else if (doc.title.startsWith(q)) score += 100
  else if (tokens.length > 1 && wordStarts(doc.title, q)) score += 90
  // Shorter titles are closer matches: "Introduction to Machine Learning" beats a long topics title.
  score -= Math.min(doc.title.length, 80) / 20
  return score
}

export function searchCourses(docs: SearchDoc[], query: string, limit = Infinity): Course[] {
  if (!query.trim()) return docs.slice(0, limit).map((d) => d.course)
  const scored: { course: Course; score: number }[] = []
  for (const doc of docs) {
    const score = scoreCourse(doc, query)
    if (score > 0) scored.push({ course: doc.course, score })
  }
  scored.sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id))
  return scored.slice(0, limit).map((s) => s.course)
}
