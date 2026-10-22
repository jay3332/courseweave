import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams, Outlet } from 'react-router'
import { AppShell } from './components/AppShell'
import { Spinner } from './components/ui'
import { TermProvider, useTerms } from './state/term'

// Each page is its own chunk, so the first visit only downloads the page it opens.
const RequisitesPage = lazy(() => import('./features/catalog/RequisitesPage').then((m) => ({ default: m.RequisitesPage })))
const CoursesPage = lazy(() => import('./features/explorer/CoursesPage').then((m) => ({ default: m.CoursesPage })))
const InstructorsPage = lazy(() => import('./features/instructors/InstructorsPage').then((m) => ({ default: m.InstructorsPage })))
const SchedulePage = lazy(() => import('./features/planner/SchedulePage').then((m) => ({ default: m.SchedulePage })))
const RecordPage = lazy(() => import('./features/record/RecordPage').then((m) => ({ default: m.RecordPage })))
const PlanPage = lazy(() => import('./features/degree/PlanPage').then((m) => ({ default: m.PlanPage })))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<DefaultTermRedirect />} />
        <Route path=":termId" element={<AppShell />}>
          <Route element={<TermLayout />}>
            <Route index element={<Navigate to="courses" replace />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="courses/:courseCode" element={<CoursesPage />} />
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
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </TermProvider>
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
