-- Creating Connections — D1 schema
-- Run with: npx wrangler d1 execute creating-connections-db --file=migrations/0001_schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'facilitator',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  config     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pairs (
  id         TEXT PRIMARY KEY,
  cohort     TEXT NOT NULL,
  label      TEXT NOT NULL,
  code       TEXT UNIQUE,
  session_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rater_pair TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  rated_pair TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  scores     TEXT NOT NULL,
  notes      TEXT,
  timestamp  TEXT NOT NULL,
  session_id INTEGER REFERENCES app_sessions(id) ON DELETE CASCADE,
  UNIQUE(rater_pair, rated_pair)
);
