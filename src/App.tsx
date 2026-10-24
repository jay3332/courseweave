import { Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams, Outlet } from 'react-router'
import { AppShell } from './components/AppShell'
import { CoursePreviewLayer } from './components/CoursePreview'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { Spinner } from './components/ui'
import { lazyPage } from './lib/app-update'
import { useOnboardingDue } from './state/onboarding'
import { useSession } from './state/session'
import { startSync, stopSync } from './state/sync'
import { TermProvider, useTerms } from './state/term'

// Each page is its own chunk, so the first visit only downloads the page it opens. After a deploy, a stale chunk
// reloads the page (lazyPage).
const RequisitesPage = lazyPage(() => import('./features/catalog/RequisitesPage').then((m) => ({ default: m.RequisitesPage })))
const CoursesPage = lazyPage(() => import('./features/explorer/CoursesPage').then((m) => ({ default: m.CoursesPage })))
const CourseFullPage = lazyPage(() => import('./features/explorer/CourseFullPage').then((m) => ({ default: m.CourseFullPage })))
const InstructorsPage = lazyPage(() => import('./features/instructors/InstructorsPage').then((m) => ({ default: m.InstructorsPage })))
const SchedulePage = lazyPage(() => import('./features/planner/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const RecordPage = lazyPage(() => import('./features/record/RecordPage').then((m) => ({ default: m.RecordPage })))
const PlanPage = lazyPage(() => import('./features/degree/PlanPage').then((m) => ({ default: m.PlanPage })))
const RecordOnboarding = lazyPage(() => import('./features/record/RecordStart'))

export default function App() {
  return (
    <BrowserRouter>
      <SessionBoot />
      <Routes>
        <Route index element={<DefaultTermRedirect />} />
        <Route path=":termId" element={<AppShell />}>
          <Route element={<TermLayout />}>
            <Route index element={<Navigate to="courses" replace />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="courses/:courseCode" element={<CoursesPage />} />
            <Route path="courses/:courseCode/full" element={<CourseFullPage />} />
            <Route path="instructors" element={<InstructorsPage />} />
            <Route path="instructors/:slug" element={<InstructorsPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="requisites" element={<RequisitesPage />} />
            <Route path="requisites/:courseCode" element={<RequisitesPage />} />
            <Route path="record" element={<RecordPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="plan/:planId" element={<PlanPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

/** Checks who's signed in, surfaces sign-in errors, and runs cloud sync while signed in. */
function SessionBoot() {
  const [params, setParams] = useSearchParams()
  const status = useSession((s) => s.status)

  useEffect(() => {
    void useSession.getState().refresh()
  }, [])

  useEffect(() => {
    const error = params.get('auth_error')
    if (!error) return
    useSession.getState().setAuthError(error === 'domain' ? 'domain' : 'failed')
    const next = new URLSearchParams(params)
    next.delete('auth_error')
    setParams(next, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (status === 'signed-in') void startSync()
    else if (status !== 'loading') stopSync()
  }, [status])

  return null
}

function DefaultTermRedirect() {
  const terms = useTerms()
  const navigate = useNavigate()
  useEffect(() => {
    if (terms.status === 'ready' && terms.value.length) navigate(`/${terms.value[0].id}/courses`, { replace: true })
  }, [terms, navigate])
  if (terms.status === 'error') return <FullMessage title="Couldn't load semesters">{terms.error}</FullMessage>
  if (terms.status === 'ready' && !terms.value.length) return <FullMessage title="No semesters yet">Add a term to data/terms.json and run npm run data.</FullMessage>
  return <Loading />
}

function TermLayout() {
  const { termId = '' } = useParams()
  // A page that failed gets another try on the next navigation.
  const { pathname } = useLocation()
  return (
    <TermProvider
      termId={termId}
      fallback={<Loading />}
      error={(message) => (
        <FullMessage title="Semester not found">
          {message} <Link className="text-accent underline" to="/">Go to the latest semester</Link>.
        </FullMessage>
      )}
    >
      <PageErrorBoundary key={pathname}>
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </PageErrorBoundary>
      <CoursePreviewLayer />
      <Onboarding />
    </TermProvider>
  )
}

/** Asks new students (and new accounts) to add their academic record, once. The record page asks on its own. */
function Onboarding() {
  const due = useOnboardingDue()
  const onRecordPage = useLocation().pathname.split('/')[2] === 'record'
  // Stays open once shown, so a record imported from the dialog can still show its confirmation.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (due && !onRecordPage) setOpen(true)
  }, [due, onRecordPage])
  if (!open) return null
  return (
    <PageErrorBoundary>
      <Suspense fallback={null}>
        <RecordOnboarding onClose={() => setOpen(false)} />
      </Suspense>
    </PageErrorBoundary>
  )
}

function Loading() {
  return (
    <div className="grid h-full min-h-40 place-items-center">
      <Spinner label="Loading course data" />
    </div>
  )
}

function FullMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full min-h-60 place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="display mb-2 text-3xl">{title}</h1>
        <p className="text-ink-2">{children}</p>
      </div>
    </div>
  )
}

function NotFound() {
  const { termId } = useParams()
  return (
    <FullMessage title="Page not found">
      There's nothing at this address. <Link className="text-accent underline" to={`/${termId}/courses`}>Browse courses</Link>.
    </FullMessage>
  )
}
