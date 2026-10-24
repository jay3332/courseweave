// After a deploy, a tab opened before it still asks for the previous build's code files, which are gone: the server
// answers with index.html and the page's import fails. Reloading loads the new build. A guard in sessionStorage stops
// a reload loop when reloading doesn't help (the file really is missing, or the network is down).
import { lazy, type ComponentType } from 'react'

const KEY = 'courseweave:reloaded-for-update'
let pending = false

/** True for the errors browsers give when a dynamically imported file is missing or isn't JavaScript. */
export function isStaleBuildError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return /dynamically imported module|importing a module script failed|expected a javascript.*module script|unable to preload|failed to load module script/i.test(
    message,
  )
}

/** Reloads to pick up a new build, at most once a minute. False when it can't (it just did, or storage is off). */
export function reloadForUpdate(): boolean {
  if (pending) return true
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  pending = true
  location.reload()
  return true
}

/** React.lazy for a page that reloads instead of failing when its file is from an older build. */
// oxlint-disable-next-line no-explicit-any -- React.lazy's own constraint
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e: unknown): Promise<{ default: T }> => {
      // Never settles: the page is about to reload.
      if (isStaleBuildError(e) && reloadForUpdate()) return new Promise(() => {})
      throw e
    }),
  )
}
