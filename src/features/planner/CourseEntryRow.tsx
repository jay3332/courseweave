import { AlertTriangle, Eye, EyeOff, X } from 'lucide-react'
import { Link } from 'react-router'
import { IconButton } from '../../components/ui'
import { childSections, topSections } from '../../lib/sections'
import type { Section } from '../../lib/types'
import type { ResolvedEntry, ScheduleView } from '../../state/schedule-view'
import { useStore } from '../../state/store'
import { ColorPicker } from './ColorPicker'
import { childForSection, conflictingCodes, joinList, meetingSummary, PASS_FAIL_ONLY_HELP, partLabel, unitsText } from './format'
import type { Preview } from './types'
import { SectionPicker } from './SectionPicker'

interface CourseEntryRowProps {
  resolved: ResolvedEntry
  view: ScheduleView
  scheduleId: string
  termId: string
  selected: boolean
  onSelect(): void
  onPreview(preview: Preview | null): void
}

export function CourseEntryRow({ resolved, view, scheduleId, termId, selected, onSelect, onPreview }: CourseEntryRowProps) {
  const { entry, course, section, child, needsChild } = resolved
  const setColor = useStore((s) => s.setColor)
  const setSection = useStore((s) => s.setSection)
  const setChild = useStore((s) => s.setChild)
  const setPassFail = useStore((s) => s.setPassFail)
  const toggleHidden = useStore((s) => s.toggleHidden)
  const removeCourse = useStore((s) => s.removeCourse)

  const conflicts = (view.conflicts.get(course.id) ?? []).map((id) => view.entries.find((e) => e.course.id === id)?.course.code ?? id)
  const hidden = entry.hidden
  const tops = topSections(course)
  const children = section ? childSections(course, section.name) : []
  const topNoun = tops.every((s) => s.kind === 'lecture') ? 'lecture' : 'section'
  const conflictsFor = (s: Section) => conflictingCodes(s, course.id, view)
  const passFailOnly = Boolean(course.passFail)

  return (
    <li
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, input, label, [role="listbox"]')) onSelect()
      }}
      className={`group relative rounded-lg border px-2.5 py-2 transition-colors ${
        selected ? 'border-ink-2 bg-surface-2' : 'border-transparent hover:border-line'
      }`}
    >
      <div className="flex items-start gap-1.5">
        <ColorPicker color={entry.color} courseCode={course.code} onChange={(c) => setColor(scheduleId, course.id, c)} />
        <div className={`min-w-0 flex-1 ${hidden ? 'opacity-50' : ''}`}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="course-code text-[17px] text-ink">{course.code}</span>
            <span className="text-[12px] text-muted">{unitsText(course.units)}</span>
            {!resolved.factorable ? (
              <span className="text-[12px] text-muted" title={passFailOnly ? PASS_FAIL_ONLY_HELP : "You're taking this pass/fail, so its units don't count toward your QPA."}>
                not factorable
              </span>
            ) : null}
            {hidden ? <span className="text-[12px] text-muted">Hidden</span> : null}
          </div>
          <Link
            to={`/${termId}/courses/${course.code}`}
            className="block truncate text-[13.5px] text-ink-2 hover:text-ink hover:underline"
            title={course.title}
          >
            {course.title}
          </Link>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton size="sm" label={hidden ? `Show ${course.code} on calendar` : `Hide ${course.code} from calendar`} onClick={() => toggleHidden(scheduleId, course.id)}>
            {hidden ? <EyeOff /> : <Eye />}
          </IconButton>
          <IconButton size="sm" label={`Remove ${course.code}`} onClick={() => removeCourse(scheduleId, course.id)}>
            <X />
          </IconButton>
        </div>
      </div>

      <div className={`mt-1.5 flex flex-col gap-1.5 pl-[30px] ${hidden ? 'opacity-50' : ''}`}>
        {tops.length > 1 ? (
          <SectionPicker
            noun={topNoun}
            listLabel={`${topNoun === 'lecture' ? 'Lectures' : 'Sections'} of ${course.code}`}
            options={tops}
            current={section}
            conflictsFor={conflictsFor}
            onChange={(name) => name !== section?.name && setSection(scheduleId, course.id, name, childForSection(course, name, view))}
            onPreview={(name) => onPreview(name ? { courseId: course.id, sections: [name] } : null)}
          />
        ) : section ? (
          <PartLine section={section} />
        ) : null}

        {section && children.length > 1 ? (
          <SectionPicker
            noun="recitation"
            listLabel={`Recitations of ${course.code} ${partLabel(section)}`}
            options={children}
            current={child}
            conflictsFor={conflictsFor}
            placeholder={`Choose a recitation for ${partLabel(section)}`}
            onChange={(name) => setChild(scheduleId, course.id, name)}
            onPreview={(name) => onPreview(name ? { courseId: course.id, sections: [name] } : null)}
          />
        ) : child ? (
          <PartLine section={child} />
        ) : null}

        {needsChild && children.length > 1 ? (
          <p className="text-[12.5px] text-warn">Pick a recitation to finish this course's schedule.</p>
        ) : null}

        {!hidden && conflicts.length ? (
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
            Conflicts with {joinList(conflicts)}
          </p>
        ) : null}

        {passFailOnly ? (
          <p className="text-[12.5px] text-muted" title={PASS_FAIL_ONLY_HELP}>
            Pass/fail only
          </p>
        ) : (
          <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2" title="Pass/fail units don't count toward your QPA.">
            <input
              type="checkbox"
              checked={entry.passFail}
              onChange={(e) => setPassFail(scheduleId, course.id, e.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            Take pass/fail
          </label>
        )}
      </div>
    </li>
  )
}

function PartLine({ section }: { section: Section }) {
  return (
    <p className="flex min-w-0 gap-2 text-[13px] text-ink-2">
      <span className="shrink-0 font-semibold text-ink">{partLabel(section)}</span>
      <span className="truncate">{meetingSummary(section)}</span>
    </p>
  )
}
