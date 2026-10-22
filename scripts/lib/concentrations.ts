// Stellic lists a major's concentrations by name only ("Machine Learning"); the requirements that audit each one are
// a separate "requirements" program. Several programs can contain the name: other campuses' versions ("CMU Africa -
// Applied Machine Learning Concentration"), other majors' concentrations ("StatML Machine Learning Concentration
// Requirements") and the major's own ("Machine Learning SCS Concentration"). Candidates are scored to pick the last.

export interface ConcentrationParent {
  name: string
  /** Campus of the major's version (null = Pittsburgh). */
  campus: string | null
  department: string | null
}

export interface ConcentrationCandidate {
  name: string
  /** Campuses of the candidate's versions (null entries ignored). */
  campuses: (string | null)[]
  department: string | null
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'concentration', 'requirements', 'track'])
/** Words that name a requirements version ("EY2018", "2025 and Beyond", "(OLD)"), not a different program. */
const VERSION_WORD = /^(?:\d{4}|ey\d{4}|beyond|old|new)$/
/** Campus names in program names; the campus is scored on its own. */
const CAMPUS_WORD = /^(?:cmu|pittsburgh|qatar|doha|africa|rwanda|kigali)$/

export function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  )
}

/** CMU-Africa programs are named "CMU Africa", "Rwanda" or "Kigali"; Qatar's "Qatar" or "Doha". */
function campusGroup(campus: string | null): string | null {
  if (campus === 'Kigali' || campus === 'Rwanda') return 'Africa'
  if (campus === 'Qatar') return 'Doha'
  return campus
}

export function concentrationScore(concentration: string, parent: ConcentrationParent, candidate: ConcentrationCandidate): number {
  const parentTokens = nameTokens(parent.name)
  const wanted = nameTokens(concentration)
  const words = [...nameTokens(candidate.name)].filter((t) => !VERSION_WORD.test(t) && !CAMPUS_WORD.test(t))
  let score = /concentration|track/i.test(candidate.name) ? 3 : 0
  for (const t of words) if (parentTokens.has(t)) score += 1
  // The major's own department suggests its own concentration; another department, another program's.
  if (candidate.department && parent.department) score += candidate.department === parent.department ? 2 : -1
  // Another campus's version is a last resort; a matching non-Pittsburgh campus is a hint.
  const parentCampus = campusGroup(parent.campus) ?? 'Pittsburgh'
  const campuses = new Set(candidate.campuses.map(campusGroup).filter((c): c is string => c !== null))
  if (campuses.size && !campuses.has(parentCampus)) score -= 6
  else if (campuses.has(parentCampus) && parentCampus !== 'Pittsburgh') score += 1
  // Words beyond the concentration's and the major's own names point at some other program.
  score -= 0.5 * words.filter((t) => !wanted.has(t) && !parentTokens.has(t)).length
  return score
}

/** Candidates whose name contains the concentration's, best first. */
export function rankConcentrationPrograms<T extends ConcentrationCandidate>(concentration: string, parent: ConcentrationParent, candidates: T[]): T[] {
  const want = concentration.toLowerCase()
  return candidates
    .filter((c) => c.name.toLowerCase().includes(want))
    .map((c) => ({ c, score: concentrationScore(concentration, parent, c) }))
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .map(({ c }) => c)
}
