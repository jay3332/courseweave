// Runs only for requests that don't match a static asset and aren't page navigations (those get index.html).
// Data files the app fetches must 404 when missing, not fall back to index.html: optional data such as FCEs
// (left out of public deploys) is detected by its 404.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/data/')) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return env.ASSETS.fetch(request)
  },
}
