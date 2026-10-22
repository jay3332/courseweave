-- Courseweave accounts: users (from CMU sign-in), sessions, and each user's synced documents.
-- Apply with `npm run db:migrate:local` (wrangler dev) or `npm run db:migrate:remote` (production).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture TEXT,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

-- Only a SHA-256 hash of each session token is stored, so a database leak doesn't leak live sessions.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- One row per synced store ("schedules", "record", "plan"). `rev` drives optimistic concurrency.
CREATE TABLE docs (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
