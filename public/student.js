/* ── State ───────────────────────────────────────────────────────── */
let pairsData = { sem3: [], sem12: [] };
const scores = { skillComp: null, projectAlign: null, commFit: null };
let myRatings = {};  // { ratedPairId: { skillComp, projectAlign, commFit, notes } }
let isEditing = false; // true when viewing a previously submitted rating

const FIELDS = ['skillComp', 'projectAlign', 'commFit'];
let LABELS = ['Skills', 'Interest', 'Comms'];
const COLORS = ['115,204,204', '217,166,230', '170,130,255'];

function shortLabel(name) {
  if (name.length <= 8) return name;
  // Common abbreviations
  const abbrevs = { 'Communication': 'Comms', 'Complementarity': 'Compl.' };
  return abbrevs[name] || name.slice(0, 7) + '.';
}

/* SVG geometry */
const CX = 200, CY = 195, MAX_R = 145;
const ANGLES = [-Math.PI / 2, 5 * Math.PI / 6, Math.PI / 6];

let svg;
let dragging = null;

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  svg = document.getElementById('radarSvg');
  await Promise.all([loadPairs(), loadCriteria()]);
  restoreYourPair();
  bindEvents();
  bindChartEvents();
  bindNameModal();
  renderChart();
});

async function loadCriteria() {
  try {
    const res = await fetch('/api/criteria');
    const criteria = await res.json();
    if (!Array.isArray(criteria) || criteria.length !== 3) return;

    // Update button labels
    const rows = document.querySelectorAll('.score-row');
    criteria.forEach((c, i) => {
      if (!rows[i]) return;
      const nameEl = rows[i].querySelector('.score-name');
      const endsEl = rows[i].querySelector('.score-ends');
      if (nameEl) nameEl.textContent = c.name;
      if (endsEl) {
        const spans = endsEl.querySelectorAll('span');
        if (spans[0]) spans[0].textContent = c.lowLabel;
        if (spans[1]) spans[1].textContent = c.highLabel;
      }
      LABELS[i] = shortLabel(c.name);
    });
  } catch { /* use defaults */ }
}

/* ── Data loading ────────────────────────────────────────────────── */
async function loadPairs() {
  const res = await fetch('/api/pairs');
  pairsData = await res.json();
  populateYourPair();
}

function populateYourPair() {
  const sel = document.getElementById('yourPair');
  sel.innerHTML = '<option value="">Your team</option>';
  const groups = [
    { label: 'Semester 3', pairs: pairsData.sem3 },
    { label: 'Semester 1 & 2', pairs: pairsData.sem12 },
  ];
  for (const g of groups) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const p of g.pairs) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
}

function populateMetPair(yourCohort) {
  const sel = document.getElementById('metPair');
  sel.innerHTML = '<option value="">Who did you meet?</option>';
  const opposite = yourCohort === 'sem3' ? pairsData.sem12 : pairsData.sem3;
  for (const p of opposite) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  sel.disabled = false;
}

function restoreYourPair() {
  const saved = localStorage.getItem('myPairId');
  if (saved) {
    const sel = document.getElementById('yourPair');
    sel.value = saved;
    if (sel.value === saved) handleYourPairChange(saved);
  }
}

/* ── Name modal ──────────────────────────────────────────────────── */
function bindNameModal() {
  document.getElementById('saveNames').addEventListener('click', saveNames);
  document.getElementById('skipNames').addEventListener('click', () => {
    document.getElementById('nameOverlay').classList.remove('show');
  });

  // Allow Enter to submit
  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNames();
  });
}

function showNameModal() {
  document.getElementById('nameInput').value = '';
  document.getElementById('nameOverlay').classList.add('show');
  setTimeout(() => document.getElementById('nameInput').focus(), 100);
}

