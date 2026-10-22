// Test helpers: an in-memory Store with the same semantics as the D1 one. Not imported by the Worker.
import type { SyncKey } from '../src/lib/api-types.ts'
import type { Store, StoredDoc, User } from './db.ts'

export function memoryStore(): Store & { users: Map<string, User>; sessions: Map<string, { userId: string; expiresAt: number }>; docs: Map<string, StoredDoc> } {
  const users = new Map<string, User>()
  const sessions = new Map<string, { userId: string; expiresAt: number }>()
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
    async createSession(idHash, userId, _now, expiresAt) {
      sessions.set(idHash, { userId, expiresAt })
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
      docs.set(docKey(userId, key), { key, data, rev: 1, updatedAt: now })
      return true
    },
    async updateDoc(userId, key, data, baseRev, now) {
      const d = docs.get(docKey(userId, key))
      if (!d || d.rev !== baseRev) return false
      docs.set(docKey(userId, key), { key, data, rev: baseRev + 1, updatedAt: now })
      return true
    },
    async deleteUser(userId) {
      users.delete(userId)
      for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k)
      for (const k of docs.keys()) if (k.startsWith(`${userId}/`)) docs.delete(k)
    },
  }
}
