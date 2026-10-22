// Storage: a narrow Store interface (what sessions and sync need) and its D1 implementation.
// Tests use an in-memory Store, so none of this needs workerd to test.
import type { SyncKey } from '../src/lib/api-types.ts'

/** The slice of Cloudflare's D1 API this Worker uses. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
}

export interface D1Like {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

export interface User {
  id: string
  email: string
  name: string | null
  picture: string | null
}

export interface StoredDoc {
  key: SyncKey
  /** JSON text. */
  data: string
  rev: number
  updatedAt: number
}

export interface Store {
  /** Creates the user or refreshes their profile, by email. */
  upsertUser(profile: { email: string; name: string | null; picture: string | null }, now: number): Promise<User>
  createSession(idHash: string, userId: string, now: number, expiresAt: number): Promise<void>
  findSession(idHash: string): Promise<{ user: User; expiresAt: number } | null>
  touchSession(idHash: string, expiresAt: number): Promise<void>
  deleteSession(idHash: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<void>
  getDocs(userId: string): Promise<StoredDoc[]>
  getDoc(userId: string, key: SyncKey): Promise<StoredDoc | null>
  /** Creates the doc at rev 1. False when it already exists. */
  insertDoc(userId: string, key: SyncKey, data: string, now: number): Promise<boolean>
  /** Writes rev + 1 only if the stored rev is `baseRev`. False otherwise (or when the doc doesn't exist). */
  updateDoc(userId: string, key: SyncKey, data: string, baseRev: number, now: number): Promise<boolean>
  /** Removes the user, their sessions and their docs. */
  deleteUser(userId: string): Promise<void>
}

interface UserRow {
  id: string
  email: string
  name: string | null
  picture: string | null
}

interface DocRow {
  key: SyncKey
  data: string
  rev: number
  updated_at: number
}

const docFrom = (r: DocRow): StoredDoc => ({ key: r.key, data: r.data, rev: r.rev, updatedAt: r.updated_at })

export function d1Store(db: D1Like): Store {
  return {
    async upsertUser(profile, now) {
      const row = await db
        .prepare(
          `INSERT INTO users (id, email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_login = excluded.last_login
           RETURNING id, email, name, picture`,
        )
        .bind(crypto.randomUUID(), profile.email, profile.name, profile.picture, now, now)
        .first<UserRow>()
      if (!row) throw new Error('Could not save the user.')
      return row
    },

    async createSession(idHash, userId, now, expiresAt) {
      await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(idHash, userId, now, expiresAt).run()
    },

    async findSession(idHash) {
      const row = await db
        .prepare(
          `SELECT s.expires_at, u.id, u.email, u.name, u.picture
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
        )
        .bind(idHash)
        .first<UserRow & { expires_at: number }>()
      if (!row) return null
      return { user: { id: row.id, email: row.email, name: row.name, picture: row.picture }, expiresAt: row.expires_at }
    },

    async touchSession(idHash, expiresAt) {
      await db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(expiresAt, idHash).run()
    },

    async deleteSession(idHash) {
      await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run()
    },

    async deleteExpiredSessions(now) {
      await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run()
    },

    async getDocs(userId) {
      const { results } = await db.prepare('SELECT key, data, rev, updated_at FROM docs WHERE user_id = ?').bind(userId).all<DocRow>()
      return results.map(docFrom)
    },

    async getDoc(userId, key) {
      const row = await db.prepare('SELECT key, data, rev, updated_at FROM docs WHERE user_id = ? AND key = ?').bind(userId, key).first<DocRow>()
      return row ? docFrom(row) : null
    },

    async insertDoc(userId, key, data, now) {
      const res = await db
        .prepare('INSERT INTO docs (user_id, key, data, rev, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (user_id, key) DO NOTHING')
        .bind(userId, key, data, now)
        .run()
      return res.meta.changes === 1
    },

    async updateDoc(userId, key, data, baseRev, now) {
      const res = await db
        .prepare('UPDATE docs SET data = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND key = ? AND rev = ?')
        .bind(data, now, userId, key, baseRev)
        .run()
      return res.meta.changes === 1
    },

    async deleteUser(userId) {
      await db.batch([
        db.prepare('DELETE FROM docs WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
      ])
    },
  }
}
