// Past syllabi from CMU's Canvas Syllabus Registry (scraped by the ScottyLabs courses repo). They're CMU-internal like
// FCEs: the index (public/data/syllabi/<NN>.json) and the files (R2, served at /api/syllabi/<key>) only go to signed-in
// CMU users. Shared by scripts/build-syllabi.ts, scripts/upload-syllabi.ts, the Worker and the app, so imports use
// explicit .ts extensions.

/** One past syllabus. */
export interface SyllabusEntry {
  /** Registry term: S, M (summer one), N (summer two) or F, and the year: "F25". */
  term: string
  /** Sections sharing this syllabus, when the registry lists it per section. */
  sections?: string[]
  /** Storage key of a file we host: "<term>/<dept>/<file name>". */
  key?: string
  /** File extension, lowercase: "pdf", "docx", … */
  type?: string
  size?: number
  /** For registry entries that are Canvas pages rather than files: the page, which often needs enrollment. */
  url?: string
}

/** public/data/syllabi/<NN>.json: course id → syllabi, newest term first. */
export type SyllabiChunk = Record<string, SyllabusEntry[]>

export const SYLLABUS_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

/** Shown in the page. Everything else (Word files, HTML someone uploaded) is only ever downloaded. */
export const PREVIEWABLE_TYPES = new Set(['pdf'])

/** "F25/MSC/21241-1.pdf": a registry term, a department code and a file name with a known type. */
export function isSyllabusKey(key: string): boolean {
  const m = /^[SMNF]\d{2}\/[A-Z0-9]{1,6}\/([^/\\]{1,200})$/.exec(key)
  if (!m || m[1].startsWith('.')) return false
  return syllabusType(key) !== null
}

/** The key's file type when it's one we serve. */
export function syllabusType(key: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1].toLowerCase()
  return ext && ext in SYLLABUS_CONTENT_TYPES ? ext : null
}

const SEASONS: Record<string, [order: number, name: string]> = { S: [0, 'Spring'], M: [1, 'Summer One'], N: [2, 'Summer Two'], F: [3, 'Fall'] }

/** "F25" → "Fall 2025"; "N24" → "Summer Two 2024". */
export function registryTermLabel(term: string): string {
  const season = SEASONS[term[0]]
  return season ? `${season[1]} 20${term.slice(1)}` : term
}

/** Sort key: later terms are larger. */
export function registryTermOrder(term: string): number {
  return Number(term.slice(1)) * 4 + (SEASONS[term[0]]?.[0] ?? 0)
}
