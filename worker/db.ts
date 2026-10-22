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
  /** UTC day number of the last write, and how many writes happened that day (daily cap). */
  day: number
  dayWrites: number
}

/** UTC day number for a timestamp, as stored in docs.day. */
export const utcDay = (now: number) => Math.floor(now / 86_400_000)

/** Sessions kept per user; signing in again beyond this drops the oldest. */
export const MAX_SESSIONS_PER_USER = 10

export interface Store {
  /** Creates the user or refreshes their profile, by email. */
  upsertUser(profile: { email: string; name: string | null; picture: string | null }, now: number): Promise<User>
  /** Creates a session and drops the user's oldest beyond MAX_SESSIONS_PER_USER, in one batch. */
  createSession(idHash: string, userId: string, now: number, expiresAt: number): Promise<void>
  findSession(idHash: string): Promise<{ user: User; expiresAt: number } | null>
  touchSession(idHash: string, expiresAt: number): Promise<void>
  deleteSession(idHash: string): Promise<void>
  deleteExpiredSessions(now: number): Promise<void>
  getDocs(userId: string): Promise<StoredDoc[]>
  getDoc(userId: string, key: SyncKey): Promise<StoredDoc | null>
  /** Creates the doc at rev 1. False when it already exists. */
  insertDoc(userId: string, key: SyncKey, data: string, now: number): Promise<boolean>
  /**
   * Writes rev + 1 only if the stored rev is `baseRev` and the doc has had fewer than `dailyCap` writes today.
   * False otherwise (or when the doc doesn't exist); the caller tells conflicts from the cap by reading the doc.
   */
  updateDoc(userId: string, key: SyncKey, data: string, baseRev: number, now: number, dailyCap: number): Promise<boolean>
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
  day: number
  day_writes: number
}

const docFrom = (r: DocRow): StoredDoc => ({ key: r.key, data: r.data, rev: r.rev, updatedAt: r.updated_at, day: r.day, dayWrites: r.day_writes })
const DOC_COLUMNS = 'key, data, rev, updated_at, day, day_writes'

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
      await db.batch([
        db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(idHash, userId, now, expiresAt),
        db
          .prepare(
            `DELETE FROM sessions WHERE user_id = ? AND id_hash NOT IN
             (SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`,
          )
          .bind(userId, userId, MAX_SESSIONS_PER_USER),
      ])
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
      const { results } = await db.prepare(`SELECT ${DOC_COLUMNS} FROM docs WHERE user_id = ?`).bind(userId).all<DocRow>()
      return results.map(docFrom)
    },

    async getDoc(userId, key) {
      const row = await db.prepare(`SELECT ${DOC_COLUMNS} FROM docs WHERE user_id = ? AND key = ?`).bind(userId, key).first<DocRow>()
      return row ? docFrom(row) : null
    },

    async insertDoc(userId, key, data, now) {
      const res = await db
        .prepare(
          'INSERT INTO docs (user_id, key, data, rev, updated_at, day, day_writes) VALUES (?, ?, ?, 1, ?, ?, 1) ON CONFLICT (user_id, key) DO NOTHING',
        )
        .bind(userId, key, data, now, utcDay(now))
        .run()
      return res.meta.changes === 1
    },

    async updateDoc(userId, key, data, baseRev, now, dailyCap) {
      const day = utcDay(now)
      const res = await db
        .prepare(
          `UPDATE docs SET data = ?, rev = rev + 1, updated_at = ?,
             day_writes = CASE WHEN day = ? THEN day_writes + 1 ELSE 1 END, day = ?
           WHERE user_id = ? AND key = ? AND rev = ? AND (day <> ? OR day_writes < ?)`,
        )
        .bind(data, now, day, day, userId, key, baseRev, day, dailyCap)
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
