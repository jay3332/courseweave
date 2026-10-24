// Sending schedules and degree plans to Stellic (academicaudit.andrew.cmu.edu), and schedules to SIO planned schedules.
//
// Neither system has an import, so for Stellic this builds a script the student pastes into the console of their own
// signed-in Stellic tab. It calls the same endpoints Stellic's planner page uses (checked against the requests that
// page makes, and its front-end code):
//   POST /planner/getstudentprofile/                      the student's default plan id and first term
//   POST /planner/getstudentplan/  plan_id                the plan: sem_content[{ id: semester id, content: { <plan
//                                                         year>: { physical_year, campus_id, courses } } }]
//   GET  /planner/getcoursesectionsforusems/?…            available_sections[{ sections[{ id, name }] }], for the
//                                                         sections chosen here
//   POST /planner/add-course/                             adds one course (with sections) to one term
// CMU's Stellic runs the classic planner: the newer planner's /plans/<plan>/… endpoints answer 404 there.
// It only ever adds courses: nothing is registered, dropped, swapped or removed, and nothing changes until the student
// confirms the list it shows. For SIO's planned schedules, buildSioScript drives SIO's own page instead (its GWT-RPC
// calls carry whole course objects), and schedules also export as plain course numbers and sections.
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

  // A plan's terms, keyed "<semester id>-<calendar year>". Stellic numbers plan years from the student's first year
  // (1, 2, …); each term's content has its calendar year, worked out from the first term if it's ever missing.
  function planTerms(plan, joined) {
    const terms = new Map();
    for (const sem of plan.sem_content || []) {
      for (const [key, content] of Object.entries(sem.content || {})) {
        const logicalYear = Number(key);
        if (!content || !Number.isInteger(logicalYear)) continue;
        let year = Number(content.physical_year);
        if (!year && joined && joined.year) year = (joined.semester === 1 ? joined.year : joined.year - 1) + logicalYear - 1 + (sem.id === 1 ? 0 : 1);
        if (!year) continue;
        // Courses already in the term (wrapped as { course } once Stellic's page has loaded them), so they're skipped.
        const codes = new Set();
        for (const item of content.courses || []) {
          const c = item && (item.course || item);
          if (c && c.status !== 'removed' && typeof c.code === 'string') codes.add(c.code);
        }
        terms.set(sem.id + '-' + year, { logicalYear, campusId: content.campus_id || 1, codes });
      }
    }
    return terms;
  }

  // Section names as Courseweave and Stellic write them ("1", "Lec 1", "A").
  const sectionKey = (name) => String(name).replace(/^lec(ture)?\\s*/i, '').trim().toUpperCase();

  try {
    // 1. Your plan: your default (primary) plan, or else the plan open in Stellic's planner on this tab.
    const profile = (await call('POST', '/planner/getstudentprofile/', {})).json || {};
    let openPlanId = null;
    try {
      openPlanId = typeof angular !== 'undefined' ? angular.element(document.body).injector().get('PlannerSrvc').currentStudentPlanId || null : null;
    } catch {
      openPlanId = null;
    }
    let plan = null;
    let planId = null;
    for (const id of [...new Set([profile.default_plan_id, openPlanId].filter(Boolean))]) {
      let read = null;
      try {
        read = await call('POST', '/planner/getstudentplan/', { plan_id: id });
      } catch (e) {
        if (/sign in again/.test(e.message)) throw e;
      }
      const found = read && read.ok && read.json && read.json.student_plan;
      if (found && Array.isArray(found.sem_content)) {
        plan = found;
        planId = found.plan_id || id;
        break;
      }
    }
    if (!plan) throw new Error("Couldn't read your Stellic plan. Open Plan your Path in Stellic, then run this again in that tab.");
    const planName = plan.name || 'your Stellic plan';
    const terms = planTerms(plan, profile.term_joined);

    // 2. What each course needs: its plan term, whether it's already there, and Stellic's ids for the chosen sections.
    const rows = [];
    for (const term of TERMS) {
      const planTerm = terms.get(term.semId + '-' + term.year);
      const logicalYear = planTerm ? planTerm.logicalYear : null;
      const campusId = planTerm ? planTerm.campusId : 1;
      for (const course of term.courses) {
        const row = { term: term.name, course: course.code, title: course.title, sections: course.sections.join(', '), action: 'add', note: '', logicalYear, campusId, semId: term.semId, sectionIds: [] };
        if (!planTerm) {
          row.action = 'skip';
          row.note = term.name + " isn't in " + planName;
        } else if (planTerm.codes.has(course.code)) {
          row.action = 'skip';
          row.note = 'already in ' + planName;
        } else if (course.sections.length) {
          const found = await call('GET', '/planner/getcoursesectionsforusems/?course_code=' + encodeURIComponent(course.code) + '&sem_id=' + term.semId + '&physical_year=' + term.year + '&campus_id=' + campusId);
          const sections = ((found.json && found.json.available_sections) || []).flatMap((group) => group.sections || []).filter((s) => !s.hidden);
          // Full names first; short names only fill gaps, so one section's short name can't shadow another's name.
          const byName = new Map();
          for (const field of ['name', 'short_name']) {
            for (const s of sections) if (s[field] != null && !byName.has(sectionKey(s[field]))) byName.set(sectionKey(s[field]), s.id);
          }
          const ids = course.sections.map((n) => byName.get(sectionKey(n)));
          if (ids.every((id) => id != null)) row.sectionIds = ids;
          else row.note = "some sections aren't in Stellic yet; adding the course without them";
        }
        rows.push(row);
      }
    }

    const toAdd = rows.filter((r) => r.action === 'add');
    console.table(rows.map(({ term, course, title, sections, action, note }) => ({ term, course, title, sections, action, note })));
    if (!toAdd.length) {
      alert('Nothing to add: every course is already in ' + planName + ' (or its term isn\\'t in the plan). See the console for details.');
      return;
    }
    const list = toAdd.map((r) => r.term + '  ' + r.course + (r.sectionIds.length ? ' (' + r.sections + ')' : '') + '  ' + r.title).join('\\n');
    if (!confirm('Add ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to "' + planName + '" in Stellic?\\n\\n' + list + '\\n\\nCancel changes nothing.')) {
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
        campus_id: r.campusId,
        section_ids: r.sectionIds.length ? r.sectionIds.join(',') : null,
        // What Stellic's own "add anyway" sends after a warning.
        force: force ? true : null,
        force_integrated: force ? true : null,
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
    alert('Added ' + added + ' of ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to "' + planName + '".' + (added < toAdd.length ? ' See the console for the rest.' : '') + ' Reload Stellic to see them.');
  } catch (e) {
    console.error(e);
    alert('Courseweave export stopped: ' + (e && e.message ? e.message : e) + ' Nothing after this point was changed.');
  }
})();
`
}

export const SIO_PLAN_URL = 'https://s3.andrew.cmu.edu/sio/#schedule-plan'

/**
 * The script to paste into SIO's Plan Course Schedule page. SIO's planned-schedule calls (GWT-RPC) carry whole course
 * objects that are impractical to rebuild by hand, so the script drives SIO's own controls instead: the "Add course to
 * planned schedule" box, then the course's section radio buttons. Each step waits for SIO's own save (an XHR) to
 * finish, since clicking while a save is in flight gets undone when it returns. Planned schedules are SIO's planning
 * tool; the script never goes near registration.
 */
export function buildSioScript(terms: ExportTerm[], generatedAt = new Date()): string {
  const data = JSON.stringify(terms.map((t) => ({ name: t.name, source: t.source, courses: t.courses })), null, 2).replace(
    /[\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16)}`,
  )
  const summary = terms.map((t) => `//   ${t.name}: ${t.courses.length} course${t.courses.length === 1 ? '' : 's'} from ${t.source}`).join('\n')
  return `// Courseweave → SIO planned schedule (generated ${generatedAt.toISOString().slice(0, 10)})
${summary}
//
// Adds these courses (and your sections) to the SIO planned schedule you're viewing, using SIO's own "Add course"
// box and section buttons, as if you clicked them. It shows the list first and changes nothing unless you confirm.
// Planned schedules are a planning tool: this never registers you for anything.
// In SIO: Course Schedule → Plan Course Schedule, pick or create (Plan New Schedule) the plan for the semester, then
// paste this into the console and press Enter.
(async () => {
  const TERMS = ${data.replace(/\n/g, '\n  ')};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (location.host !== 's3.andrew.cmu.edu' || !/^#schedule-plan/.test(location.hash)) {
    alert('Open SIO → Course Schedule → Plan Course Schedule (${SIO_PLAN_URL}) and run this there.');
    return;
  }

  // SIO saves each change with an XHR; count them so every step waits for the previous save to finish.
  if (!window.__courseweaveSio) {
    const state = (window.__courseweaveSio = { pending: 0, last: Date.now() });
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (...args) {
      state.pending++;
      state.last = Date.now();
      this.addEventListener('loadend', () => {
        state.pending--;
        state.last = Date.now();
      });
      return send.apply(this, args);
    };
  }
  async function settled(quietMs = 700, maxMs = 20000) {
    const state = window.__courseweaveSio;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (state.pending === 0 && Date.now() - state.last > quietMs) return true;
      await wait(150);
    }
    return false;
  }

  await settled();
  const pageText = () => document.body.innerText || '';
  const viewing = (pageText().match(/Viewing plan for ([^:\\n]+):/) || [])[1];
  if (!viewing) {
    alert('Pick or create a planned schedule first (Plan New Schedule), so the page says "Viewing plan for …".');
    return;
  }
  const semester = viewing.trim();
  // SIO calls summer "Summer 1/All 2026" or "Summer 2 2026"; exports call it "Summer 2026".
  const sameTerm = (name) => name === semester || (/^Summer/.test(name) && /^Summer/.test(semester) && name.slice(-4) === semester.slice(-4));
  const term = TERMS.find((t) => sameTerm(t.name));
  if (!term) {
    alert('You\\'re viewing a ' + semester + ' plan, but this export is for ' + TERMS.map((t) => t.name).join(', ') + '. Switch to (or create) a plan for that semester and run it again.');
    return;
  }
  const planSelect = [...document.querySelectorAll('select')].find((s) => s.offsetParent !== null);
  const planName = planSelect && planSelect.options[planSelect.selectedIndex] ? planSelect.options[planSelect.selectedIndex].text : 'this plan';

  const panel = [...document.querySelectorAll('div')].find((e) => /^Add course to planned schedule/.test((e.innerText || '').trim()) && e.querySelector('input.input-txt'));
  const box = panel && panel.querySelector('input.input-txt');
  const addButton = panel && [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add');
  if (!box || !addButton) {
    alert('Couldn\\'t find SIO\\'s "Add course to planned schedule" box on this page. Nothing was changed.');
    return;
  }

  const radios = (num) => [...document.querySelectorAll('input[type="radio"]')].filter((r) => r.name === num);
  const sectionOf = (radio) => {
    const row = radio.closest('tr');
    return ((row && row.innerText) || '').trim().split(/\\s+/)[0] || '';
  };
  const norm = (s) => String(s).replace(/^lec(ture)?\\s*/i, '').trim().toUpperCase();
  const inPlan = new Set([...document.querySelectorAll('input[type="radio"]')].map((r) => r.name));
  for (const m of pageText().matchAll(/\\b(\\d{2})-?(\\d{3}) ::/g)) inPlan.add(m[1] + m[2]);

  const rows = term.courses.map((c) => {
    const num = c.code.replace('-', '');
    return { course: c.code, title: c.title, section: c.sections.length ? c.sections[c.sections.length - 1] : '', num, action: inPlan.has(num) ? 'skip' : 'add', note: inPlan.has(num) ? 'already in this plan' : '' };
  });
  console.table(rows.map(({ course, title, section, action, note }) => ({ course, title, section, action, note })));
  const toAdd = rows.filter((r) => r.action === 'add');
  if (!toAdd.length) {
    alert('Nothing to add: every course is already in "' + planName + '".');
    return;
  }
  const list = toAdd.map((r) => r.course + (r.section ? ' (' + r.section + ')' : '') + '  ' + r.title).join('\\n');
  if (!confirm('Add ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to your ' + semester + ' planned schedule "' + planName + '"?\\n\\n' + list + '\\n\\nCancel changes nothing.')) {
    console.log('Cancelled: nothing was changed.');
    return;
  }

  for (const r of toAdd) {
    box.focus();
    box.value = r.num;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const before = window.__courseweaveSio.last;
    addButton.click();
    // Wait for SIO's save to start and finish, then briefly for the course's section buttons to render.
    for (let i = 0; i < 50 && window.__courseweaveSio.last === before; i++) await wait(100);
    await settled();
    for (let i = 0; i < 10 && !radios(r.num).length && !new RegExp(r.course + ' added').test(pageText()); i++) await wait(150);
    const added = radios(r.num).length > 0 || new RegExp(r.course + ' added').test(pageText());
    if (!added) {
      const message = ((panel.innerText || '').split('\\n').find((l) => l.trim() && !/^Add course to planned schedule|Search for a course|course number below/i.test(l)) || '').trim();
      r.result = 'not added';
      r.note = message || 'SIO didn\\'t add it (is it offered in ' + semester + '?)';
      continue;
    }
    r.result = 'added';
    if (!r.section) continue;
    const pick = radios(r.num).find((x) => norm(sectionOf(x)) === norm(r.section));
    if (!pick) {
      r.note = 'section ' + r.section + ' isn\\'t listed in SIO; kept SIO\\'s default';
      continue;
    }
    if (!pick.checked) {
      pick.click();
      await settled();
      const now = radios(r.num).find((x) => norm(sectionOf(x)) === norm(r.section));
      if (!now || !now.checked) r.note = 'couldn\\'t select section ' + r.section + '; pick it in SIO';
    }
  }

  console.table(toAdd.map(({ course, title, section, result, note }) => ({ course, title, section, result, note })));
  const done = toAdd.filter((r) => r.result === 'added').length;
  alert('Added ' + done + ' of ' + toAdd.length + ' course' + (toAdd.length === 1 ? '' : 's') + ' to "' + planName + '".' + (toAdd.some((r) => r.note) ? ' See the console for notes.' : ''));
})();
`
}
