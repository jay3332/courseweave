import { Download, ExternalLink, Eye, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Dialog } from '../../components/ui'
import { syllabusHref, useCourseSyllabi } from '../../lib/syllabi'
import { PREVIEWABLE_TYPES, registryTermLabel, type SyllabusEntry } from '../../lib/syllabus-files'
import { FceSignIn } from '../fce/FceSignIn'
import { useMediaQuery } from '../planner/hooks'
import { PHONE_FULLSCREEN } from '../schedule-tools/dialog'

/** Semesters shown before "Show all". */
const FIRST_TERMS = 3

const sizeText = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`)
const sectionsText = (s: string[] | undefined) => (!s?.length ? 'All sections' : `${s.length === 1 ? 'Section' : 'Sections'} ${s.join(', ')}`)

/** Past syllabi from CMU's Syllabus Registry, by semester: preview PDFs here, download any file. CMU sign-in only. */
export function CourseSyllabi({ courseId, code, headingClass = 'display text-[20px] text-ink' }: { courseId: string; code: string; headingClass?: string }) {
  const syllabi = useCourseSyllabi(courseId)
  const [showAll, setShowAll] = useState(false)
  const [preview, setPreview] = useState<SyllabusEntry | null>(null)
  // Phones and small tablets open PDFs in the browser's own viewer; a framed PDF there shows one page at best.
  const framePreview = useMediaQuery('(min-width: 768px) and (pointer: fine)')

  const terms = useMemo(() => {
    if (!Array.isArray(syllabi)) return []
    const out: { term: string; entries: SyllabusEntry[] }[] = []
    for (const s of syllabi) {
      const last = out.at(-1)
      if (last?.term === s.term) last.entries.push(s)
      else out.push({ term: s.term, entries: [s] })
    }
    return out
  }, [syllabi])
  const shown = showAll ? terms : terms.slice(0, FIRST_TERMS)
  const files = Array.isArray(syllabi) ? syllabi.filter((s) => s.key).length : 0

  return (
    <section aria-labelledby={`syllabi-${courseId}`} className="min-w-0">
      <h2 id={`syllabi-${courseId}`} className={headingClass}>
        Past syllabi
      </h2>
      {syllabi === undefined ? (
        <div className="mt-2 h-10 animate-pulse rounded-lg bg-surface-2" aria-busy />
      ) : syllabi === 'locked' ? (
        <FceSignIn className="mt-2" subject="past syllabi" />
      ) : !syllabi.length ? (
        <p className="mt-1 text-[13.5px] text-ink-2">None for {code} in CMU’s syllabus registry, which goes back to summer 2019.</p>
      ) : (
        <>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted">
            {files} {files === 1 ? 'file' : 'files'} from CMU’s syllabus registry, across {terms.length} {terms.length === 1 ? 'semester' : 'semesters'}.
            Policies and schedules change; check the current course site.
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {shown.map((t) => (
              <li key={t.term} className="px-3 py-2.5">
                <div className="text-[13px] font-semibold text-ink">{registryTermLabel(t.term)}</div>
                <ul className="mt-1 flex flex-col gap-1">
                  {t.entries.map((s) => (
                    <SyllabusRow key={s.key ?? s.url} s={s} onPreview={framePreview ? () => setPreview(s) : null} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {terms.length > FIRST_TERMS ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 min-h-9 text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink md:min-h-0"
            >
              {showAll ? 'Show fewer semesters' : `Show all ${terms.length} semesters`}
            </button>
          ) : null}
        </>
      )}
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `${code} syllabus, ${registryTermLabel(preview.term)}` : 'Syllabus'}
        className={`w-[min(96vw,1100px)] ${PHONE_FULLSCREEN}`}
      >
        {preview?.key ? (
          <div className="flex flex-col gap-2 p-3">
            <iframe title={`${code} syllabus`} src={syllabusHref(preview.key)} className="h-[78vh] w-full rounded-md border border-line bg-surface-2" />
            <div className="flex justify-end">
              <a href={syllabusHref(preview.key, true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
                <Download aria-hidden className="size-4" />
                Download
              </a>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}

function SyllabusRow({ s, onPreview }: { s: SyllabusEntry; onPreview: (() => void) | null }) {
  const action = 'inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink md:h-7'
  if (!s.key) {
    return (
      <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
        <span className="min-w-0 flex-1 text-ink-2">
          {sectionsText(s.sections)} <span className="text-muted">on the course’s Canvas site, which usually needs enrollment</span>
        </span>
        <a href={s.url} target="_blank" rel="noopener noreferrer" className={action}>
          <ExternalLink aria-hidden className="size-3.5" />
          Canvas
        </a>
      </li>
    )
  }
  const previewable = PREVIEWABLE_TYPES.has(s.type ?? '')
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <FileText aria-hidden className="size-4 shrink-0 text-muted" />
        <span className="truncate text-ink">{sectionsText(s.sections)}</span>
        <span className="shrink-0 text-[12.5px] text-muted uppercase tabular-nums">
          {s.type}
          {s.size ? `, ${sizeText(s.size)}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center">
        {previewable ? (
          onPreview ? (
            <Button size="sm" variant="ghost" onClick={onPreview} className="max-md:h-9">
              <Eye aria-hidden className="size-3.5" />
              Preview
            </Button>
          ) : (
            <a href={syllabusHref(s.key)} target="_blank" rel="noopener" className={action}>
              <Eye aria-hidden className="size-3.5" />
              Open
            </a>
          )
        ) : null}
        <a href={syllabusHref(s.key, true)} className={action} aria-label={`Download ${sectionsText(s.sections).toLowerCase()} syllabus (${s.type})`}>
          <Download aria-hidden className="size-3.5" />
          Download
        </a>
      </span>
    </li>
  )
}
