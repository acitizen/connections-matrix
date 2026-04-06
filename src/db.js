// ── D1 async database layer ───────────────────────────────────────────
// Every function receives `db` (the D1 binding) as first arg.
// D1 uses the same SQLite syntax — just async.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len) {
  let code = '';
  for (let i = 0; i < len; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// ── Seed default admin if needed ──────────────────────────────────────
export async function ensureAdmin(db, passwordHash) {
  const row = await db.prepare('SELECT COUNT(*) as n FROM users').first();
  if (row.n > 0) return;
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind('admin', passwordHash, 'Admin', 'admin', now).run();
}

// ── Users ─────────────────────────────────────────────────────────────
export async function createUser(db, { username, passwordHash, displayName, role }) {
  const now = new Date().toISOString();
  const result = await db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(username, passwordHash, displayName || null, role || 'facilitator', now).run();
  return getUserById(db, result.meta.last_row_id);
}

export async function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
}

export async function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function getAllUsers(db) {
  const { results } = await db.prepare(
    'SELECT id, username, display_name, role, created_at FROM users ORDER BY id'
  ).all();
  return results;
}

export async function updateUserPassword(db, id, passwordHash) {
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, id).run();
}

export async function deleteUser(db, id) {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}

// ── Code generators ───────────────────────────────────────────────────
async function generateSessionCode(db) {
  let code;
  do {
    code = randomCode(6);
  } while (await db.prepare('SELECT 1 FROM app_sessions WHERE code = ?').bind(code).first());
  return code;
}

async function generateTeamCode(db, usedCodes) {
  let code;
  do {
    code = randomCode(4);
  } while (usedCodes.has(code));
  return code;
}

// ── App Sessions ──────────────────────────────────────────────────────
export async function createSession(db, { name, createdBy, config }) {
  const now = new Date().toISOString();
  const code = await generateSessionCode(db);
  const result = await db.prepare(`
    INSERT INTO app_sessions (code, name, created_by, status, config, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).bind(code, name, createdBy, JSON.stringify(config || {}), now, now).run();
  return getSessionById(db, result.meta.last_row_id);
}

export async function getSessionById(db, id) {
  const row = await db.prepare('SELECT * FROM app_sessions WHERE id = ?').bind(id).first();
  if (row) row.config = parseJson(row.config);
  return row;
}

export async function getSessionByCode(db, code) {
  const row = await db.prepare('SELECT * FROM app_sessions WHERE code = ?').bind(code.toUpperCase()).first();
  if (row) row.config = parseJson(row.config);
  return row;
}

export async function getSessionsByUser(db, userId) {
  const { results } = await db.prepare(`
    SELECT s.*, u.username as creator_username, u.display_name as creator_display_name
    FROM app_sessions s LEFT JOIN users u ON s.created_by = u.id
    WHERE s.created_by = ? ORDER BY s.created_at DESC
  `).bind(userId).all();
  return results.map(parseSessionRow);
}

export async function getAllSessions(db) {
  const { results } = await db.prepare(`
    SELECT s.*, u.username as creator_username, u.display_name as creator_display_name
    FROM app_sessions s LEFT JOIN users u ON s.created_by = u.id
    ORDER BY s.created_at DESC
  `).all();
  return results.map(parseSessionRow);
}

export async function updateSessionStatus(db, id, status) {
  await db.prepare('UPDATE app_sessions SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, new Date().toISOString(), id).run();
}

export async function updateSessionConfig(db, id, config) {
  await db.prepare('UPDATE app_sessions SET config = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(config), new Date().toISOString(), id).run();
}

export async function updateSessionName(db, id, name) {
  await db.prepare('UPDATE app_sessions SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, new Date().toISOString(), id).run();
}

export async function deleteSession(db, id) {
  await db.prepare('DELETE FROM app_sessions WHERE id = ?').bind(id).run();
}

export async function getRatingStats(db, sessionId) {
  const [pairs, ratings] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM pairs WHERE session_id = ?').bind(sessionId).first(),
    db.prepare('SELECT COUNT(*) as n FROM ratings WHERE session_id = ?').bind(sessionId).first(),
  ]);
  return { totalPairs: pairs.n, ratingsSubmitted: ratings.n };
}

// ── Pairs ─────────────────────────────────────────────────────────────
export async function seedPairs(db, pairs, sessionId) {
  const { results: existing } = await db.prepare('SELECT code FROM pairs WHERE code IS NOT NULL').all();
  const usedCodes = new Set(existing.map(r => r.code));

  const stmts = [];
  for (const p of pairs) {
    let code = p.code;
    if (!code) {
      code = await generateTeamCode(db, usedCodes);
      usedCodes.add(code);
    }
    const uniqueId = `s${sessionId}-${p.id}`;
    stmts.push(
      db.prepare('INSERT OR IGNORE INTO pairs (id, cohort, label, code, session_id) VALUES (?, ?, ?, ?, ?)')
        .bind(uniqueId, p.cohort, p.label || p.id, code, sessionId)
    );
  }
  if (stmts.length) await db.batch(stmts);
}

export async function getPairs(db, sessionId) {
  const { results } = await db.prepare('SELECT * FROM pairs WHERE session_id = ? ORDER BY id').bind(sessionId).all();
  return results;
}

export async function getPairById(db, id) {
  return db.prepare('SELECT * FROM pairs WHERE id = ?').bind(id).first();
}

export async function getPairByCode(db, code) {
  return db.prepare('SELECT * FROM pairs WHERE code = ?').bind(code.toUpperCase()).first();
}

export async function updatePairLabel(db, id, label) {
  await db.prepare('UPDATE pairs SET label = ? WHERE id = ?').bind(label, id).run();
}

export async function deletePair(db, id) {
  await db.batch([
    db.prepare('DELETE FROM ratings WHERE rater_pair = ? OR rated_pair = ?').bind(id, id),
    db.prepare('DELETE FROM pairs WHERE id = ?').bind(id),
  ]);
}

// ── Ratings ───────────────────────────────────────────────────────────
export async function upsertRating(db, { raterPair, ratedPair, scores, notes, sessionId }) {
  const scoresJson = typeof scores === 'string' ? scores : JSON.stringify(scores);
  await db.prepare(`
    INSERT INTO ratings (rater_pair, rated_pair, scores, notes, timestamp, session_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(rater_pair, rated_pair) DO UPDATE SET
      scores = excluded.scores, notes = excluded.notes,
      timestamp = excluded.timestamp, session_id = excluded.session_id
  `).bind(raterPair, ratedPair, scoresJson, notes || null, new Date().toISOString(), sessionId).run();
}

export async function getRatingsForPair(db, raterPair) {
  const { results } = await db.prepare('SELECT * FROM ratings WHERE rater_pair = ? ORDER BY rated_pair').bind(raterPair).all();
  return results;
}

export async function getAllRatings(db, sessionId) {
  const { results } = await db.prepare('SELECT * FROM ratings WHERE session_id = ? ORDER BY timestamp').bind(sessionId).all();
  return results;
}

// ── Utils ─────────────────────────────────────────────────────────────
function parseJson(s) {
  try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); }
  catch { return {}; }
}

function parseSessionRow(row) {
  if (row) row.config = parseJson(row.config);
  return row;
}
