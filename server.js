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
const { PAIRS } = require('./config');
const db = require('./db');

// ── Criteria config (persisted as JSON) ──────────────────────────
const CRITERIA_PATH = path.join(__dirname, 'criteria.json');
const DEFAULT_CRITERIA = [
  { key: 'skillComp',    name: 'Skills',        lowLabel: 'Overlapping', highLabel: 'Complementary' },
  { key: 'projectAlign', name: 'Interest',      lowLabel: 'Different',   highLabel: 'Similar' },
  { key: 'commFit',      name: 'Communication', lowLabel: 'Warming up',  highLabel: 'Natural flow' },
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

// ── HTML routes ───────────────────────────────────────────────────
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'student.html')));
app.get('/ranking', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'ranking.html')));
app.get('/dashboard', (_req, res) =>
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

// ── Public API ────────────────────────────────────────────────────
app.get('/api/pairs', (_req, res) => {
  const pairs = db.getPairs();
  res.json({
    sem3:  pairs.filter(p => p.cohort === 'sem3') .map(p => ({ id: p.id, label: p.label })),
    sem12: pairs.filter(p => p.cohort === 'sem12').map(p => ({ id: p.id, label: p.label })),
  });
});

app.post('/api/pair/label', (req, res) => {
  const { pairId, label } = req.body;
  if (!pairId || !label) return res.status(400).json({ error: 'Missing pairId or label' });

  const pair = db.getPairById(pairId);
  if (!pair) return res.status(400).json({ error: 'Invalid pair ID' });

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
  if (!pair) return res.status(400).json({ error: 'Invalid pair ID' });

  const ratings = db.getRatingsForPair(req.params.pairId);
  const byRated = {};
  for (const r of ratings) {
    byRated[r.rated_pair] = {
      skillComp:    r.skill_comp,
      projectAlign: r.project_align,
      commFit:      r.comm_fit,
      notes:        r.notes || '',
    };
  }
  res.json(byRated);
});

app.get('/api/criteria', (_req, res) => {
  res.json(loadCriteria());
});

app.post('/api/rating', (req, res) => {
  const { raterPair, ratedPair, skillComp, projectAlign, commFit, notes } = req.body;
  const round = req.body.round || 1; // auto-assign if not provided

  if (!raterPair || !ratedPair || !skillComp || !projectAlign || !commFit) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const rater = db.getPairById(raterPair);
  const rated = db.getPairById(ratedPair);

  if (!rater) return res.status(400).json({ error: 'Invalid rater pair' });
  if (!rated) return res.status(400).json({ error: 'Invalid rated pair' });
  if (raterPair === ratedPair) return res.status(400).json({ error: 'Cannot rate your own pair' });
  if (rater.cohort === rated.cohort) return res.status(400).json({ error: 'Cannot rate a pair from your own cohort' });
  if (round < 1 || round > 10) return res.status(400).json({ error: 'Round must be 1\u201310' });

  for (const score of [skillComp, projectAlign, commFit]) {
    if (score < 1 || score > 5) return res.status(400).json({ error: 'Scores must be between 1 and 5' });
  }

  try {
    db.upsertRating({ raterPair, ratedPair, round, skillComp, projectAlign, commFit, notes });
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
  if (!pairData) return res.status(400).json({ error: 'Invalid pair ID' });

  const ranked = [rank1, rank2, rank3];
  if (new Set(ranked).size !== 3) {
    return res.status(400).json({ error: 'Each ranked pair must be different' });
  }

  for (const r of ranked) {
    const rData = db.getPairById(r);
    if (!rData) return res.status(400).json({ error: `Unknown pair: ${r}` });
    if (rData.cohort === pairData.cohort) {
      return res.status(400).json({ error: 'Can only rank pairs from the opposite cohort' });
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
  const pairs   = db.getPairs();
  const ratings = db.getAllRatings();

  const sem3  = pairs.filter(p => p.cohort === 'sem3');
  const sem12 = pairs.filter(p => p.cohort === 'sem12');

  const cells = {};
  for (const s3 of sem3) {
    cells[s3.id] = {};
    for (const s1 of sem12) {
      const relevant = ratings.filter(r =>
        (r.rater_pair === s3.id && r.rated_pair === s1.id) ||
        (r.rater_pair === s1.id && r.rated_pair === s3.id)
      );
      if (relevant.length === 0) {
        cells[s3.id][s1.id] = null;
      } else {
        const scores = relevant.map(r => (r.skill_comp + r.project_align + r.comm_fit) / 3);
        const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
        cells[s3.id][s1.id] = {
          average: Math.round(avg * 100) / 100,
          count:   relevant.length,
          details: relevant.map(r => ({
            rater:        r.rater_pair,
            rated:        r.rated_pair,
            round:        r.round,
            skillComp:    r.skill_comp,
            projectAlign: r.project_align,
            commFit:      r.comm_fit,
            notes:        r.notes,
            timestamp:    r.timestamp,
          })),
        };
      }
    }
  }

  res.json({
    sem3Pairs:  sem3 .map(p => ({ id: p.id, label: p.label })),
    sem12Pairs: sem12.map(p => ({ id: p.id, label: p.label })),
    cells,
  });
});

app.get('/api/dashboard/rankings', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const rankings = db.getAllRankings();

  const pairMap     = Object.fromEntries(pairs.map(p => [p.id, p]));
  const sem3Rnks    = rankings.filter(r => pairMap[r.pair_id]?.cohort === 'sem3');
  const sem12RnkMap = Object.fromEntries(
    rankings
      .filter(r => pairMap[r.pair_id]?.cohort === 'sem12')
      .map(r => [r.pair_id, [r.rank_1, r.rank_2, r.rank_3]])
  );

  const mutual   = [];
  const oneSided = [];

  for (const s3r of sem3Rnks) {
    const s3Prefs = [s3r.rank_1, s3r.rank_2, s3r.rank_3];
    for (let i = 0; i < s3Prefs.length; i++) {
      const s12Id = s3Prefs[i];
      if (!s12Id) continue;
      const s12Prefs     = sem12RnkMap[s12Id] || [];
      const s12RankOfS3  = s12Prefs.indexOf(s3r.pair_id);

      if (s12RankOfS3 >= 0) {
        mutual.push({ sem3: s3r.pair_id, sem12: s12Id, sem3Rank: i + 1, sem12Rank: s12RankOfS3 + 1 });
      } else {
        oneSided.push({ sem3: s3r.pair_id, sem12: s12Id, sem3Rank: i + 1, sem12HasRanked: s12Prefs.length > 0 });
      }
    }
  }

  mutual.sort((a, b) => (a.sem3Rank + a.sem12Rank) - (b.sem3Rank + b.sem12Rank));

  res.json({ rankings, mutual, oneSided });
});

app.get('/api/dashboard/progress', requireAdmin, (_req, res) => {
  const pairs    = db.getPairs();
  const ratings  = db.getAllRatings();
  const rankings = db.getAllRankings();

  const ratingsByPair = {};
  for (const p of pairs) ratingsByPair[p.id] = {};

  for (const r of ratings) {
    if (!ratingsByPair[r.rater_pair][r.round]) ratingsByPair[r.rater_pair][r.round] = [];
    ratingsByPair[r.rater_pair][r.round].push(r.rated_pair);
  }

  res.json({
    pairs:              pairs.map(p => ({ id: p.id, cohort: p.cohort, label: p.label })),
    ratingsByPair,
    rankingsSubmitted:  rankings.map(r => r.pair_id),
  });
});

// ── Admin: edit pair name ─────────────────────────────────────────
app.post('/api/dashboard/pair/label', requireAdmin, (req, res) => {
  const { pairId, label } = req.body;
  if (!pairId || !label) return res.status(400).json({ error: 'Missing pairId or label' });

  const pair = db.getPairById(pairId);
  if (!pair) return res.status(400).json({ error: 'Invalid pair ID' });

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
  const { numSem3, numSem12 } = req.body;
  const s3  = Math.max(1, Math.min(30, parseInt(numSem3, 10)  || 10));
  const s12 = Math.max(1, Math.min(30, parseInt(numSem12, 10) || 10));

  try {
    db.resetSession();

    const newPairs = [];
    for (let i = 1; i <= s3; i++) {
      newPairs.push({ id: `S3-${String(i).padStart(2, '0')}`, cohort: 'sem3', label: `S3-${String(i).padStart(2, '0')}` });
    }
    for (let i = 1; i <= s12; i++) {
      newPairs.push({ id: `S1-${String(i).padStart(2, '0')}`, cohort: 'sem12', label: `S1-${String(i).padStart(2, '0')}` });
    }
    db.seedPairs(newPairs);
    res.json({ success: true, sem3: s3, sem12: s12 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: save criteria ─────────────────────────────────────────
app.post('/api/dashboard/criteria', requireAdmin, (req, res) => {
  const { criteria } = req.body;
  if (!Array.isArray(criteria) || criteria.length !== 3) {
    return res.status(400).json({ error: 'Criteria must be an array of 3 items' });
  }

  const keys = ['skillComp', 'projectAlign', 'commFit'];
  const cleaned = criteria.map((c, i) => ({
    key:       keys[i],
    name:      String(c.name || '').trim().slice(0, 30) || DEFAULT_CRITERIA[i].name,
    lowLabel:  String(c.lowLabel || '').trim().slice(0, 30) || DEFAULT_CRITERIA[i].lowLabel,
    highLabel: String(c.highLabel || '').trim().slice(0, 30) || DEFAULT_CRITERIA[i].highLabel,
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
  const pairs   = db.getPairs();
  const ratings = db.getAllRatings();
  const sem3    = pairs.filter(p => p.cohort === 'sem3');
  const sem12   = pairs.filter(p => p.cohort === 'sem12');

  const rows = [['', ...sem12.map(p => p.id)]];
  for (const s3 of sem3) {
    const row = [s3.id];
    for (const s1 of sem12) {
      const rel = ratings.filter(r =>
        (r.rater_pair === s3.id && r.rated_pair === s1.id) ||
        (r.rater_pair === s1.id && r.rated_pair === s3.id)
      );
      if (rel.length === 0) {
        row.push('');
      } else {
        const scores = rel.map(r => (r.skill_comp + r.project_align + r.comm_fit) / 3);
        const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
        row.push((Math.round(avg * 100) / 100).toFixed(2));
      }
    }
    rows.push(row);
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="compatibility-matrix.csv"');
  res.send(rows.map(r => r.join(',')).join('\n'));
});

app.get('/api/export/ratings.csv', requireAdmin, (_req, res) => {
  const ratings = db.getAllRatings();
  const header  = ['id', 'rater_pair', 'rated_pair', 'round', 'skill_comp', 'project_align', 'comm_fit', 'notes', 'timestamp'];
  const rows    = [header, ...ratings.map(r => [
    r.id, r.rater_pair, r.rated_pair, r.round,
    r.skill_comp, r.project_align, r.comm_fit,
    `"${(r.notes || '').replace(/"/g, '""')}"`,
    r.timestamp,
  ])];

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
