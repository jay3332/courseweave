// Courseweave's Cloudflare Worker: CMU sign-in (OIDC), sessions and synced data in D1, the FCE gate, and 404s
// for missing data files. Static assets (dist/) are served by Cloudflare directly; see wrangler.jsonc.
import type { Env } from './env.ts'
import { handle } from './router.ts'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env)
  },
}
