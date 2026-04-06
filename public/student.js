/* ── State ───────────────────────────────────────────────────────── */
let myTeam = null;
let oppositeTeams = [];
let criteria = [];
let scores = {};
let myRatings = {};
let isEditing = false;
let pendingSubmit = false;

const PALETTE = [
  '115,204,204', '217,166,230', '170,130,255', '255,183,110',
  '130,220,130', '255,130,150', '130,190,255', '230,210,120',
];
const COLOR_NAMES = ['teal','pink','purple','orange','green','coral','blue','gold'];
const CX = 200, CY = 195, MAX_R = 145;
let svg;
let dragging = null;

function shortLabel(name) {
  if (name.length <= 12) return name;
  const abbrevs = { 'Communication': 'Comms', 'Complementarity': 'Compl.' };
  return abbrevs[name] || name.slice(0, 11) + '.';
}

function angles() {
  return criteria.map((_, i) => -Math.PI / 2 + (2 * Math.PI * i) / criteria.length);
}

document.addEventListener('DOMContentLoaded', async () => {
  svg = document.getElementById('radarSvg');
  await loadCriteria();   // load default criteria so chart renders immediately

  // Try auto-login from saved team code
  const savedTeamCode = localStorage.getItem('teamCode');
  if (savedTeamCode) {
    const ok = await authenticateCode(savedTeamCode);
    if (!ok) localStorage.removeItem('teamCode');
  }

  bindCodeEntry();
  bindNameModal();
  bindChartEvents();
  renderChart();
});

/* ── Team code entry ────────────────────────────────────────────── */
function bindCodeEntry() {
  document.getElementById('codeSubmit').addEventListener('click', handleHeaderCodeSubmit);
  document.getElementById('codeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleHeaderCodeSubmit();
  });

  document.getElementById('codeSubmitModal').addEventListener('click', handleModalCodeSubmit);
  document.getElementById('codeInputModal').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleModalCodeSubmit();
  });
  document.getElementById('codeSkip').addEventListener('click', () => {
    document.getElementById('codeOverlay').classList.remove('show');
    pendingSubmit = false;
  });

  document.getElementById('submitBtn').addEventListener('click', handleSubmit);
}

async function handleHeaderCodeSubmit() {
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if (!code) return;
  const ok = await authenticateCode(code);
  if (ok) localStorage.setItem('teamCode', code);
  else showBanner('Invalid code. Check with your facilitator.', 'error');
}

async function handleModalCodeSubmit() {
  const code    = document.getElementById('codeInputModal').value.trim().toUpperCase();
  const errorEl = document.getElementById('codeError');
  if (!code) return;

  const ok = await authenticateCode(code);
  if (ok) {
    localStorage.setItem('teamCode', code);
    document.getElementById('codeOverlay').classList.remove('show');
    errorEl.style.display = 'none';
    pendingSubmit = false;
  } else {
    errorEl.style.display = 'block';
  }
}

function showCodeModal() {
  document.getElementById('codeInputModal').value = '';
  document.getElementById('codeError').style.display = 'none';
  document.getElementById('codeOverlay').classList.add('show');
  setTimeout(() => document.getElementById('codeInputModal').focus(), 100);
}

async function authenticateCode(code) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    myTeam        = data.team;
    oppositeTeams = data.oppositeTeams;

    // Show badge, hide header code entry
    document.getElementById('headerCode').style.display = 'none';
    const badge = document.getElementById('teamBadge');
    badge.textContent = myTeam.label === myTeam.id ? myTeam.code : myTeam.label;
    badge.style.display = 'block';

    // Reload session-specific criteria
    await loadCriteria();
    populateMetDropdown();
    await loadMyRatings(myTeam.id);
    markRatedPairs();

    if (myTeam.label === myTeam.id) showNameModal();
    return true;
  } catch { return false; }
}

