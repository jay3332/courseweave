// Sending schedules and degree plans to Stellic (academicaudit.andrew.cmu.edu), and listing schedules for SIO.
//
// Neither system has an import, so for Stellic this builds a script the student pastes into the console of their own
// signed-in Stellic tab. It calls the same endpoints Stellic's planner uses (found by reading its front-end code):
//   POST /planner/getstudentprofile/                      the student's default plan id
//   GET  /plans/<plan>/overview                           the plan's terms (semester id, calendar and plan year)
//   GET  /plans/<plan>/terms/<semester>/<plan year>       courses already in a term (skipped)
//   GET  /planner/getcoursesectionsforusems/?…            section ids by name, for the sections chosen here
//   POST /planner/add-course/                             adds one course (with sections) to one term
// It only ever adds courses: nothing is registered, dropped, swapped or removed, and nothing changes until the student
// confirms the list it shows. SIO (CMU's registration system) has no usable interface for this, so schedules also
// export as the course numbers and sections to enter there.
import { isGeneralCredit, termPhase, type Plan, type ScheduleLike } from './plan'

export const STELLIC_ORIGIN = 'https://academicaudit.andrew.cmu.edu'

export interface ExportCourse {
  /** Stellic's course code, e.g. "15-122". */
  code: string
  title: string
  /** Section names to select, top-level first (e.g. ["1", "A"]); empty to add the course alone. */
  sections: string[]
}

export interface ExportTerm {
  /** Courseweave term code, e.g. "S27". */
  term: string
  name: string
  /** Stellic semester id: 1 fall, 2 spring, 3 summer. */
  semId: 1 | 2 | 3
  /** Calendar year, e.g. 2027 for Spring 2027. */
  year: number
  /** Where the courses come from, e.g. "Schedule 1" or a plan's name. */
  source: string
  courses: ExportCourse[]
}

const SEM_ID = { F: 1, S: 2, M: 3 } as const
const SEASON_NAME = { F: 'Fall', S: 'Spring', M: 'Summer' } as const

export function stellicTerm(term: string): { semId: 1 | 2 | 3; year: number; name: string } | null {
  const m = /^([FSM])(\d\d)$/.exec(term)
  if (!m) return null
  const season = m[1] as keyof typeof SEM_ID
  return { semId: SEM_ID[season], year: 2000 + Number(m[2]), name: `${SEASON_NAME[season]} ${2000 + Number(m[2])}` }
}

const stellicCode = (courseId: string) => `${courseId.slice(0, 2)}-${courseId.slice(2)}`

/** A schedule's visible courses with their chosen lecture/section and recitation. */
export interface ScheduleForExport extends ScheduleLike {
  entries: { courseId: string; hidden: boolean; passFail: boolean; section: string | null; child: string | null }[]
}

export function exportSchedule(schedule: ScheduleForExport, titleOf: (courseId: string) => string): ExportTerm | null {
  const t = stellicTerm(schedule.termId)
  if (!t) return null
  const courses = schedule.entries
    .filter((e) => !e.hidden)
    .map((e) => ({ code: stellicCode(e.courseId), title: titleOf(e.courseId), sections: [e.section, e.child].filter((s): s is string => Boolean(s)) }))
  return { term: schedule.termId, name: t.name, semId: t.semId, year: t.year, source: schedule.name, courses }
}

/**
 * A degree plan's current and future terms. Past terms are left out (Stellic already has them from the transcript),
 * as are general transfer credit rows. Terms synced with a schedule carry that schedule's sections.
 */
export function exportPlan(
  plan: Plan,
  schedulesById: Record<string, ScheduleForExport | undefined>,
  current: string,
  titleOf: (courseId: string) => string,
): ExportTerm[] {
  const out: ExportTerm[] = []
  for (const pt of plan.terms) {
    if (termPhase(pt.term, current) === 'past') continue
    const t = stellicTerm(pt.term)
    if (!t) continue
    const linked = pt.link ? schedulesById[pt.link.scheduleId] : undefined
    if (linked) {
      const fromSchedule = exportSchedule(linked, titleOf)
      if (fromSchedule?.courses.length) out.push({ ...fromSchedule, source: plan.name })
      continue
    }
    const courses = pt.courses.filter((c) => !isGeneralCredit(c.courseId)).map((c) => ({ code: stellicCode(c.courseId), title: titleOf(c.courseId), sections: [] }))
    if (courses.length) out.push({ term: pt.term, name: t.name, semId: t.semId, year: t.year, source: plan.name, courses })
  }
  return out
}

