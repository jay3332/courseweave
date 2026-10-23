import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nextColor } from '../lib/colors'

export interface ScheduleEntry {
  courseId: string
  /** Chosen top-level section (lecture or standalone), or null if the student hasn't picked one yet. */
  section: string | null
  /** Chosen child section (recitation/lab) of `section`, or null. */
  child: string | null
  /** The student elects pass/fail grading, so the units aren't factorable. */
  passFail: boolean
  /** Index into the course color palette (lib/colors.ts). */
  color: number
  /** Hidden courses stay in the schedule but are left off the calendar and unit total. */
  hidden: boolean
}

export interface Schedule {
  id: string
  termId: string
  name: string
  entries: ScheduleEntry[]
  createdAt: number
  updatedAt: number
}

export type Theme = 'system' | 'light' | 'dark'

/** What calendar blocks show besides the course code. */
export interface CalendarDisplay {
  /** Section label next to the code ("Lec 1", "Rec A"). */
  section: boolean
  time: boolean
  location: boolean
}

export interface SectionChoice {
  section: string | null
  child: string | null
}

interface State {
  schedules: Record<string, Schedule>
  /** termId → active schedule id. */
  activeSchedule: Record<string, string>
  /** termId → bookmarked course ids. */
  bookmarks: Record<string, string[]>
  theme: Theme
  calendarDisplay: CalendarDisplay
  /** Degree plan layout: semester cards (default) or the detailed, spreadsheet-style table. */
  planLayout: 'cards' | 'table'

  /** Makes sure the term has at least one schedule and an active one. Returns the active id. */
  ensureSchedule(termId: string): string
  createSchedule(termId: string, name?: string, entries?: ScheduleEntry[]): string
  renameSchedule(id: string, name: string): void
  duplicateSchedule(id: string): string
  deleteSchedule(id: string): void
  setActiveSchedule(termId: string, id: string): void

  addCourse(scheduleId: string, courseId: string, section?: string | null, child?: string | null): void
  removeCourse(scheduleId: string, courseId: string): void
  /** Picks a top-level section. The child resets unless given. */
  setSection(scheduleId: string, courseId: string, section: string | null, child?: string | null): void
  setChild(scheduleId: string, courseId: string, child: string | null): void
  /** Bulk assignment, e.g. applying a generated schedule. */
  setSections(scheduleId: string, sections: Record<string, SectionChoice>): void
  setPassFail(scheduleId: string, courseId: string, passFail: boolean): void
  setColor(scheduleId: string, courseId: string, color: number): void
  toggleHidden(scheduleId: string, courseId: string): void
  /** Moves a course in the schedule's list to just before another (null: the end). Order is only for organizing. */
  moveEntry(scheduleId: string, courseId: string, beforeCourseId: string | null): void

  toggleBookmark(termId: string, courseId: string): void
  setTheme(theme: Theme): void
  setCalendarDisplay(patch: Partial<CalendarDisplay>): void
  setPlanLayout(layout: 'cards' | 'table'): void
}

const uid = () => Math.random().toString(36).slice(2, 10)

