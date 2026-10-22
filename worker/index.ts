// Courseweave's Cloudflare Worker: CMU sign-in (OIDC), sessions and synced data in D1, the FCE gate, and 404s
// for missing data files. Static assets (dist/) are served by Cloudflare directly; see wrangler.jsonc.
import { d1Store } from './db.ts'
import type { Env } from './env.ts'
import { handle } from './router.ts'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env)
  },

  /** Daily Cron Trigger (wrangler.jsonc "triggers"): deletes expired sessions. Errors are logged, never retried. */
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(cleanup(env))
  },
}

export async function cleanup(env: Env, now = Date.now()): Promise<void> {
  if (!env.DB) return
  try {
    await d1Store(env.DB).deleteExpiredSessions(now)
  } catch (e) {
    console.error('Session cleanup failed:', e instanceof Error ? e.message : e)
  }
}
