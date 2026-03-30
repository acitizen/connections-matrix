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
      label  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      rater_pair    TEXT    NOT NULL REFERENCES pairs(id),
      rated_pair    TEXT    NOT NULL REFERENCES pairs(id),
      round         INTEGER NOT NULL CHECK(round BETWEEN 1 AND 10),
      skill_comp    INTEGER NOT NULL CHECK(skill_comp BETWEEN 1 AND 5),
      project_align INTEGER NOT NULL CHECK(project_align BETWEEN 1 AND 5),
      comm_fit      INTEGER NOT NULL CHECK(comm_fit BETWEEN 1 AND 5),
      notes         TEXT,
      timestamp     TEXT    NOT NULL,
      UNIQUE(rater_pair, rated_pair, round)
    );

    CREATE TABLE IF NOT EXISTS rankings (
      pair_id TEXT PRIMARY KEY REFERENCES pairs(id),
      rank_1  TEXT NOT NULL REFERENCES pairs(id),
      rank_2  TEXT NOT NULL REFERENCES pairs(id),
      rank_3  TEXT NOT NULL REFERENCES pairs(id)
    );
  `);
}

function seedPairs(pairs) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO pairs (id, cohort, label) VALUES (?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const p of pairs) insert.run(p.id, p.cohort, p.label || p.id);
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

function upsertRating({ raterPair, ratedPair, round, skillComp, projectAlign, commFit, notes }) {
  db.prepare(`
    INSERT INTO ratings (rater_pair, rated_pair, round, skill_comp, project_align, comm_fit, notes, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rater_pair, rated_pair, round) DO UPDATE SET
      skill_comp    = excluded.skill_comp,
      project_align = excluded.project_align,
      comm_fit      = excluded.comm_fit,
      notes         = excluded.notes,
      timestamp     = excluded.timestamp
  `).run(raterPair, ratedPair, round, skillComp, projectAlign, commFit, notes || null, new Date().toISOString());
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
  upsertRating,
  upsertRanking,
  getRatingsForPair,
  updatePairLabel,
  resetSession,
  getAllRatings,
  getAllRankings,
};
