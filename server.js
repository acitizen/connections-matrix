const express = require('express');
const path = require('path');
const fs = require('fs');

// Load .env file if present (no dependency needed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const { PAIRS, loadSession, saveSession, buildPairs } = require('./config');
const db = require('./db');

// ── Criteria config (persisted as JSON) ──────────────────────────
const CRITERIA_PATH = path.join(__dirname, 'criteria.json');
const DEFAULT_CRITERIA = [
  { name: 'Skills',        lowLabel: 'Overlapping', highLabel: 'Complementary' },
  { name: 'Interest',      lowLabel: 'Different',   highLabel: 'Similar' },
  { name: 'Communication', lowLabel: 'Warming up',  highLabel: 'Natural flow' },
];

function loadCriteria() {
  try {
    return JSON.parse(fs.readFileSync(CRITERIA_PATH, 'utf8'));
  } catch {
    return DEFAULT_CRITERIA;
  }
}

function saveCriteria(criteria) {
  fs.writeFileSync(CRITERIA_PATH, JSON.stringify(criteria, null, 2));
}

db.initSchema();
db.seedPairs(PAIRS);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${ADMIN_PASSWORD}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Helper: parse scores from a rating row ───────────────────────
function parseScores(row) {
  try { return JSON.parse(row.scores); } catch { return {}; }
}

// ── HTML routes ───────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'student.html')));
app.get('/ranking', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'ranking.html')));
app.get('/dashboard', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

// ── Public API ────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const pair = db.getPairByCode(code.toUpperCase());
  if (!pair) return res.status(404).json({ error: 'Invalid code' });

  const allPairs = db.getPairs();
  const oppositeTeams = allPairs
    .filter(p => p.cohort !== pair.cohort)
    .map(p => ({ id: p.id, label: p.label }));

  const session = loadSession();
  const myGroup = session.groups.find(g => g.key === pair.cohort);

  res.json({
    team: { id: pair.id, label: pair.label, cohort: pair.cohort, code: pair.code },
    groupName: myGroup ? myGroup.name : pair.cohort,
    oppositeTeams,
  });
});

app.get('/api/pairs', (_req, res) => {
  const pairs = db.getPairs();
  const session = loadSession();
  const groups = {};
  for (const g of session.groups) {
    groups[g.key] = {
      name: g.name,
      teams: pairs.filter(p => p.cohort === g.key).map(p => ({ id: p.id, label: p.label })),
    };
  }
  res.json({ groups });
});

