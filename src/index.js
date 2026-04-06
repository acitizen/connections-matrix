// ── Creating Connections — Cloudflare Worker ──────────────────────────
// Hono router + D1 database + JWT auth
// Replaces Express server.js — same API shape, just async

import { Hono } from 'hono';
import {
  createToken, verifyToken, setSessionCookie, clearSessionCookie,
  getTokenFromCookies, hashPassword, verifyPassword,
} from './auth.js';
import * as DB from './db.js';

const app = new Hono();

// ── Default criteria ──────────────────────────────────────────────────
const DEFAULT_CRITERIA = [
  { name: 'Skills',        lowLabel: 'Overlapping', highLabel: 'Complementary' },
  { name: 'Interest',      lowLabel: 'Different',   highLabel: 'Similar' },
  { name: 'Communication', lowLabel: 'Warming up',  highLabel: 'Natural flow' },
];

// ── Helpers ───────────────────────────────────────────────────────────
function parseScores(row) {
  try { return JSON.parse(row.scores); } catch { return {}; }
}
function avgOfRatings(list) {
  const avgs = list.map(r => {
    const vals = Object.values(parseScores(r));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  });
  return avgs.reduce((a, b) => a + b, 0) / avgs.length;
}
function buildPairs(groups) {
  const pairs = [];
  for (const g of groups) {
    for (let i = 1; i <= g.count; i++) {
      const id = `${g.key}-${String(i).padStart(2, '0')}`;
      pairs.push({ id, cohort: g.key, label: id });
    }
  }
  return pairs;
}

// ── Middleware: auth check ─────────────────────────────────────────────
async function getUser(c) {
  const token = getTokenFromCookies(c.req.header('Cookie'));
  if (!token) return null;
  const secret = c.env.SESSION_SECRET || 'dev-secret-change-me';
  const payload = await verifyToken(token, secret);
  if (!payload?.userId) return null;
  return DB.getUserById(c.env.DB, payload.userId);
}

async function requireAuth(c, next) {
  const user = await getUser(c);
  if (!user) {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not authenticated' }, 401);
    return c.redirect('/login.html');
  }
  c.set('user', user);
  return next();
}

