import type { Course, TermMeta } from '../../src/lib/types.ts'

/** One entry of a term's `sources` list in data/terms.json. */
export interface SourceConfig {
  /** Adapter name: "csv" | "soc" | "stellic". */
  type: string
  /**
   * primary: defines the course list (the first source must be primary).
   * supplement: adds missing sections (e.g. recitations) and fills gaps in primary data; never removes anything.
   */
  role?: 'primary' | 'supplement'
  /** With role "supplement": also add courses the primary source doesn't list. Default false. */
  addMissingCourses?: boolean
  /**
   * With role "supplement": add sections the primary doesn't list (e.g. unpublished recitations). Default true.
   * Set false when the primary is authoritative about which sections exist (SOC drops cancelled sections).
   */
  addMissingSections?: boolean
  /** Adapter-specific options (paths are relative to data/). */
  [option: string]: unknown
}

export interface SourceContext {
  /** Absolute path of data/. */
  dataDir: string
  /** Absolute path of the ScottyLabs courses checkout. */
  scottylabsDir: string
}

/**
 * Parses one source into courses for a term. Must be offline and deterministic:
 * anything fetched from the network is cached under data/raw by a separate fetch script first.
 * Adapters fill `id`, `code`, `title`, `units`, `dept`, `level`, `sections`; `instructors` and
 * `crossListed` are recomputed by the build.
 */
export type SourceAdapter = (source: SourceConfig, term: TermMeta, ctx: SourceContext) => Course[] | Promise<Course[]>
