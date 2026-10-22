// Shared data model. Produced by scripts/build-data.ts, consumed by the app.

/** 0 = Monday … 6 = Sunday. */
export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface MiniMeta {
  number: number
  name: string
  start: string
  end: string
}

export interface DateRange {
  start: string
  end: string
  name: string
}

/** public/data/offerings.json: which built terms offer each course, so search can point at another semester. */
export interface OfferingsData {
  /** Every built term, newest first. */
  terms: string[]
  courses: Record<string, { title: string; dept: string; level: string; terms: string[] }>
}

export interface TermMeta {
  /** SIO-style code, e.g. "S27". Used in URLs. */
  id: string
  name: string
  season: 'spring' | 'summer' | 'fall'
  year: number
  minis: MiniMeta[]
  /** ISO dates (YYYY-MM-DD). */
  classesBegin: string
  classesEnd: string
  noClasses: DateRange[]
  /** Source adapters the term was built from, e.g. ["csv", "stellic"]. */
  sources?: string[]
  /** Caveats about this term's data, shown to users (e.g. "recitations not published yet"). */
  notes?: string[]
}

export interface Meeting {
  /** Empty when the meeting days are TBA. */
  days: Day[]
  /** Minutes since midnight, or null when TBA. */
  start: number | null
  end: number | null
  building: string | null
  room: string | null
}

export interface Section {
  /** e.g. "1", "A", "A3". Unique within a course. */
  name: string
  /** Lectures have a lecture number in SOC; everything else is a section (standalone, or a child of a lecture). */
  kind: 'lecture' | 'section'
  /**
   * For child sections (recitations, labs), the name of the lecture they belong to; null for top-level sections.
   * Students pick one top-level section and, if it has children, one of its children.
   */
  parent: string | null
  /** Mini number (e.g. 3 or 4 in spring), or null for full-semester sections. */
  mini: number | null
  /** Delivery mode code from SOC (IPE, IPO, REO, …). */
  mode: string
  /** Only set when the section's title differs from the course title (topics courses). */
  title?: string
  instructors: string[]
  meetings: Meeting[]
  /** Enrollment cap, when the source has it. */
  capacity?: number
}

export interface Course {
  /** Five-digit id without dash, e.g. "15122". */
  id: string
  /** Display code, e.g. "15-122". */
  code: string
  title: string
  /** null = variable units. */
  units: number | null
  /** Department code from SOC, e.g. "CS". */
  dept: string
  level: 'U' | 'G'
  instructors: string[]
  sections: Section[]
  /** Other course ids that meet at the same time and place (cross-listed). */
  crossListed: string[]
  /** Graded pass/fail only, so its units are never factorable (don't count toward QPA). */
  passFail?: boolean
}

export interface TermData {
  term: TermMeta
  generatedAt: string
  courses: Course[]
}

export interface TermIndexEntry extends TermMeta {
  courseCount: number
  sectionCount: number
}
