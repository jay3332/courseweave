// A schedule's name where the course page and panel act on it ("Add to …", "In …", the calendar's heading). Names
// that say they're a schedule ("Schedule 1", "Fall schedule") read as they are; any other name, such as "From Plan 2"
// for a schedule copied from a degree plan, is quoted after "schedule", so "Add to From Plan 2" doesn't read as adding
// to the degree plan.

const SAYS_SCHEDULE = /\bschedule\b/iu;

/** The schedule in a sentence: "Schedule 1", "schedule “From Plan 2”", or "your schedule" without one. */
export function scheduleInSentence(name: string | null): string {
  if (name === null) return "your schedule";
  return SAYS_SCHEDULE.test(name) ? name : `schedule “${name}”`;
}

/**
 * The schedule where room is short, as in the "In …" chip beside "Open schedule": "Schedule 1", or the other name
 * quoted ("“From Plan 2”").
 */
export function scheduleShort(name: string | null): string {
  if (name === null) return "your schedule";
  return SAYS_SCHEDULE.test(name) ? name : `“${name}”`;
}

/** The schedule as a heading: "Schedule 1", "Schedule “From Plan 2”", or "Your schedule" without one. */
export function scheduleHeading(name: string | null): string {
  if (name === null) return "Your schedule";
  return SAYS_SCHEDULE.test(name) ? name : `Schedule “${name}”`;
}