/* ── Load criteria ──────────────────────────────────────────────── */
async function loadCriteria() {
  try {
    const pairId = myTeam?.id || '';
    const res  = await fetch(`/api/criteria?pair=${encodeURIComponent(pairId)}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length >= 2) criteria = data;
  } catch {}

  if (!criteria.length) {
    criteria = [
      { name: 'Skills',        lowLabel: 'Overlapping', highLabel: 'Complementary' },
      { name: 'Interest',      lowLabel: 'Different',   highLabel: 'Similar' },
      { name: 'Communication', lowLabel: 'Warming up',  highLabel: 'Natural flow' },
    ];
  }

  scores = {};
  criteria.forEach((_, i) => { scores[`axis${i}`] = null; });
  buildScoreRows();
}

function buildScoreRows() {
  const container = document.getElementById('scoreControls');
  container.innerHTML = '';
  criteria.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.dataset.axis  = `axis${i}`;
    row.dataset.color = COLOR_NAMES[i % COLOR_NAMES.length];
    row.style.setProperty('--sc', PALETTE[i % PALETTE.length]);
    row.innerHTML = `
      <span class="score-name">${esc(c.name)}</span>
      <div class="score-btns">
        ${[1,2,3,4,5].map(v => `<button type="button" class="score-btn" data-value="${v}">${v}</button>`).join('')}
      </div>
      <div class="score-ends"><span>${esc(c.lowLabel)}</span><span>${esc(c.highLabel)}</span></div>`;
    row.querySelectorAll('.score-btn').forEach(btn => {
      btn.addEventListener('click', () => setScore(`axis${i}`, parseInt(btn.dataset.value, 10)));
    });
    container.appendChild(row);
  });
}

/* ── Met dropdown ───────────────────────────────────────────────── */
function populateMetDropdown() {
  const sel = document.getElementById('metPair');
  sel.innerHTML = '<option value="">Who did you meet?</option>';
  for (const t of oppositeTeams) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label === t.id ? t.id : t.label;
    sel.appendChild(opt);
  }
  sel.disabled = false;
  sel.addEventListener('change', e => handleMetPairChange(e.target.value));
}

/* ── Name modal ─────────────────────────────────────────────────── */
function bindNameModal() {
  document.getElementById('saveNames').addEventListener('click', saveNames);
  document.getElementById('skipNames').addEventListener('click', () => {
    document.getElementById('nameOverlay').classList.remove('show');
  });
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
  try {
    const res = await fetch('/api/pair/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairId: myTeam.id, label }),
    });
    const data = await res.json();
    if (data.success) {
      myTeam.label = data.label;
      document.getElementById('teamBadge').textContent = data.label;
      document.getElementById('nameOverlay').classList.remove('show');
    }
  } catch { showBanner('Error saving name.', 'error'); }
}

/* ── Ratings ────────────────────────────────────────────────────── */
async function loadMyRatings(pairId) {
  try {
    const res = await fetch(`/api/ratings/${pairId}`);
    myRatings = await res.json();
  } catch { myRatings = {}; }
}

function markRatedPairs() {
  const sel = document.getElementById('metPair');
  for (const opt of sel.options) {
    if (opt.value && myRatings[opt.value]) {
      if (!opt.textContent.endsWith(' ✓')) opt.textContent += ' ✓';
    }
  }
}

function handleMetPairChange(metPairId) {
  resetScores();
  const existing = metPairId ? myRatings[metPairId] : null;
  if (existing?.scores) {
    isEditing = true;
    for (const [key, val] of Object.entries(existing.scores)) setScore(key, val);
    document.getElementById('notes').value = existing.notes || '';
    document.getElementById('submitBtn').textContent = 'Update';
    showBanner('Previously submitted — edit and update if needed.', 'info');
  } else {
    isEditing = false;
    document.getElementById('notes').value = '';
    document.getElementById('submitBtn').textContent = 'Submit';
    hideBanner();
  }
}

function resetScores() {
  criteria.forEach((_, i) => { scores[`axis${i}`] = null; });
  document.querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
  renderChart();
}

function setScore(axis, value) {
  scores[axis] = value;
  const row = document.querySelector(`.score-row[data-axis="${axis}"]`);
  if (row) row.querySelectorAll('.score-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.value, 10) === value);
  });
  renderChart();
}

/* ── Chart interaction ──────────────────────────────────────────── */
function svgCoords(e) {
  const rect = svg.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width * 400, y: (e.clientY - rect.top) / rect.height * 420 };
}

function bindChartEvents() {
  svg.addEventListener('pointerdown', e => {
    const pt = svgCoords(e);
    const a  = angles();
    for (let i = 0; i < criteria.length; i++) {
      const v  = scores[`axis${i}`] || 0;
      const r  = (v / 5) * MAX_R;
      const vx = CX + r * Math.cos(a[i]);
      const vy = CY + r * Math.sin(a[i]);
      if (Math.hypot(pt.x - vx, pt.y - vy) < 30) {
        dragging = i; svg.setPointerCapture(e.pointerId); return;
      }
    }
    for (let i = 0; i < criteria.length; i++) {
      const dx   = pt.x - CX, dy = pt.y - CY;
      const proj = dx * Math.cos(a[i]) + dy * Math.sin(a[i]);
      const perp = Math.abs(-dx * Math.sin(a[i]) + dy * Math.cos(a[i]));
      if (proj > 0 && proj <= MAX_R + 15 && perp < 35) {
        setScore(`axis${i}`, Math.round(Math.max(1, Math.min(5, proj / (MAX_R / 5)))));
        dragging = i; svg.setPointerCapture(e.pointerId); return;
      }
    }
  });
  svg.addEventListener('pointermove', e => {
    if (dragging === null) return;
    const pt   = svgCoords(e);
    const ang  = angles()[dragging];
    const proj = (pt.x - CX) * Math.cos(ang) + (pt.y - CY) * Math.sin(ang);
    setScore(`axis${dragging}`, Math.round(Math.max(1, Math.min(5, proj / (MAX_R / 5)))));
  });
  svg.addEventListener('pointerup',     () => { dragging = null; });
  svg.addEventListener('pointercancel', () => { dragging = null; });
}

/* ── Render radar chart ─────────────────────────────────────────── */
function renderChart() {
  const n = criteria.length;
  if (!n) return;
  const a    = angles();
  const vals = criteria.map((_, i) => scores[`axis${i}`] || 0);
  const hasAny = vals.some(v => v > 0);
  let html = '';

  for (let lv = 1; lv <= 5; lv++) {
    const r   = (lv / 5) * MAX_R;
    const pts = a.map(ang => `${CX + r * Math.cos(ang)},${CY + r * Math.sin(ang)}`).join(' ');
    html += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,${lv === 5 ? 0.14 : 0.05})" stroke-width="1"/>`;
  }

  for (let i = 0; i < n; i++) {
    html += `<line x1="${CX}" y1="${CY}" x2="${CX + MAX_R * Math.cos(a[i])}" y2="${CY + MAX_R * Math.sin(a[i])}" stroke="rgba(${PALETTE[i % PALETTE.length]},.2)" stroke-width="1.5"/>`;
    for (let lv = 1; lv <= 5; lv++) {
      const r  = (lv / 5) * MAX_R;
      const x  = CX + r * Math.cos(a[i]), y = CY + r * Math.sin(a[i]);
      const px = 4 * Math.cos(a[i] + Math.PI / 2), py = 4 * Math.sin(a[i] + Math.PI / 2);
      html += `<line x1="${x - px}" y1="${y - py}" x2="${x + px}" y2="${y + py}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>`;
    }
  }

  if (hasAny) {
    const dataPts = vals.map((v, i) => {
      const r = v === 0 ? 0 : (v / 5) * MAX_R;
      return `${CX + r * Math.cos(a[i])},${CY + r * Math.sin(a[i])}`;
    }).join(' ');
    html += `<polygon points="${dataPts}" fill="rgba(200,180,255,.1)" stroke="rgba(200,180,255,.45)" stroke-width="2.5" stroke-linejoin="round"/>`;
  }

  for (let i = 0; i < n; i++) {
    const v = vals[i];
    const r = (v / 5) * MAX_R;
    const x = CX + r * Math.cos(a[i]), y = CY + r * Math.sin(a[i]);
    const c = PALETTE[i % PALETTE.length];
    html += `<circle cx="${x}" cy="${y}" r="16" fill="rgba(${c},.15)" stroke="none"/>`;
    html += `<circle cx="${x}" cy="${y}" r="10" fill="rgba(${c},.35)" stroke="rgb(${c})" stroke-width="2.5" style="cursor:grab"/>`;
    html += `<circle cx="${x}" cy="${y}" r="4" fill="rgb(${c})" style="pointer-events:none"/>`;
  }

  for (let i = 0; i < n; i++) {
    const c      = PALETTE[i % PALETTE.length];
    const labelR = MAX_R + 35;
    const lx     = CX + labelR * Math.cos(a[i]);
    const ly     = CY + labelR * Math.sin(a[i]);
    const anchor = Math.abs(a[i]) < 0.1 || Math.abs(a[i] - Math.PI) < 0.1 ? 'middle'
      : Math.cos(a[i]) < -0.1 ? 'end' : Math.cos(a[i]) > 0.1 ? 'start' : 'middle';
    let fx = lx, fy = ly;
    if (i === 0 && n > 2) { fx = CX; fy = 18; }
    html += `<text x="${fx}" y="${fy}" text-anchor="${i === 0 && n > 2 ? 'middle' : anchor}" fill="rgb(${c})" font-size="14" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700">${esc(shortLabel(criteria[i].name))}</text>`;
    if (vals[i] > 0) {
      html += `<text x="${fx}" y="${fy + 16}" text-anchor="${i === 0 && n > 2 ? 'middle' : anchor}" fill="rgba(${c},.6)" font-size="11" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="500">${vals[i]} / 5</text>`;
    }
  }

  if (!hasAny) {
    html += `<text x="${CX}" y="${CY}" text-anchor="middle" dominant-baseline="middle" fill="rgba(235,235,245,.2)" font-size="13" font-family="-apple-system,BlinkMacSystemFont,sans-serif">Tap an axis or use buttons</text>`;
  }
  svg.innerHTML = html;
}

/* ── Submit ─────────────────────────────────────────────────────── */
async function handleSubmit() {
  if (!myTeam) {
    pendingSubmit = true;
    showCodeModal();
    return;
  }

  const metPair = document.getElementById('metPair').value;
  if (!metPair) return showBanner('Select who you met.', 'error');
  for (let i = 0; i < criteria.length; i++) {
    if (!scores[`axis${i}`]) return showBanner(`Set a ${criteria[i].name} score.`, 'error');
  }

  const notes = document.getElementById('notes').value.trim();
  try {
    const res = await fetch('/api/rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raterPair: myTeam.id, ratedPair: metPair, scores: { ...scores }, notes }),
    });
    const data = await res.json();
    if (data.success) {
      myRatings[metPair] = { scores: { ...scores }, notes };
      markRatedPairs();
      showBanner(isEditing ? 'Compatibility updated!' : 'Compatibility submitted!', 'success');
      isEditing = true;
      document.getElementById('submitBtn').textContent = 'Update';
    } else {
      showBanner(data.error || 'Error submitting.', 'error');
    }
  } catch { showBanner('Network error.', 'error'); }
}

/* ── Banner ─────────────────────────────────────────────────────── */
function showBanner(msg, type) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner ${type} show`;
  if (type !== 'info') {
    clearTimeout(el._timer);
    el._timer = setTimeout(hideBanner, 3500);
  }
}
function hideBanner() {
  document.getElementById('banner').className = 'banner';
}

/* ── Util ────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
