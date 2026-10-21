import type { ReactNode } from 'react'
import { WeekGrid, type CalendarBlock } from '../../components/WeekGrid'
import { nextColor } from '../../lib/colors'
import { childSections, topSections } from '../../lib/sections'
import type { Section } from '../../lib/types'
import type { ScheduleView } from '../../state/schedule-view'
import { useTerm } from '../../state/term'
import { conflictingCodes, joinList, meetingSummary, partBlocks, partLabel } from './format'
import type { CalendarSelection, Preview } from './types'

interface PlannerCalendarProps {
  view: ScheduleView
  selected: CalendarSelection | null
  onSelect(selection: CalendarSelection | null): void
  onSwitchSection(courseId: string, section: string): void
  onSwitchChild(courseId: string, child: string): void
  preview: Preview | null
  /** Show only full-semester sections and this mini. Null = everything. */
  mini: number | null
  compact: boolean
  hourHeight: number
  empty: ReactNode
}

export function PlannerCalendar({ view, selected, onSelect, onSwitchSection, onSwitchChild, preview, mini, compact, hourHeight, empty }: PlannerCalendarProps) {
  const term = useTerm()
  const inSession = (s: Section) => mini === null || s.mini === null || s.mini === mini

  const blocks: CalendarBlock[] = []

  for (const { entry, course, section, child, parts } of view.placed) {
    for (const part of parts) {
      if (!inSession(part)) continue
      const level = part === section ? 'section' : 'child'
      const isSelected = selected?.courseId === course.id && selected.level === level
      const alternatives = level === 'section' ? topSections(course).length > 1 : child !== null && childSections(course, section!.name).length > 1
      blocks.push(
        ...partBlocks(course, part, entry.color, {
          conflict: view.conflicts.has(course.id),
          selected: isSelected,
          onClick: () => onSelect(isSelected ? null : { courseId: course.id, level }),
          tooltip: `${course.code} ${course.title}, ${partLabel(part)}.${
            alternatives ? ` Click to see other ${level === 'section' ? (part.kind === 'lecture' ? 'lectures' : 'sections') : 'recitations'}.` : ''
          }`,
        }),
      )
    }
  }

  // Alternatives for the selected course, at the selected level.
  const selectedEntry = selected ? view.entries.find((e) => e.course.id === selected.courseId && !e.entry.hidden) : undefined
  if (selected && selectedEntry) {
    const { course, entry, section, child } = selectedEntry
    const options =
      selected.level === 'section' ? topSections(course).filter((s) => s.name !== section?.name) : section ? childSections(course, section.name).filter((s) => s.name !== child?.name) : []
    for (const s of options) {
      if (!inSession(s)) continue
      // A recitation alternative is checked alongside the current lecture.
      const conflicts = conflictingCodes(s, course.id, view)
      blocks.push(
        ...partBlocks(course, s, entry.color, {
          keyPrefix: 'ghost-',
          variant: 'ghost',
          ...(conflicts.length ? { detail: `${partLabel(s)}, conflicts with ${joinList(conflicts)}` } : {}),
          tooltip: `Switch ${course.code} to ${partLabel(s)} (${meetingSummary(s)})${conflicts.length ? `, conflicts with ${joinList(conflicts)}` : ''}`,
          onClick: () => (selected.level === 'section' ? onSwitchSection(course.id, s.name) : onSwitchChild(course.id, s.name)),
        }),
      )
    }
  }

  // Candidate from search or a hovered section option.
  if (preview) {
    const course = term.courseById.get(preview.courseId)
    if (course) {
      const entry = view.entries.find((e) => e.course.id === course.id)?.entry
      const color = entry?.color ?? nextColor(view.entries.map((e) => e.entry.color))
      const sections = preview.sections === null ? topSections(course) : course.sections.filter((s) => preview.sections!.includes(s.name))
      for (const s of sections) {
        if (!inSession(s)) continue
        blocks.push(...partBlocks(course, s, color, { keyPrefix: 'preview-', variant: 'preview' }))
      }
    }
  }

  return (
    <div
      onClick={(e) => {
        if (selected && !(e.target as HTMLElement).closest('button')) onSelect(null)
      }}
    >
      <WeekGrid blocks={blocks} compact={compact} hourHeight={hourHeight} empty={empty} />
    </div>
  )
}