async function saveNames() {
  const label = document.getElementById('nameInput').value.trim();
  if (!label) return;

  const pairId = document.getElementById('yourPair').value;

  try {
    const res = await fetch('/api/pair/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairId, label }),
    });
    const data = await res.json();
    if (data.success) {
      // Update local data
      const allLists = [pairsData.sem3, pairsData.sem12];
      for (const list of allLists) {
        const found = list.find(p => p.id === pairId);
        if (found) found.label = data.label;
      }
      // Refresh dropdowns
      populateYourPair();
      document.getElementById('yourPair').value = pairId;
      const cohort = pairsData.sem3.find(p => p.id === pairId) ? 'sem3' : 'sem12';
      populateMetPair(cohort);

      localStorage.setItem('pairNamed_' + pairId, '1');
      document.getElementById('nameOverlay').classList.remove('show');
      showBanner('Names saved!', 'success');
    }
  } catch {
    showBanner('Could not save names.', 'error');
  }
}

/* ── Event binding ───────────────────────────────────────────────── */
function bindEvents() {
  document.getElementById('yourPair').addEventListener('change', e => {
    handleYourPairChange(e.target.value);
  });

  document.getElementById('metPair').addEventListener('change', e => {
    handleMetPairChange(e.target.value);
  });

  document.querySelectorAll('.score-row').forEach(row => {
    row.querySelectorAll('.score-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = row.dataset.field;
        const value = parseInt(btn.dataset.value, 10);
        setScore(field, value);
      });
    });
  });

  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
}

async function handleYourPairChange(pairId) {
  if (!pairId) {
    document.getElementById('metPair').disabled = true;
    document.getElementById('metPair').innerHTML = '<option value="">Select your team first</option>';
    return;
  }
  localStorage.setItem('myPairId', pairId);
  const cohort = pairsData.sem3.find(p => p.id === pairId) ? 'sem3' : 'sem12';
  populateMetPair(cohort);

  // Load existing ratings for this pair
  await loadMyRatings(pairId);

  // Mark already-rated pairs in the dropdown
  markRatedPairs();

  // Check if pair needs names
  const allPairs = [...pairsData.sem3, ...pairsData.sem12];
  const pair = allPairs.find(p => p.id === pairId);
  const alreadyNamed = localStorage.getItem('pairNamed_' + pairId);
  if (pair && pair.label === pair.id && !alreadyNamed) {
    showNameModal();
  }
}

async function loadMyRatings(pairId) {
  try {
    const res = await fetch(`/api/ratings/${pairId}`);
    myRatings = await res.json();
  } catch {
    myRatings = {};
  }
}

function markRatedPairs() {
  const sel = document.getElementById('metPair');
  for (const opt of sel.options) {
    if (!opt.value) continue;
    if (myRatings[opt.value]) {
      opt.textContent = opt.textContent.replace(/ ✓$/, '') + ' ✓';
    }
  }
}

function handleMetPairChange(metPairId) {
  const btn = document.getElementById('submitBtn');
  const existing = metPairId ? myRatings[metPairId] : null;

  if (existing) {
    // Load saved scores into the form
    setScore('skillComp', existing.skillComp);
    setScore('projectAlign', existing.projectAlign);
    setScore('commFit', existing.commFit);
    document.getElementById('notes').value = existing.notes || '';
    isEditing = true;
    btn.textContent = 'Update';
    showBanner('Previously submitted \u2014 edit and update if needed.', 'success');
  } else {
    // Clear for fresh entry
    resetScores();
    isEditing = false;
    btn.textContent = 'Submit';
  }
}

function resetScores() {
  scores.skillComp = null;
  scores.projectAlign = null;
  scores.commFit = null;
  document.querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('notes').value = '';
  renderChart();
}

function setScore(field, value) {
  scores[field] = value;
  const row = document.querySelector(`.score-row[data-field="${field}"]`);
  if (row) {
    row.querySelectorAll('.score-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === value);
    });
  }
  renderChart();
}

function setScoreByAxis(axisIndex, level) {
  setScore(FIELDS[axisIndex], level);
}

/* ── Interactive triangle chart ──────────────────────────────────── */
function svgCoords(e) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * 400,
    y: (e.clientY - rect.top) / rect.height * 420,
  };
}

