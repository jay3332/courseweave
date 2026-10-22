/**
 * Whether a data response is real JSON. On Cloudflare, a missing static file falls back to index.html with 200
 * (SPA routing), so `r.ok` alone doesn't mean the file exists.
 */
export function isJsonResponse(r: Response): boolean {
  return r.ok && (r.headers.get('content-type') ?? '').includes('json')
}
