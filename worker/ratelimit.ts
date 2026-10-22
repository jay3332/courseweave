// Request limits, via Cloudflare's Workers Rate Limiting bindings (wrangler.jsonc "ratelimits"). Counters are per
// Cloudflare location and approximate; they protect D1 and the OAuth provider from bursts. Daily totals are capped
// separately (per-document write cap in D1, and the zone WAF rule described in the README).
import { apiError } from './http.ts'

/** The Workers Rate Limiting binding API. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** True when the request may proceed. A missing binding (local dev, tests) or a limiter error lets it through. */
export async function allow(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true
  try {
    return (await limiter.limit({ key })).success
  } catch {
    return true
  }
}

/** 429 with Retry-After (seconds). */
export function tooMany(retryAfterSeconds: number, message = 'Too many requests; try again shortly.'): Response {
  return apiError(429, 'too_many', message, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) })
}

/** The client's IP as Cloudflare saw it (the Worker only runs behind Cloudflare, so the header is authoritative). */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}
