// Per-page title and canonical link. index.html (and the course pages scripts/build-seo.ts writes) set them for the
// first load; this keeps them right as the app navigates, so search engines rendering the app see the same.
import { useEffect } from 'react'
import { SITE } from './site'

function setCanonical(href: string | null) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = href
}

/** Sets the page title and canonical address (a path on this site) while the page is shown. */
export function useHead(title: string, canonicalPath?: string) {
  useEffect(() => {
    const previousTitle = document.title
    const previousCanonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null
    document.title = title
    if (canonicalPath !== undefined) setCanonical(`${SITE}${canonicalPath}`)
    return () => {
      document.title = previousTitle
      if (canonicalPath !== undefined) setCanonical(previousCanonical)
    }
  }, [title, canonicalPath])
}
