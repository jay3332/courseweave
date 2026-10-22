// Bindings and configuration (wrangler.jsonc vars, `wrangler secret put` secrets, .dev.vars locally).
import type { D1Like } from './db.ts'

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** D1 database with migrations/ applied. */
  DB?: D1Like
  /** OIDC issuer; discovery is read from <issuer>/.well-known/openid-configuration. */
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  /** HMAC key for the short-lived login-state cookie. Any long random string. */
  SESSION_SECRET?: string
  /** Comma-separated email domains allowed to sign in. */
  ALLOWED_EMAIL_DOMAINS?: string
  /** Extra origins allowed to send JSON writes (the Vite dev server in front of wrangler dev). */
  DEV_ORIGINS?: string
}

export const DEFAULT_ISSUER = 'https://accounts.google.com'
export const DEFAULT_DOMAINS = ['andrew.cmu.edu', 'cmu.edu']

export interface AuthConfig {
  issuer: string
  clientId: string
  clientSecret: string
  sessionSecret: string
  domains: string[]
}

/** Sign-in configuration, or null when it's incomplete (sign-in then reports 503 and FCE stays locked). */
export function authConfig(env: Env): AuthConfig | null {
  const clientId = env.OIDC_CLIENT_ID?.trim()
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim()
  const sessionSecret = env.SESSION_SECRET?.trim()
  if (!clientId || !clientSecret || !sessionSecret || !env.DB) return null
  return {
    issuer: (env.OIDC_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, ''),
    clientId,
    clientSecret,
    sessionSecret,
    domains: parseDomains(env.ALLOWED_EMAIL_DOMAINS),
  }
}

export function parseDomains(value: string | undefined): string[] {
  const list = (value ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return list.length ? list : DEFAULT_DOMAINS
}

export function devOrigins(env: Env): string[] {
  return (env.DEV_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
