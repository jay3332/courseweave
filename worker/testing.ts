// Test helpers: an in-memory Store with the same semantics as the D1 one. Not imported by the Worker.
import type { SyncKey } from '../src/lib/api-types.ts'
import { MAX_SESSIONS_PER_USER, utcDay, type Store, type StoredDoc, type User } from './db.ts'

type MemSession = { userId: string; createdAt: number; expiresAt: number }

export function memoryStore(): Store & { users: Map<string, User>; sessions: Map<string, MemSession>; docs: Map<string, StoredDoc> } {
  const users = new Map<string, User>()
  const sessions = new Map<string, MemSession>()
  const docs = new Map<string, StoredDoc>()
  const docKey = (userId: string, key: SyncKey) => `${userId}/${key}`
  let nextId = 1

  return {
    users,
    sessions,
    docs,
    async upsertUser(profile) {
      const existing = [...users.values()].find((u) => u.email === profile.email)
      if (existing) {
        Object.assign(existing, { name: profile.name, picture: profile.picture })
        return { ...existing }
      }
      const user = { id: `user-${nextId++}`, ...profile }
      users.set(user.id, user)
      return { ...user }
    },
    async createSession(idHash, userId, now, expiresAt) {
      sessions.set(idHash, { userId, createdAt: now, expiresAt })
      const mine = [...sessions.entries()].filter(([, s]) => s.userId === userId).sort((a, b) => b[1].createdAt - a[1].createdAt)
      for (const [k] of mine.slice(MAX_SESSIONS_PER_USER)) sessions.delete(k)
    },
    async findSession(idHash) {
      const s = sessions.get(idHash)
      const user = s && users.get(s.userId)
      return s && user ? { user: { ...user }, expiresAt: s.expiresAt } : null
    },
    async touchSession(idHash, expiresAt) {
      const s = sessions.get(idHash)
      if (s) s.expiresAt = expiresAt
    },
    async deleteSession(idHash) {
      sessions.delete(idHash)
    },
    async deleteExpiredSessions(now) {
      for (const [k, s] of sessions) if (s.expiresAt < now) sessions.delete(k)
    },
    async getDocs(userId) {
      return [...docs.entries()].filter(([k]) => k.startsWith(`${userId}/`)).map(([, d]) => ({ ...d }))
    },
    async getDoc(userId, key) {
      const d = docs.get(docKey(userId, key))
      return d ? { ...d } : null
    },
    async insertDoc(userId, key, data, now) {
      if (docs.has(docKey(userId, key))) return false
      docs.set(docKey(userId, key), { key, data, rev: 1, updatedAt: now, day: utcDay(now), dayWrites: 1 })
      return true
    },
    async updateDoc(userId, key, data, baseRev, now, dailyCap) {
      const d = docs.get(docKey(userId, key))
      const day = utcDay(now)
      if (!d || d.rev !== baseRev || (d.day === day && d.dayWrites >= dailyCap)) return false
      docs.set(docKey(userId, key), { key, data, rev: baseRev + 1, updatedAt: now, day, dayWrites: d.day === day ? d.dayWrites + 1 : 1 })
      return true
    },
    async deleteUser(userId) {
      users.delete(userId)
      for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k)
      for (const k of docs.keys()) if (k.startsWith(`${userId}/`)) docs.delete(k)
    },
  }
}