async function requireAdmin(c, next) {
  if (c.get('user')?.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  return next();
}

async function requireSessionAccess(c, next) {
  const id = parseInt(c.req.param('sessionId'), 10);
  const appSession = await DB.getSessionById(c.env.DB, id);
  if (!appSession) return c.json({ error: 'Session not found' }, 404);
  const user = c.get('user');
  if (user.role !== 'admin' && appSession.created_by !== user.id) {
    return c.json({ error: 'Access denied' }, 403);
  }
  c.set('appSession', appSession);
  return next();
}

// ── Seed admin on first request (only runs once) ─────────────────────
let adminSeeded = false;
app.use('/api/*', async (c, next) => {
  if (!adminSeeded) {
    const db = c.env.DB;
    const count = await db.prepare('SELECT COUNT(*) as n FROM users').first();
    if (count.n === 0) {
      const adminPw = c.env.ADMIN_PASSWORD || 'admin';
      const hash = await hashPassword(adminPw);
      await DB.ensureAdmin(db, hash);
    }
    adminSeeded = true;
  }
  return next();
});

// ══════════════════════════════════════════════════════════════════════
// AUTH API
// ══════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  const user = await DB.getUserByUsername(c.env.DB, username.trim());
  if (!user) return c.json({ error: 'Invalid credentials' }, 401);
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return c.json({ error: 'Invalid credentials' }, 401);
  const secret = c.env.SESSION_SECRET || 'dev-secret-change-me';
  const token = await createToken({ userId: user.id }, secret);
  c.header('Set-Cookie', setSessionCookie(user.id, token));
  return c.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

app.post('/api/auth/register', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  if (username.trim().length < 3) return c.json({ error: 'Username must be at least 3 characters' }, 400);
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);
  if (await DB.getUserByUsername(c.env.DB, username.trim())) return c.json({ error: 'Username already taken' }, 409);
  const user = await DB.createUser(c.env.DB, {
    username: username.trim(),
    passwordHash: await hashPassword(password),
    role: 'facilitator',
  });
  const secret = c.env.SESSION_SECRET || 'dev-secret-change-me';
  const token = await createToken({ userId: user.id }, secret);
  c.header('Set-Cookie', setSessionCookie(user.id, token));
  return c.json({
    success: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

app.post('/api/auth/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (c) => {
  const u = c.get('user');
  return c.json({ id: u.id, username: u.username, role: u.role });
});

app.post('/api/auth/change-password', requireAuth, async (c) => {
  const { currentPassword, newPassword } = await c.req.json();
  if (!currentPassword || !newPassword) return c.json({ error: 'Both passwords required' }, 400);
  if (newPassword.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);
  const user = c.get('user');
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) return c.json({ error: 'Current password incorrect' }, 401);
  await DB.updateUserPassword(c.env.DB, user.id, await hashPassword(newPassword));
  return c.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════
// USER MANAGEMENT (admin only)
// ══════════════════════════════════════════════════════════════════════

app.get('/api/users', requireAuth, requireAdmin, async (c) => {
  return c.json(await DB.getAllUsers(c.env.DB));
});

app.post('/api/users', requireAuth, requireAdmin, async (c) => {
  const { username, password, role } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);
  if (!['admin', 'facilitator'].includes(role)) return c.json({ error: 'Role must be admin or facilitator' }, 400);
  if (await DB.getUserByUsername(c.env.DB, username.trim())) return c.json({ error: 'Username already taken' }, 409);
  const user = await DB.createUser(c.env.DB, {
    username: username.trim(),
    passwordHash: await hashPassword(password),
    role: role || 'facilitator',
  });
  return c.json(user);
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (id === c.get('user').id) return c.json({ error: 'Cannot delete your own account' }, 400);
  if (!await DB.getUserById(c.env.DB, id)) return c.json({ error: 'User not found' }, 404);
  await DB.deleteUser(c.env.DB, id);
  return c.json({ success: true });
});

app.patch('/api/users/:id/password', requireAuth, requireAdmin, async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { password } = await c.req.json();
  if (!password || password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400);
  if (!await DB.getUserById(c.env.DB, id)) return c.json({ error: 'User not found' }, 404);
  await DB.updateUserPassword(c.env.DB, id, await hashPassword(password));
  return c.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════

app.get('/api/sessions', requireAuth, async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const sessions = user.role === 'admin'
    ? await DB.getAllSessions(db)
    : await DB.getSessionsByUser(db, user.id);
  const result = await Promise.all(sessions.map(async s => ({
    ...s, stats: await DB.getRatingStats(db, s.id),
  })));
  return c.json(result);
});

app.post('/api/sessions', requireAuth, async (c) => {
  const db = c.env.DB;
  const { name, groups, criteria } = await c.req.json();
  if (!name?.trim()) return c.json({ error: 'Session name required' }, 400);
  if (!Array.isArray(groups) || groups.length !== 2) return c.json({ error: 'Must provide exactly 2 groups' }, 400);

  const cleanedGroups = groups.map((g, i) => ({
    key:   `group${i + 1}`,
    name:  String(g.name || '').trim().slice(0, 30) || `Group ${String.fromCharCode(65 + i)}`,
    count: Math.max(1, Math.min(30, parseInt(g.count, 10) || 10)),
  }));
  const cleanedCriteria = Array.isArray(criteria) ? criteria.map(c => ({
    name:      String(c.name || '').trim().slice(0, 30) || 'Untitled',
    lowLabel:  String(c.lowLabel || '').trim().slice(0, 30) || 'Low',
    highLabel: String(c.highLabel || '').trim().slice(0, 30) || 'High',
  })) : DEFAULT_CRITERIA;

  try {
    const appSession = await DB.createSession(db, {
      name: name.trim(),
      createdBy: c.get('user').id,
      config: { groups: cleanedGroups, criteria: cleanedCriteria },
    });
    await DB.seedPairs(db, buildPairs(cleanedGroups), appSession.id);
    return c.json({ ...appSession, stats: await DB.getRatingStats(db, appSession.id) });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

app.patch('/api/sessions/:sessionId/status', requireAuth, requireSessionAccess, async (c) => {
  const { status } = await c.req.json();
  if (!['active', 'archived'].includes(status)) return c.json({ error: 'Status must be active or archived' }, 400);
  await DB.updateSessionStatus(c.env.DB, c.get('appSession').id, status);
  return c.json({ success: true, status });
});

app.patch('/api/sessions/:sessionId/name', requireAuth, requireSessionAccess, async (c) => {
  const { name } = await c.req.json();
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400);
  await DB.updateSessionName(c.env.DB, c.get('appSession').id, name.trim());
  return c.json({ success: true });
});

app.delete('/api/sessions/:sessionId', requireAuth, requireSessionAccess, async (c) => {
  await DB.deleteSession(c.env.DB, c.get('appSession').id);
  return c.json({ success: true });
});

app.post('/api/sessions/:sessionId/duplicate', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const src = c.get('appSession');
  const body = await c.req.json();
  const name = body.name?.trim() || `${src.name} (copy)`;
  try {
    const newSession = await DB.createSession(db, { name, createdBy: c.get('user').id, config: { ...src.config } });
    await DB.seedPairs(db, buildPairs(src.config.groups || []), newSession.id);
    return c.json({ ...newSession, stats: await DB.getRatingStats(db, newSession.id) });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
// SESSION DETAIL API
// ══════════════════════════════════════════════════════════════════════

app.get('/api/sessions/:sessionId/matrix', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const appSession = c.get('appSession');
  const [pairs, ratings] = await Promise.all([
    DB.getPairs(db, appSession.id),
    DB.getAllRatings(db, appSession.id),
  ]);
  const config   = appSession.config;
  const criteria = config.criteria || DEFAULT_CRITERIA;
  const groups   = config.groups || [];
  const g1Key    = groups[0]?.key || 'group1';
  const group1   = pairs.filter(p => p.cohort === g1Key);
  const group2   = pairs.filter(p => p.cohort !== g1Key);

  const cells = {};
  for (const g1 of group1) {
    cells[g1.id] = {};
    for (const g2t of group2) {
      const relevant = ratings.filter(r =>
        (r.rater_pair === g1.id && r.rated_pair === g2t.id) ||
        (r.rater_pair === g2t.id && r.rated_pair === g1.id)
      );
      if (!relevant.length) { cells[g1.id][g2t.id] = null; continue; }
      const dirAvg = list => list.length ? Math.round(avgOfRatings(list) * 100) / 100 : null;
      cells[g1.id][g2t.id] = {
        average: Math.round(avgOfRatings(relevant) * 100) / 100,
        g1Avg:   dirAvg(relevant.filter(r => r.rater_pair === g1.id)),
        g2Avg:   dirAvg(relevant.filter(r => r.rater_pair === g2t.id)),
        count:   relevant.length,
        details: relevant.map(r => ({
          rater:      r.rater_pair,
          rated:      r.rated_pair,
          raterGroup: r.rater_pair === g1.id ? g1Key : groups[1]?.key || 'group2',
          scores:     parseScores(r),
          notes:      r.notes,
          timestamp:  r.timestamp,
        })),
      };
    }
  }

  return c.json({
    session: { id: appSession.id, code: appSession.code, name: appSession.name, status: appSession.status },
    groups, criteria,
    group1Teams: group1.map(p => ({ id: p.id, label: p.label })),
    group2Teams: group2.map(p => ({ id: p.id, label: p.label })),
    cells,
  });
});

app.get('/api/sessions/:sessionId/progress', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const appSession = c.get('appSession');
  const [pairs, ratings] = await Promise.all([
    DB.getPairs(db, appSession.id),
    DB.getAllRatings(db, appSession.id),
  ]);
  const ratingCounts = Object.fromEntries(pairs.map(p => [p.id, 0]));
  for (const r of ratings) {
    if (ratingCounts[r.rater_pair] !== undefined) ratingCounts[r.rater_pair]++;
  }
  return c.json({
    session: { id: appSession.id, name: appSession.name, code: appSession.code, status: appSession.status },
    groups:  appSession.config.groups || [],
    pairs:   pairs.map(p => ({ id: p.id, cohort: p.cohort, label: p.label, code: p.code })),
    ratingCounts,
  });
});

app.get('/api/sessions/:sessionId/pairs', requireAuth, requireSessionAccess, async (c) => {
  const pairs = await DB.getPairs(c.env.DB, c.get('appSession').id);
  const groups = {};
  for (const g of (c.get('appSession').config.groups || [])) {
    groups[g.key] = {
      name: g.name,
      teams: pairs.filter(p => p.cohort === g.key).map(p => ({ id: p.id, label: p.label, code: p.code })),
    };
  }
  return c.json({ groups });
});

app.post('/api/sessions/:sessionId/pairs/:pairId/label', requireAuth, requireSessionAccess, async (c) => {
  const { label } = await c.req.json();
  const pair = await DB.getPairById(c.env.DB, c.req.param('pairId'));
  if (!pair || pair.session_id !== c.get('appSession').id) return c.json({ error: 'Team not found' }, 404);
  const trimmed = label?.trim().slice(0, 30);
  if (!trimmed) return c.json({ error: 'Label cannot be empty' }, 400);
  await DB.updatePairLabel(c.env.DB, c.req.param('pairId'), trimmed);
  return c.json({ success: true, label: trimmed });
});

app.post('/api/sessions/:sessionId/pairs/bulk-labels', requireAuth, requireSessionAccess, async (c) => {
  const { labels } = await c.req.json();
  if (!Array.isArray(labels)) return c.json({ error: 'labels must be an array' }, 400);
  for (const { pairId, label } of labels) {
    const pair = await DB.getPairById(c.env.DB, pairId);
    if (!pair || pair.session_id !== c.get('appSession').id) continue;
    const trimmed = String(label || '').trim().slice(0, 30);
    if (trimmed) await DB.updatePairLabel(c.env.DB, pairId, trimmed);
  }
  return c.json({ success: true });
});

app.get('/api/sessions/:sessionId/criteria', requireAuth, requireSessionAccess, (c) => {
  return c.json(c.get('appSession').config.criteria || DEFAULT_CRITERIA);
});

app.post('/api/sessions/:sessionId/criteria', requireAuth, requireSessionAccess, async (c) => {
  const { criteria } = await c.req.json();
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 8) {
    return c.json({ error: 'Criteria must be 2–8 axes' }, 400);
  }
  const cleaned = criteria.map(cr => ({
    name:      String(cr.name || '').trim().slice(0, 30) || 'Untitled',
    lowLabel:  String(cr.lowLabel || '').trim().slice(0, 30) || 'Low',
    highLabel: String(cr.highLabel || '').trim().slice(0, 30) || 'High',
  }));
  const appSession = c.get('appSession');
  await DB.updateSessionConfig(c.env.DB, appSession.id, { ...appSession.config, criteria: cleaned });
  return c.json({ success: true, criteria: cleaned });
});

app.post('/api/sessions/:sessionId/groups', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const { groups } = await c.req.json();
  if (!Array.isArray(groups) || groups.length !== 2) return c.json({ error: 'Must provide exactly 2 groups' }, 400);

  const appSession = c.get('appSession');
  const currentGroups = appSession.config.groups || [];
  const currentPairs = await DB.getPairs(db, appSession.id);

  const updatedGroups = groups.map((g, i) => ({
    key:   currentGroups[i]?.key || `group${i + 1}`,
    name:  String(g.name || '').trim().slice(0, 30) || `Group ${String.fromCharCode(65 + i)}`,
    count: Math.max(1, Math.min(30, parseInt(g.count, 10) || 10)),
  }));

  for (const g of updatedGroups) {
    const existing = currentPairs.filter(p => p.cohort === g.key);
    const currentCount = existing.length;

    if (g.count > currentCount) {
      const newPairs = [];
      for (let i = currentCount + 1; i <= g.count; i++) {
        const id = `${g.key}-${String(i).padStart(2, '0')}`;
        newPairs.push({ id, cohort: g.key, label: id });
      }
      await DB.seedPairs(db, newPairs, appSession.id);
    } else if (g.count < currentCount) {
      const toRemove = existing.slice(g.count);
      const allRatings = await DB.getAllRatings(db, appSession.id);
      const ratedIds = new Set(allRatings.flatMap(r => [r.rater_pair, r.rated_pair]));
      const safeToRemove = toRemove.filter(p => !ratedIds.has(p.id));
      for (const p of safeToRemove) await DB.deletePair(db, p.id);
      g.count = currentCount - safeToRemove.length;
    }
  }

  await DB.updateSessionConfig(db, appSession.id, { ...appSession.config, groups: updatedGroups });
  return c.json({ success: true, groups: updatedGroups });
});

// ══════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════

app.get('/api/sessions/:sessionId/export/matrix.csv', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const appSession = c.get('appSession');
  const [pairs, ratings] = await Promise.all([
    DB.getPairs(db, appSession.id),
    DB.getAllRatings(db, appSession.id),
  ]);
  const groups = appSession.config.groups || [];
  const g1Key  = groups[0]?.key || 'group1';
  const g1Name = groups[0]?.name || 'Group 1';
  const g2Name = groups[1]?.name || 'Group 2';
  const group1 = pairs.filter(p => p.cohort === g1Key);
  const group2 = pairs.filter(p => p.cohort !== g1Key);

  const header = [''];
  for (const p of group2) header.push(`${p.label} (Combined)`, `${p.label} (${g1Name} gave)`, `${p.label} (${g2Name} gave)`);
  const rows = [header];
  for (const g1 of group1) {
    const row = [g1.label];
    for (const g2t of group2) {
      const all    = ratings.filter(r => (r.rater_pair === g1.id && r.rated_pair === g2t.id) || (r.rater_pair === g2t.id && r.rated_pair === g1.id));
      const g1Gave = all.filter(r => r.rater_pair === g1.id);
      const g2Gave = all.filter(r => r.rater_pair === g2t.id);
      const fmt    = list => list.length ? avgOfRatings(list).toFixed(2) : '';
      row.push(fmt(all), fmt(g1Gave), fmt(g2Gave));
    }
    rows.push(row);
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="matrix-${appSession.code}.csv"`,
    },
  });
});

app.get('/api/sessions/:sessionId/export/ratings.csv', requireAuth, requireSessionAccess, async (c) => {
  const db = c.env.DB;
  const appSession = c.get('appSession');
  const ratings  = await DB.getAllRatings(db, appSession.id);
  const criteria = appSession.config.criteria || DEFAULT_CRITERIA;
  const header   = ['id', 'rater_pair', 'rated_pair', ...criteria.map(cr => cr.name), 'notes', 'timestamp'];
  const rows     = [header, ...ratings.map(r => {
    const s = parseScores(r);
    return [r.id, r.rater_pair, r.rated_pair, ...criteria.map((_, i) => s[`axis${i}`] || ''),
      `"${(r.notes || '').replace(/"/g, '""')}"`, r.timestamp];
  })];
  const csv = rows.map(r => r.join(',')).join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="ratings-${appSession.code}.csv"`,
    },
  });
});

// ══════════════════════════════════════════════════════════════════════
// PUBLIC API (student-facing — no auth required)
// ══════════════════════════════════════════════════════════════════════

app.post('/api/auth', async (c) => {
  const db = c.env.DB;
  const { code } = await c.req.json();
  if (!code) return c.json({ error: 'Team code required' }, 400);

  const pair = await DB.getPairByCode(db, code.toUpperCase());
  if (!pair) return c.json({ error: 'Invalid team code' }, 404);

  const appSession = await DB.getSessionById(db, pair.session_id);
  if (!appSession) return c.json({ error: 'Session not found' }, 404);
  if (appSession.status === 'archived') return c.json({ error: 'This session has ended' }, 403);

  const allPairs = await DB.getPairs(db, appSession.id);
  const groups   = appSession.config.groups || [];
  const myGroup  = groups.find(g => g.key === pair.cohort);
  const oppositeTeams = allPairs
    .filter(p => p.cohort !== pair.cohort)
    .map(p => ({ id: p.id, label: p.label }));

  return c.json({
    team:        { id: pair.id, label: pair.label, cohort: pair.cohort, code: pair.code },
    groupName:   myGroup ? myGroup.name : pair.cohort,
    sessionId:   appSession.id,
    sessionName: appSession.name,
    oppositeTeams,
  });
});

app.get('/api/criteria', async (c) => {
  const db = c.env.DB;
  const pairId = c.req.query('pair');
  if (pairId) {
    const pair = await DB.getPairById(db, pairId);
    if (pair) {
      const appSession = await DB.getSessionById(db, pair.session_id);
      if (appSession) return c.json(appSession.config.criteria || DEFAULT_CRITERIA);
    }
  }
  const code = (c.req.query('session') || '').toUpperCase();
  if (code) {
    const appSession = await DB.getSessionByCode(db, code);
    if (appSession) return c.json(appSession.config.criteria || DEFAULT_CRITERIA);
  }
  return c.json(DEFAULT_CRITERIA);
});

app.post('/api/pair/label', async (c) => {
  const db = c.env.DB;
  const { pairId, label } = await c.req.json();
  if (!pairId || !label) return c.json({ error: 'Missing pairId or label' }, 400);
  const pair = await DB.getPairById(db, pairId);
  if (!pair) return c.json({ error: 'Invalid team ID' }, 400);
  const trimmed = label.trim().slice(0, 30);
  if (!trimmed) return c.json({ error: 'Label cannot be empty' }, 400);
  await DB.updatePairLabel(db, pairId, trimmed);
  return c.json({ success: true, label: trimmed });
});

app.get('/api/ratings/:pairId', async (c) => {
  const db = c.env.DB;
  const pairId = c.req.param('pairId');
  const pair = await DB.getPairById(db, pairId);
  if (!pair) return c.json({ error: 'Invalid team ID' }, 400);
  const ratings = await DB.getRatingsForPair(db, pairId);
  const byRated = {};
  for (const r of ratings) byRated[r.rated_pair] = { scores: parseScores(r), notes: r.notes || '' };
  return c.json(byRated);
});

app.post('/api/rating', async (c) => {
  const db = c.env.DB;
  const { raterPair, ratedPair, scores, notes } = await c.req.json();
  if (!raterPair || !ratedPair || !scores || typeof scores !== 'object') {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  const [rater, rated] = await Promise.all([
    DB.getPairById(db, raterPair),
    DB.getPairById(db, ratedPair),
  ]);
  if (!rater) return c.json({ error: 'Invalid rater team' }, 400);
  if (!rated) return c.json({ error: 'Invalid rated team' }, 400);
  if (raterPair === ratedPair) return c.json({ error: 'Cannot rate your own team' }, 400);
  if (rater.cohort === rated.cohort) return c.json({ error: 'Cannot rate a team from your own group' }, 400);
  if (rater.session_id !== rated.session_id) return c.json({ error: 'Teams are in different sessions' }, 400);

  const appSession = await DB.getSessionById(db, rater.session_id);
  if (appSession?.status === 'archived') return c.json({ error: 'This session has ended' }, 403);

  const criteria = appSession?.config?.criteria || DEFAULT_CRITERIA;
  const scoreValues = Object.values(scores);
  if (scoreValues.length !== criteria.length) return c.json({ error: `Expected ${criteria.length} scores` }, 400);
  for (const v of scoreValues) {
    if (v < 1 || v > 5) return c.json({ error: 'Scores must be between 1 and 5' }, 400);
  }

  try {
    await DB.upsertRating(db, { raterPair, ratedPair, scores, notes, sessionId: rater.session_id });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// ══════════════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════════════

export default app;
