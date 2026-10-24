import { RotateCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isStaleBuildError } from '../lib/app-update'
import { Button } from './ui'

/** Catches a page that fails to load or render, so the rest of the app (header, navigation) stays usable. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isStaleBuildError(error)
    return (
      <div role="alert" className="grid h-full min-h-60 place-items-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="display text-3xl text-ink">{stale ? 'Courseweave was updated' : "This page didn't load"}</h1>
          <p className="text-ink-2">
            {stale
              ? 'A new version came out while this tab was open. Reload to get it; your plans and schedules are saved.'
              : 'Something went wrong showing this page. Reloading usually fixes it; your plans and schedules are saved.'}
          </p>
          {!stale && error instanceof Error ? <p className="text-[12.5px] break-words text-muted">{error.message}</p> : null}
          <Button variant="primary" onClick={() => location.reload()}>
            <RotateCw aria-hidden className="size-4" />
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
