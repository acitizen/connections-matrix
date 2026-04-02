const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pairs (
      id     TEXT PRIMARY KEY,
      cohort TEXT NOT NULL,
      label  TEXT NOT NULL,
      code   TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      rater_pair    TEXT    NOT NULL REFERENCES pairs(id),
      rated_pair    TEXT    NOT NULL REFERENCES pairs(id),
      scores        TEXT    NOT NULL,
      notes         TEXT,
      timestamp     TEXT    NOT NULL,
      UNIQUE(rater_pair, rated_pair)
    );

    CREATE TABLE IF NOT EXISTS rankings (
      pair_id TEXT PRIMARY KEY REFERENCES pairs(id),
      rank_1  TEXT NOT NULL REFERENCES pairs(id),
      rank_2  TEXT NOT NULL REFERENCES pairs(id),
      rank_3  TEXT NOT NULL REFERENCES pairs(id)
    );
  `);

  // Add code column if upgrading from old schema
  try { db.exec('ALTER TABLE pairs ADD COLUMN code TEXT UNIQUE'); } catch {}
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function seedPairs(pairs) {
  const existing = db.prepare('SELECT code FROM pairs').all().map(r => r.code).filter(Boolean);
  const usedCodes = new Set(existing);

  const insert = db.prepare(
    'INSERT OR IGNORE INTO pairs (id, cohort, label, code) VALUES (?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const p of pairs) {
      let code = p.code;
      if (!code) {
        do { code = generateCode(); } while (usedCodes.has(code));
        usedCodes.add(code);
      }
      insert.run(p.id, p.cohort, p.label || p.id, code);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getPairs() {
  return db.prepare('SELECT * FROM pairs ORDER BY id').all();
}

function getPairById(id) {
  return db.prepare('SELECT * FROM pairs WHERE id = ?').get(id);
}

function getPairByCode(code) {
  return db.prepare('SELECT * FROM pairs WHERE code = ?').get(code.toUpperCase());
}

// scores is an object like { axis0: 3, axis1: 4, axis2: 5 }
function upsertRating({ raterPair, ratedPair, scores, notes }) {
  const scoresJson = typeof scores === 'string' ? scores : JSON.stringify(scores);
  db.prepare(`
    INSERT INTO ratings (rater_pair, rated_pair, scores, notes, timestamp)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(rater_pair, rated_pair) DO UPDATE SET
      scores    = excluded.scores,
      notes     = excluded.notes,
      timestamp = excluded.timestamp
  `).run(raterPair, ratedPair, scoresJson, notes || null, new Date().toISOString());
}

function upsertRanking({ pair, rank1, rank2, rank3 }) {
  db.prepare(`
    INSERT INTO rankings (pair_id, rank_1, rank_2, rank_3)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(pair_id) DO UPDATE SET
      rank_1 = excluded.rank_1,
      rank_2 = excluded.rank_2,
      rank_3 = excluded.rank_3
  `).run(pair, rank1, rank2, rank3);
}

function getAllRatings() {
  return db.prepare('SELECT * FROM ratings ORDER BY timestamp').all();
}

function getRatingsForPair(raterPair) {
  return db.prepare(
    'SELECT * FROM ratings WHERE rater_pair = ? ORDER BY rated_pair'
  ).all(raterPair);
}

function updatePairLabel(id, label) {
  db.prepare('UPDATE pairs SET label = ? WHERE id = ?').run(label, id);
}

function resetSession() {
  db.exec('DELETE FROM ratings');
  db.exec('DELETE FROM rankings');
  db.exec('DELETE FROM pairs');
}

function getAllRankings() {
  return db.prepare('SELECT * FROM rankings ORDER BY pair_id').all();
}

module.exports = {
  initSchema,
  seedPairs,
  getPairs,
  getPairById,
  getPairByCode,
  upsertRating,
  upsertRanking,
  getRatingsForPair,
  updatePairLabel,
  resetSession,
  getAllRatings,
  getAllRankings,
};
