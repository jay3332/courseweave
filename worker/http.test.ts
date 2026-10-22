import { describe, expect, it } from 'vitest'
import { signPayload, verifyPayload } from './crypto.ts'
import { csrfCheck, isLocalHttp, parseCookies, safeReturnTo, serializeCookie, withQuery } from './http.ts'

describe('cookies', () => {
  it('parses a Cookie header, decoding values and ignoring junk', () => {
    const c = parseCookies('a=1; b="two"; c=hello%20world; =bad; d; a=ignored-duplicate')
    expect(c.get('a')).toBe('1')
    expect(c.get('b')).toBe('two')
    expect(c.get('c')).toBe('hello world')
    expect(c.has('d')).toBe(false)
    expect(parseCookies(null).size).toBe(0)
  })

  it('serializes with safe defaults', () => {
    expect(serializeCookie('__Host-cw_session', 'abc', { maxAge: 60, secure: true })).toBe('__Host-cw_session=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax')
    expect(serializeCookie('cw_oidc', '', { path: '/auth', maxAge: 0 })).toBe('cw_oidc=; Path=/auth; Max-Age=0; HttpOnly; SameSite=Lax')
  })

  it('only treats plain-http localhost as local', () => {
    expect(isLocalHttp(new URL('http://localhost:8787/'))).toBe(true)
    expect(isLocalHttp(new URL('http://127.0.0.1/'))).toBe(true)
    expect(isLocalHttp(new URL('https://localhost/'))).toBe(false)
    expect(isLocalHttp(new URL('http://courseweave.example/'))).toBe(false)
  })
})

describe('safeReturnTo', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(safeReturnTo('/S27/schedule?x=1#top')).toBe('/S27/schedule?x=1#top')
    expect(safeReturnTo('/')).toBe('/')
  })

  it('rejects anything that could leave the site or loop', () => {
    for (const bad of ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'S27', '', null, undefined, '/auth/login', '/auth', '/a\u0000b', '/a\\b']) {
      expect(safeReturnTo(bad)).toBe('/')
    }
  })

  it('adds query parameters to a return path', () => {
    expect(withQuery('/S27/schedule?x=1#top', 'auth_error', 'domain')).toBe('/S27/schedule?x=1&auth_error=domain#top')
  })
})

describe('csrfCheck', () => {
  const req = (method: string, headers: Record<string, string>) => new Request('https://courseweave.example/api/sync/plan', { method, headers })

  it('lets reads through', () => {
    expect(csrfCheck(req('GET', {}))).toBeNull()
  })

  it('requires same-origin JSON for writes', async () => {
    expect(csrfCheck(req('PUT', { 'Content-Type': 'application/json', Origin: 'https://courseweave.example' }))).toBeNull()
    expect(csrfCheck(req('PUT', { 'Content-Type': 'application/json; charset=utf-8', Origin: 'https://courseweave.example' }))).toBeNull()
    const cases: Record<string, string>[] = [
      { 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      { 'Content-Type': 'text/plain', Origin: 'https://courseweave.example' },
      { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://courseweave.example' },
    ]
    for (const headers of cases) {
      const res = csrfCheck(req('PUT', headers))
      expect(res?.status).toBe(403)
      expect(((await res!.json()) as { code: string }).code).toBe('forbidden')
    }
  })

  it('accepts configured dev origins', () => {
    expect(csrfCheck(req('DELETE', { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }), ['http://localhost:5173'])).toBeNull()
  })
})

describe('signed payloads', () => {
  it('round-trips and rejects tampering or the wrong secret', async () => {
    const signed = await signPayload({ s: 'state', e: 1 }, 'secret')
    expect(await verifyPayload(signed, 'secret')).toEqual({ s: 'state', e: 1 })
    expect(await verifyPayload(signed, 'other')).toBeNull()
    const [body, sig] = signed.split('.')
    expect(await verifyPayload(`${body}x.${sig}`, 'secret')).toBeNull()
    expect(await verifyPayload('garbage', 'secret')).toBeNull()
    expect(await verifyPayload(undefined, 'secret')).toBeNull()
  })
})