function bindChartEvents() {
  svg.addEventListener('pointerdown', e => {
    const pt = svgCoords(e);

    // Check if near an existing vertex dot
    for (let i = 0; i < 3; i++) {
      const v = scores[FIELDS[i]] || 0;
      if (v === 0) continue;
      const r = (v / 5) * MAX_R;
      const vx = CX + r * Math.cos(ANGLES[i]);
      const vy = CY + r * Math.sin(ANGLES[i]);
      if (Math.hypot(pt.x - vx, pt.y - vy) < 30) {
        dragging = i;
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    // Check if tapping along an axis line
    for (let i = 0; i < 3; i++) {
      const ax = Math.cos(ANGLES[i]);
      const ay = Math.sin(ANGLES[i]);
      const dx = pt.x - CX;
      const dy = pt.y - CY;
      const proj = dx * ax + dy * ay;
      const perpDist = Math.abs(dx * ay - dy * ax);

      if (proj > 0 && proj <= MAX_R + 15 && perpDist < 35) {
        const level = Math.round(Math.max(1, Math.min(5, proj / (MAX_R / 5))));
        setScoreByAxis(i, level);
        dragging = i;
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
  });

  svg.addEventListener('pointermove', e => {
    if (dragging === null) return;
    e.preventDefault();
    const pt = svgCoords(e);
    const ax = Math.cos(ANGLES[dragging]);
    const ay = Math.sin(ANGLES[dragging]);
    const dx = pt.x - CX;
    const dy = pt.y - CY;
    const proj = dx * ax + dy * ay;
    const level = Math.round(Math.max(1, Math.min(5, proj / (MAX_R / 5))));
    setScoreByAxis(dragging, level);
  });

  svg.addEventListener('pointerup', () => { dragging = null; });
  svg.addEventListener('pointercancel', () => { dragging = null; });
}

/* ── Render triangle SVG ─────────────────────────────────────────── */
function renderChart() {
  const vals = FIELDS.map(f => scores[f] || 0);
  const hasAny = vals.some(v => v > 0);
  let html = '';

  // Grid rings (concentric triangles at levels 1–5)
  for (let lv = 1; lv <= 5; lv++) {
    const r = (lv / 5) * MAX_R;
    const pts = ANGLES.map(a =>
      `${CX + r * Math.cos(a)},${CY + r * Math.sin(a)}`
    ).join(' ');
    html += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,${lv === 5 ? 0.14 : 0.05})" stroke-width="1"/>`;
  }

  // Axis lines with tick marks
  for (let i = 0; i < 3; i++) {
    const a = ANGLES[i];
    html += `<line x1="${CX}" y1="${CY}" x2="${CX + MAX_R * Math.cos(a)}" y2="${CY + MAX_R * Math.sin(a)}" stroke="rgba(${COLORS[i]},.2)" stroke-width="1.5"/>`;

    // Tick marks
    for (let lv = 1; lv <= 5; lv++) {
      const r = (lv / 5) * MAX_R;
      const x = CX + r * Math.cos(a);
      const y = CY + r * Math.sin(a);
      const px = -Math.sin(a) * 4;
      const py = Math.cos(a) * 4;
      html += `<line x1="${x - px}" y1="${y - py}" x2="${x + px}" y2="${y + py}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>`;
    }
  }

  // Data polygon
  if (hasAny) {
    const dataPts = vals.map((v, i) => {
      const r = Math.max(v, 0) === 0 ? 0 : (v / 5) * MAX_R;
      return `${CX + r * Math.cos(ANGLES[i])},${CY + r * Math.sin(ANGLES[i])}`;
    }).join(' ');
    html += `<polygon points="${dataPts}" fill="rgba(200,180,255,.1)" stroke="rgba(200,180,255,.45)" stroke-width="2.5" stroke-linejoin="round"/>`;
  }

  // Draggable vertex dots
  for (let i = 0; i < 3; i++) {
    const v = vals[i];
    if (!v) continue;
    const r = (v / 5) * MAX_R;
    const x = CX + r * Math.cos(ANGLES[i]);
    const y = CY + r * Math.sin(ANGLES[i]);

    // Outer glow
    html += `<circle cx="${x}" cy="${y}" r="16" fill="rgba(${COLORS[i]},.15)" stroke="none"/>`;
    // Main dot
    html += `<circle cx="${x}" cy="${y}" r="10" fill="rgba(${COLORS[i]},.35)" stroke="rgb(${COLORS[i]})" stroke-width="2.5" style="cursor:grab"/>`;
    // Inner dot
    html += `<circle cx="${x}" cy="${y}" r="4" fill="rgb(${COLORS[i]})" style="pointer-events:none"/>`;
  }

  // Axis labels — positioned to avoid edge clipping
  const labelPos = [
    { x: CX, y: 18, anchor: 'middle', valDy: 17 },
    { x: 70, y: CY + MAX_R * Math.sin(5*Math.PI/6) + 38, anchor: 'start', valDy: 17 },
    { x: 330, y: CY + MAX_R * Math.sin(Math.PI/6) + 38, anchor: 'end', valDy: 17 },
  ];

  for (let i = 0; i < 3; i++) {
    const lp = labelPos[i];
    html += `<text x="${lp.x}" y="${lp.y}" text-anchor="${lp.anchor}" fill="rgb(${COLORS[i]})" font-size="15" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700">${LABELS[i]}</text>`;

    if (vals[i]) {
      html += `<text x="${lp.x}" y="${lp.y + lp.valDy}" text-anchor="${lp.anchor}" fill="rgba(${COLORS[i]},.6)" font-size="12" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="500">${vals[i]} / 5</text>`;
    }
  }

  // Center hint when empty
  if (!hasAny) {
    html += `<text x="${CX}" y="${CY}" text-anchor="middle" dominant-baseline="middle" fill="rgba(235,235,245,.2)" font-size="13" font-family="-apple-system,BlinkMacSystemFont,sans-serif">Tap an axis or use buttons</text>`;
  }

  svg.innerHTML = html;
}

/* ── Submit ──────────────────────────────────────────────────────── */
async function handleSubmit() {
  const yourPair = document.getElementById('yourPair').value;
  const metPair  = document.getElementById('metPair').value;
  const notes    = document.getElementById('notes').value.trim();

  if (!yourPair) return showBanner('Select your team in the top right.', 'error');
  if (!metPair)  return showBanner('Select who you met.', 'error');
  if (!scores.skillComp)    return showBanner('Set a Skills score.', 'error');
  if (!scores.projectAlign) return showBanner('Set an Interest score.', 'error');
  if (!scores.commFit)      return showBanner('Set a Communication score.', 'error');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting\u2026';

  try {
    const res = await fetch('/api/rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raterPair:    yourPair,
        ratedPair:    metPair,
        skillComp:    scores.skillComp,
        projectAlign: scores.projectAlign,
        commFit:      scores.commFit,
        notes,
      }),
    });
    const data = await res.json();

    if (data.success) {
      const msg = isEditing ? 'Compatibility updated!' : 'Compatibility submitted!';
      showBanner(msg, 'success');

      // Update local cache so re-selecting shows the new data
      myRatings[metPair] = {
        skillComp:    scores.skillComp,
        projectAlign: scores.projectAlign,
        commFit:      scores.commFit,
        notes,
      };
      resetPartial();
      markRatedPairs();
    } else {
      showBanner(data.error || 'Something went wrong.', 'error');
    }
  } catch {
    showBanner('Network error \u2014 please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit';
  }
}

function resetPartial() {
  document.getElementById('metPair').value = '';
  resetScores();
  isEditing = false;
  document.getElementById('submitBtn').textContent = 'Submit';
}

/* ── Banner ──────────────────────────────────────────────────────── */
function showBanner(msg, type) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner show ${type}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => el.classList.remove('show'), 4000);
}