app.post('/api/pair/label', (req, res) => {
  const { pairId, label } = req.body;
  if (!pairId || !label) return res.status(400).json({ error: 'Missing pairId or label' });

  const pair = db.getPairById(pairId);
  if (!pair) return res.status(400).json({ error: 'Invalid team ID' });

  const trimmed = label.trim().slice(0, 30);
  if (!trimmed) return res.status(400).json({ error: 'Label cannot be empty' });

  try {
    db.updatePairLabel(pairId, trimmed);
    res.json({ success: true, label: trimmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ratings/:pairId', (req, res) => {
  const pair = db.getPairById(req.params.pairId);
  if (!pair) return res.status(400).json({ error: 'Invalid team ID' });

  const ratings = db.getRatingsForPair(req.params.pairId);
  const byRated = {};
  for (const r of ratings) {
    byRated[r.rated_pair] = {
      scores: parseScores(r),
      notes:  r.notes || '',
    };
  }
  res.json(byRated);
});

app.get('/api/criteria', (_req, res) => {
  res.json(loadCriteria());
});

app.get('/api/session', (_req, res) => {
  res.json(loadSession());
});

app.post('/api/rating', (req, res) => {
  const { raterPair, ratedPair, scores, notes } = req.body;

  if (!raterPair || !ratedPair || !scores || typeof scores !== 'object') {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const rater = db.getPairById(raterPair);
  const rated = db.getPairById(ratedPair);

  if (!rater) return res.status(400).json({ error: 'Invalid rater team' });
  if (!rated) return res.status(400).json({ error: 'Invalid rated team' });
  if (raterPair === ratedPair) return res.status(400).json({ error: 'Cannot rate your own team' });
  if (rater.cohort === rated.cohort) return res.status(400).json({ error: 'Cannot rate a team from your own group' });

  const criteria = loadCriteria();
  const scoreValues = Object.values(scores);
  if (scoreValues.length !== criteria.length) {
    return res.status(400).json({ error: `Expected ${criteria.length} scores` });
  }
  for (const v of scoreValues) {
    if (v < 1 || v > 5) return res.status(400).json({ error: 'Scores must be between 1 and 5' });
  }

  try {
    db.upsertRating({ raterPair, ratedPair, scores, notes });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ranking', (req, res) => {
  const { pair, rank1, rank2, rank3 } = req.body;

  if (!pair || !rank1 || !rank2 || !rank3) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const pairData = db.getPairById(pair);
  if (!pairData) return res.status(400).json({ error: 'Invalid team ID' });

  const ranked = [rank1, rank2, rank3];
  if (new Set(ranked).size !== 3) {
    return res.status(400).json({ error: 'Each ranked team must be different' });
  }

  for (const r of ranked) {
    const rData = db.getPairById(r);
    if (!rData) return res.status(400).json({ error: `Unknown team: ${r}` });
    if (rData.cohort === pairData.cohort) {
      return res.status(400).json({ error: 'Can only rank teams from the other group' });
    }
  }

  try {
    db.upsertRanking({ pair, rank1, rank2, rank3 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Protected dashboard API ───────────────────────────────────────
app.get('/api/dashboard/matrix', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const ratings  = db.getAllRatings();
  const session  = loadSession();
  const criteria = loadCriteria();
  const g1Key    = session.groups[0]?.key || 'group1';
  const g2Key    = session.groups[1]?.key || 'group2';

  const group1 = pairs.filter(p => p.cohort === g1Key);
  const group2 = pairs.filter(p => p.cohort === g2Key);

  const cells = {};
  for (const g1 of group1) {
    cells[g1.id] = {};
    for (const g2t of group2) {
      const relevant = ratings.filter(r =>
        (r.rater_pair === g1.id && r.rated_pair === g2t.id) ||
        (r.rater_pair === g2t.id && r.rated_pair === g1.id)
      );
      if (relevant.length === 0) {
        cells[g1.id][g2t.id] = null;
      } else {
        const avgs = relevant.map(r => {
          const s = parseScores(r);
          const vals = Object.values(s);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        });
        const avg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        // Compute per-direction averages
        const g1Ratings = relevant.filter(r => r.rater_pair === g1.id);
        const g2Ratings = relevant.filter(r => r.rater_pair === g2t.id);
        const dirAvg = (list) => {
          if (!list.length) return null;
          const a = list.map(r => {
            const vals = Object.values(parseScores(r));
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          });
          return Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100;
        };

        cells[g1.id][g2t.id] = {
          average:  Math.round(avg * 100) / 100,
          g1Avg:    dirAvg(g1Ratings),
          g2Avg:    dirAvg(g2Ratings),
          count:    relevant.length,
          details:  relevant.map(r => ({
            rater:      r.rater_pair,
            rated:      r.rated_pair,
            raterGroup: r.rater_pair === g1.id ? g1Key : g2Key,
            scores:     parseScores(r),
            notes:      r.notes,
            timestamp:  r.timestamp,
          })),
        };
      }
    }
  }

  res.json({
    groups: session.groups,
    criteria,
    group1Teams: group1.map(p => ({ id: p.id, label: p.label })),
    group2Teams: group2.map(p => ({ id: p.id, label: p.label })),
    cells,
  });
});

app.get('/api/dashboard/rankings', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const rankings = db.getAllRankings();
  const session  = loadSession();
  const g1Key    = session.groups[0]?.key || 'group1';

  const pairMap    = Object.fromEntries(pairs.map(p => [p.id, p]));
  const g1Rnks     = rankings.filter(r => pairMap[r.pair_id]?.cohort === g1Key);
  const g2RnkMap   = Object.fromEntries(
    rankings
      .filter(r => pairMap[r.pair_id]?.cohort !== g1Key)
      .map(r => [r.pair_id, [r.rank_1, r.rank_2, r.rank_3]])
  );

  const mutual   = [];
  const oneSided = [];

  for (const g1r of g1Rnks) {
    const g1Prefs = [g1r.rank_1, g1r.rank_2, g1r.rank_3];
    for (let i = 0; i < g1Prefs.length; i++) {
      const g2Id = g1Prefs[i];
      if (!g2Id) continue;
      const g2Prefs    = g2RnkMap[g2Id] || [];
      const g2RankOfG1 = g2Prefs.indexOf(g1r.pair_id);

      if (g2RankOfG1 >= 0) {
        mutual.push({ team1: g1r.pair_id, team2: g2Id, rank1: i + 1, rank2: g2RankOfG1 + 1 });
      } else {
        oneSided.push({ team1: g1r.pair_id, team2: g2Id, rank1: i + 1, team2HasRanked: g2Prefs.length > 0 });
      }
    }
  }

  mutual.sort((a, b) => (a.rank1 + a.rank2) - (b.rank1 + b.rank2));

  res.json({ rankings, mutual, oneSided });
});

app.get('/api/dashboard/progress', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const ratings  = db.getAllRatings();
  const rankings = db.getAllRankings();
  const session  = loadSession();

  const ratingCounts = {};
  for (const p of pairs) ratingCounts[p.id] = 0;

  for (const r of ratings) {
    if (ratingCounts[r.rater_pair] !== undefined) ratingCounts[r.rater_pair]++;
  }

  res.json({
    groups: session.groups,
    pairs:  pairs.map(p => ({ id: p.id, cohort: p.cohort, label: p.label, code: p.code })),
    ratingCounts,
    rankingsSubmitted: rankings.map(r => r.pair_id),
  });
});

// ── Admin: edit team name ────────────────────────────────────────
app.post('/api/dashboard/pair/label', requireAdmin, (req, res) => {
  const { pairId, label } = req.body;
  if (!pairId || !label) return res.status(400).json({ error: 'Missing pairId or label' });

  const pair = db.getPairById(pairId);
  if (!pair) return res.status(400).json({ error: 'Invalid team ID' });

  const trimmed = label.trim().slice(0, 30);
  if (!trimmed) return res.status(400).json({ error: 'Label cannot be empty' });

  try {
    db.updatePairLabel(pairId, trimmed);
    res.json({ success: true, label: trimmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: new session ───────────────────────────────────────────
app.post('/api/dashboard/new-session', requireAdmin, (req, res) => {
  const { groups } = req.body;

  if (!Array.isArray(groups) || groups.length !== 2) {
    return res.status(400).json({ error: 'Must provide exactly 2 groups' });
  }

  const cleanedGroups = groups.map((g, i) => ({
    key:   `group${i + 1}`,
    name:  String(g.name || '').trim().slice(0, 30) || `Group ${String.fromCharCode(65 + i)}`,
    count: Math.max(1, Math.min(30, parseInt(g.count, 10) || 10)),
  }));

  try {
    db.resetSession();
    saveSession({ groups: cleanedGroups });

    const newPairs = buildPairs(cleanedGroups);
    db.seedPairs(newPairs);

    res.json({ success: true, groups: cleanedGroups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: save criteria ─────────────────────────────────────────
app.post('/api/dashboard/criteria', requireAdmin, (req, res) => {
  const { criteria } = req.body;
  if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 8) {
    return res.status(400).json({ error: 'Criteria must be 2–8 axes' });
  }

  const cleaned = criteria.map(c => ({
    name:      String(c.name || '').trim().slice(0, 30) || 'Untitled',
    lowLabel:  String(c.lowLabel || '').trim().slice(0, 30) || 'Low',
    highLabel: String(c.highLabel || '').trim().slice(0, 30) || 'High',
  }));

  try {
    saveCriteria(cleaned);
    res.json({ success: true, criteria: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CSV exports ───────────────────────────────────────────────────
app.get('/api/export/matrix.csv', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const ratings  = db.getAllRatings();
  const session  = loadSession();
  const g1Key    = session.groups[0]?.key || 'group1';
  const g2Key    = session.groups[1]?.key || 'group2';
  const g1Name   = session.groups[0]?.name || 'Group 1';
  const g2Name   = session.groups[1]?.name || 'Group 2';
  const group1   = pairs.filter(p => p.cohort === g1Key);
  const group2   = pairs.filter(p => p.cohort === g2Key);

  // Header: each group2 team gets 3 columns
  const header = [''];
  for (const p of group2) {
    const label = p.label || p.id;
    header.push(`${label} (Combined)`, `${label} (${g1Name} gave)`, `${label} (${g2Name} gave)`);
  }
  const rows = [header];

  const avgOf = (list) => {
    if (!list.length) return null;
    const avgs = list.map(r => {
      const vals = Object.values(parseScores(r));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    return Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 100) / 100;
  };

  for (const g1 of group1) {
    const row = [g1.label || g1.id];
    for (const g2t of group2) {
      const all  = ratings.filter(r =>
        (r.rater_pair === g1.id && r.rated_pair === g2t.id) ||
        (r.rater_pair === g2t.id && r.rated_pair === g1.id)
      );
      const g1Gave = all.filter(r => r.rater_pair === g1.id);
      const g2Gave = all.filter(r => r.rater_pair === g2t.id);

      const combined = avgOf(all);
      const g1Avg    = avgOf(g1Gave);
      const g2Avg    = avgOf(g2Gave);

      row.push(
        combined != null ? combined.toFixed(2) : '',
        g1Avg != null ? g1Avg.toFixed(2) : '',
        g2Avg != null ? g2Avg.toFixed(2) : '',
      );
    }
    rows.push(row);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="compatibility-matrix.csv"');
  res.send(rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
});

app.get('/api/export/ratings.csv', requireAdmin, (_req, res) => {
  const ratings  = db.getAllRatings();
  const criteria = loadCriteria();
  const header   = ['id', 'rater_pair', 'rated_pair', ...criteria.map(c => c.name), 'notes', 'timestamp'];
  const rows     = [header, ...ratings.map(r => {
    const s = parseScores(r);
    return [
      r.id, r.rater_pair, r.rated_pair,
      ...criteria.map((_, i) => s[`axis${i}`] || ''),
      `"${(r.notes || '').replace(/"/g, '""')}"`,
      r.timestamp,
    ];
  })];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ratings.csv"');
  res.send(rows.map(r => r.join(',')).join('\n'));
});

app.get('/api/export/rankings.csv', requireAdmin, (_req, res) => {
  const rankings = db.getAllRankings();
  const header   = ['pair_id', 'rank_1', 'rank_2', 'rank_3'];
  const rows     = [header, ...rankings.map(r => [r.pair_id, r.rank_1, r.rank_2, r.rank_3])];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="rankings.csv"');
  res.send(rows.map(r => r.join(',')).join('\n'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nConnections Matrix running at http://localhost:${PORT}`);
  console.log(`  Student form:  http://localhost:${PORT}/`);
  console.log(`  Final ranking: http://localhost:${PORT}/ranking`);
  console.log(`  Dashboard:     http://localhost:${PORT}/dashboard\n`);
});