function nextScheduleName(schedules: Schedule[]): string {
  let n = schedules.length + 1
  while (schedules.some((s) => s.name === `Schedule ${n}`)) n++
  return `Schedule ${n}`
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const updateSchedule = (id: string, fn: (s: Schedule) => Partial<Schedule>) =>
        set((state) => {
          const s = state.schedules[id]
          if (!s) return state
          return { schedules: { ...state.schedules, [id]: { ...s, ...fn(s), updatedAt: Date.now() } } }
        })

      return {
        schedules: {},
        activeSchedule: {},
        bookmarks: {},
        theme: 'system',
        calendarDisplay: { section: true, time: true, location: true },
        planLayout: 'cards',

        ensureSchedule(termId) {
          const { activeSchedule, schedules } = get()
          const active = activeSchedule[termId]
          if (active && schedules[active]) return active
          const existing = Object.values(schedules)
            .filter((s) => s.termId === termId)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]
          if (existing) {
            set({ activeSchedule: { ...activeSchedule, [termId]: existing.id } })
            return existing.id
          }
          return get().createSchedule(termId)
        },

        createSchedule(termId, name, entries = []) {
          const id = uid()
          const now = Date.now()
          set((state) => {
            const forTerm = Object.values(state.schedules).filter((s) => s.termId === termId)
            const schedule: Schedule = { id, termId, name: name ?? nextScheduleName(forTerm), entries, createdAt: now, updatedAt: now }
            return {
              schedules: { ...state.schedules, [id]: schedule },
              activeSchedule: { ...state.activeSchedule, [termId]: id },
            }
          })
          return id
        },

        renameSchedule(id, name) {
          updateSchedule(id, () => ({ name: name.trim() || 'Untitled schedule' }))
        },

        duplicateSchedule(id) {
          const s = get().schedules[id]
          if (!s) return id
          return get().createSchedule(s.termId, `${s.name} copy`, s.entries.map((e) => ({ ...e })))
        },

        deleteSchedule(id) {
          set((state) => {
            const s = state.schedules[id]
            if (!s) return state
            const { [id]: _removed, ...rest } = state.schedules
            const activeSchedule = { ...state.activeSchedule }
            if (activeSchedule[s.termId] === id) {
              const fallback = Object.values(rest)
                .filter((x) => x.termId === s.termId)
                .sort((a, b) => b.updatedAt - a.updatedAt)[0]
              if (fallback) activeSchedule[s.termId] = fallback.id
              else delete activeSchedule[s.termId]
            }
            return { schedules: rest, activeSchedule }
          })
        },

        setActiveSchedule(termId, id) {
          set((state) => ({ activeSchedule: { ...state.activeSchedule, [termId]: id } }))
        },

        addCourse(scheduleId, courseId, section = null, child = null) {
          updateSchedule(scheduleId, (s) => {
            const existing = s.entries.find((e) => e.courseId === courseId)
            if (existing) {
              return {
                entries: s.entries.map((e) =>
                  e.courseId === courseId ? { ...e, section: section ?? e.section, child: section ? child : e.child, hidden: false } : e,
                ),
              }
            }
            const color = nextColor(s.entries.map((e) => e.color))
            return { entries: [...s.entries, { courseId, section, child, color, hidden: false, passFail: false }] }
          })
        },

        removeCourse(scheduleId, courseId) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.filter((e) => e.courseId !== courseId) }))
        },

        setSection(scheduleId, courseId, section, child = null) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.map((e) => (e.courseId === courseId ? { ...e, section, child } : e)) }))
        },

        setChild(scheduleId, courseId, child) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.map((e) => (e.courseId === courseId ? { ...e, child } : e)) }))
        },

        setSections(scheduleId, sections) {
          updateSchedule(scheduleId, (s) => ({
            entries: s.entries.map((e) => (e.courseId in sections ? { ...e, ...sections[e.courseId] } : e)),
          }))
        },

        moveEntry(scheduleId, courseId, beforeCourseId) {
          updateSchedule(scheduleId, (s) => {
            const entry = s.entries.find((e) => e.courseId === courseId)
            if (!entry || beforeCourseId === courseId) return {}
            const rest = s.entries.filter((e) => e !== entry)
            const at = beforeCourseId ? rest.findIndex((e) => e.courseId === beforeCourseId) : -1
            rest.splice(at < 0 ? rest.length : at, 0, entry)
            return { entries: rest }
          })
        },

        setPassFail(scheduleId, courseId, passFail) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.map((e) => (e.courseId === courseId ? { ...e, passFail } : e)) }))
        },

        setColor(scheduleId, courseId, color) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.map((e) => (e.courseId === courseId ? { ...e, color } : e)) }))
        },

        toggleHidden(scheduleId, courseId) {
          updateSchedule(scheduleId, (s) => ({ entries: s.entries.map((e) => (e.courseId === courseId ? { ...e, hidden: !e.hidden } : e)) }))
        },

        toggleBookmark(termId, courseId) {
          set((state) => {
            const list = state.bookmarks[termId] ?? []
            const next = list.includes(courseId) ? list.filter((id) => id !== courseId) : [...list, courseId]
            return { bookmarks: { ...state.bookmarks, [termId]: next } }
          })
        },

        setTheme(theme) {
          set({ theme })
        },

        setPlanLayout(planLayout) {
          set({ planLayout })
        },
        setCalendarDisplay(patch) {
          set((state) => ({ calendarDisplay: { ...state.calendarDisplay, ...patch } }))
        },
      }
    },
    {
      // Storage key predates the Courseweave rename; kept so saved schedules survive.
      name: 'plaid',
      version: 2,
      migrate(persisted, version) {
        const state = persisted as Pick<State, 'schedules'>
        if (version < 2) {
          for (const s of Object.values(state.schedules ?? {})) {
            s.entries = s.entries.map((e) => ({ ...e, child: e.child ?? null, passFail: e.passFail ?? false }))
          }
        }
        return state as State
      },
    },
  ),
)

/** Schedules for a term, oldest first (tab order). */
export function useTermSchedules(termId: string): Schedule[] {
  const schedules = useStore((s) => s.schedules)
  return Object.values(schedules)
    .filter((s) => s.termId === termId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export function useActiveSchedule(termId: string): Schedule | null {
  return useStore((s) => {
    const id = s.activeSchedule[termId]
    return id ? (s.schedules[id] ?? null) : null
  })
}

export function useBookmarks(termId: string): string[] {
  return useStore((s) => s.bookmarks[termId]) ?? EMPTY
}

const EMPTY: string[] = []