/** What to enter in SIO for one term: course number and the section to register for (the recitation if any). */
export function sioLines(term: ExportTerm): string[] {
  return term.courses.map((c) => `${c.code.replace('-', '')}\t${c.sections.at(-1) ?? ''}\t${c.title}`)
}

/** Plain-text SIO list for several terms. */
export function sioText(terms: ExportTerm[]): string {
  return terms
    .map((t) => [`${t.name} (${t.source})`, 'Course\tSection\tTitle', ...sioLines(t)].join('\n'))
    .join('\n\n')
}

/**
 * The script to paste into a signed-in Stellic tab's console. Readable on purpose: students should be able to see
 * what it does before running it. `terms` is embedded as JSON.
 */
export function buildStellicScript(terms: ExportTerm[], generatedAt = new Date()): string {
  const data = JSON.stringify(terms, null, 2).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
  const summary = terms.map((t) => `//   ${t.name}: ${t.courses.length} course${t.courses.length === 1 ? '' : 's'} from ${t.source}`).join('\n')
  return `// Courseweave → Stellic (generated ${generatedAt.toISOString().slice(0, 10)})
${summary}
//
// Adds these courses (and the sections you chose) to your Stellic plan. It reads your plan first, shows exactly what
// it will add, and changes nothing unless you confirm. It only adds: it never registers, drops, swaps or removes.
// Run it in the console of a Stellic tab (${STELLIC_ORIGIN}) where you're signed in.
(async () => {
  const TERMS = ${data.replace(/\n/g, '\n  ')};

  if (location.origin !== '${STELLIC_ORIGIN}') {
    console.error('Run this in a Stellic tab (${STELLIC_ORIGIN}) after signing in.');
    return;
  }
  const csrf = decodeURIComponent((document.cookie.match(/(?:^|;\\s*)csrftoken=([^;]*)/) || [])[1] || '');
  const headers = { 'X-Requested-With': 'XMLHttpRequest', ...(csrf ? { 'X-CSRFToken': csrf } : {}) };

  // Stellic's own request style: JSON reads, form-encoded writes, a CSRF header, and an optional ")]}'" prefix.
  async function call(method, url, form) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      redirect: 'manual',
      headers: form ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } : headers,
      body: form ? new URLSearchParams(Object.entries(form).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : undefined,
    });
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
      throw new Error('Stellic wants you to sign in again. Reload the page, sign in, and run this again.');
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text.startsWith(")]}'") ? text.slice(text.indexOf('\\n') + 1) : text);
    } catch {
      throw new Error('Unexpected response from ' + url + ' (HTTP ' + res.status + ').');
    }
    const message = (json && (json.message || (json.data && json.data.message))) || {};
    const blockers = (json && (json.blockers || (json.data && json.data.blockers))) || [];
    return { ok: res.ok && !(json && json.success === false), json, code: Number(message.code) || null, text: message.text || '', blockers };
  }

  // Every course code mentioned in a response (to tell which courses a term already has).
  function codesIn(value, found = new Set()) {
    if (Array.isArray(value)) value.forEach((v) => codesIn(v, found));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if ((k === 'code' || k === 'course_code') && typeof v === 'string' && /^\\d\\d-\\d\\d\\d$/.test(v)) found.add(v);
        else codesIn(v, found);
      }
    }
    return found;
  }

  try {
    // 1. Your plan and its terms.
    const profile = (await call('POST', '/planner/getstudentprofile/', {})).json || {};
    const planId = profile.default_plan_id;
    if (!planId) throw new Error("Couldn't find your Stellic plan. Open your plan in Stellic once, then run this again.");
    const overview = await call('GET', '/plans/' + encodeURIComponent(planId) + '/overview');
    const planTerms = new Map();
    for (const y of (overview.json && overview.json.plan && overview.json.plan.academic_years) || []) {
      for (const t of y.terms || []) planTerms.set(t.semester_id + '-' + t.physical_year, t.logical_year);
    }

    // 2. What each course needs: its plan term, whether it's already there, and Stellic's ids for the chosen sections.
    const rows = [];
    for (const term of TERMS) {
      const logicalYear = planTerms.get(term.semId + '-' + term.year);
      let existing = new Set();
      if (logicalYear != null) {
        const read = await call('GET', '/plans/' + encodeURIComponent(planId) + '/terms/' + term.semId + '/' + logicalYear);
        existing = codesIn(read.json);
      }
      for (const course of term.courses) {
        const row = { term: term.name, course: course.code, title: course.title, sections: course.sections.join(', '), action: 'add', note: '', logicalYear, semId: term.semId, sectionIds: [] };
        if (logicalYear == null) {
          row.action = 'skip';
          row.note = term.name + " isn't in your Stellic plan";
        } else if (existing.has(course.code)) {
          row.action = 'skip';
          row.note = 'already in your plan';
        } else if (course.sections.length) {
          const found = await call('GET', '/planner/getcoursesectionsforusems/?course_code=' + encodeURIComponent(course.code) + '&sem_id=' + term.semId + '&physical_year=' + term.year + '&campus_id=1');
          const byName = new Map();
          for (const entry of (found.json && found.json.data_list) || []) {
            for (const group of entry.section_groups || []) for (const s of group.sections || []) if (!s.hidden && !byName.has(s.name)) byName.set(s.name, s.id);
          }
          const ids = course.sections.map((n) => byName.get(n));
          if (ids.every((id) => id != null)) row.sectionIds = ids;
          else row.note = "some sections aren't in Stellic yet; adding the course without them";
        }
        rows.push(row);
      }
    }

    const toAdd = rows.filter((r) => r.action === 'add');
    console.table(rows.map(({ term, course, title, sections, action, note }) => ({ term, course, title, sections, action, note })));
    if (!toAdd.length) {
      alert('Nothing to add: every course is already in your Stellic plan (or its term isn\\'t in your plan). See the console for details.');
      return;
    }
    const list = toAdd.map((r) => r.term + '  ' + r.course + (r.sectionIds.length ? ' (' + r.sections + ')' : '') + '  ' + r.title).join('\\n');
    if (!confirm('Add ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to your Stellic plan?\\n\\n' + list + '\\n\\nCancel changes nothing.')) {
      console.log('Cancelled: nothing was changed.');
      return;
    }

    // 3. Add them. Stellic's warnings (e.g. missing prerequisites) are collected and confirmed before forcing.
    const add = (r, force) =>
      call('POST', '/planner/add-course/', {
        plan_id: planId,
        course_code: r.course,
        sem_id: r.semId,
        year: r.logicalYear,
        campus_id: 1,
        section_ids: r.sectionIds.length ? r.sectionIds.join(',') : null,
        force: force ? true : null,
      });
    const warned = [];
    for (const r of toAdd) {
      let res = await add(r, false);
      if (!res.ok && res.code !== 494 && !res.blockers.length && r.sectionIds.length) {
        r.sectionIds = [];
        res = await add(r, false);
        if (res.ok) r.note = 'added without sections; pick them in Stellic';
      }
      if (res.ok) r.result = 'added';
      else if (res.code === 494) { r.result = 'warning'; r.note = res.text; warned.push(r); }
      else if (res.blockers.length) { r.result = 'not added'; r.note = 'needs instructor consent: add it from Stellic\\'s course search'; }
      else if (res.code === 495) { r.result = 'not added'; r.note = res.text || 'this term is locked in your plan'; }
      else { r.result = 'not added'; r.note = res.text || 'Stellic rejected it'; }
    }
    if (warned.length && confirm('Stellic flagged ' + warned.length + ' course' + (warned.length === 1 ? '' : 's') + ':\\n\\n' + warned.map((r) => r.course + ': ' + r.note).join('\\n') + '\\n\\nAdd ' + (warned.length === 1 ? 'it' : 'them') + ' anyway?')) {
      for (const r of warned) {
        const res = await add(r, true);
        r.result = res.ok ? 'added' : 'not added';
        if (!res.ok) r.note = res.text || r.note;
      }
    }

    console.table(toAdd.map(({ term, course, title, sections, result, note }) => ({ term, course, title, sections, result, note })));
    const added = toAdd.filter((r) => r.result === 'added').length;
    alert('Added ' + added + ' of ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to your Stellic plan.' + (added < toAdd.length ? ' See the console for the rest.' : '') + ' Reload Stellic to see them.');
  } catch (e) {
    console.error(e);
    alert('Courseweave export stopped: ' + (e && e.message ? e.message : e) + ' Nothing after this point was changed.');
  }
})();
`
}
