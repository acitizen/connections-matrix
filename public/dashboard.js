/* ── Auth ────────────────────────────────────────────────────────── */
let adminPassword = localStorage.getItem('adminPassword') || '';
let sessionGroups = [];
let currentCriteria = [];

document.addEventListener('DOMContentLoaded', () => {
  if (adminPassword) {
    attemptAuth(adminPassword);
  }

  document.getElementById('passwordSubmit').addEventListener('click', () => {
    const pw = document.getElementById('passwordInput').value.trim();
    if (pw) attemptAuth(pw);
  });
  document.getElementById('passwordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('passwordSubmit').click();
  });
});

async function attemptAuth(pw) {
  const res = await fetch('/api/dashboard/matrix', {
    headers: { Authorization: `Bearer ${pw}` },
  });
  if (res.ok) {
    adminPassword = pw;
    localStorage.setItem('adminPassword', pw);
    showDashboard();
    const data = await res.json();
    sessionGroups = data.groups || [];
    currentCriteria = data.criteria || [];
    renderMatrix(data);
    loadMatches();
    loadProgress();
  } else {
    document.getElementById('passwordError').classList.add('show');
    localStorage.removeItem('adminPassword');
    adminPassword = '';
  }
}

function showDashboard() {
  document.getElementById('passwordGate').style.display = 'none';
  document.getElementById('dashMain').style.display = 'flex';
  bindDashEvents();
}

/* ── Auth helper ─────────────────────────────────────────────────── */
function authFetch(url) {
  return fetch(url, { headers: { Authorization: `Bearer ${adminPassword}` } });
}

/* ── Tab navigation ──────────────────────────────────────────────── */
function bindDashEvents() {
  document.querySelectorAll('.dash-nav button[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-nav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Export buttons (header)
  document.getElementById('exportMatrix').addEventListener('click',   () => doExport('matrix.csv'));
  document.getElementById('exportRatings').addEventListener('click',  () => doExport('ratings.csv'));
  document.getElementById('exportRankings').addEventListener('click', () => doExport('rankings.csv'));

  // Export buttons (tab)
  document.getElementById('exportMatrix2').addEventListener('click',   () => doExport('matrix.csv'));
  document.getElementById('exportRatings2').addEventListener('click',  () => doExport('ratings.csv'));
  document.getElementById('exportRankings2').addEventListener('click', () => doExport('rankings.csv'));

  // Modal close
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Settings
  document.getElementById('saveCriteriaBtn').addEventListener('click', handleSaveCriteria);
  document.getElementById('addAxisBtn').addEventListener('click', handleAddAxis);
  document.getElementById('removeAxisBtn').addEventListener('click', handleRemoveAxis);
  document.getElementById('bulkNamesBtn').addEventListener('click', handleBulkNames);
  document.getElementById('printCodesBtn').addEventListener('click', handlePrintCodes);
  document.getElementById('copyAllCodesBtn').addEventListener('click', handleCopyAllCodes);
  loadTeamCodes();
  loadPairNames();
  loadNewSessionForm();
  loadCriteria();
}

async function doExport(filename) {
  const res = await authFetch(`/api/export/${filename}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Matrix ──────────────────────────────────────────────────────── */
let db_pairLabels = {};
let matrixData = null;
let matrixView = 'combined';

function renderMatrix(data) {
  matrixData = data;
  const { groups, group1Teams, group2Teams, cells } = data;

  // Build pair label lookup for modal
  db_pairLabels = {};
  for (const p of group1Teams) db_pairLabels[p.id] = p.label;
  for (const p of group2Teams) db_pairLabels[p.id] = p.label;

  // Store group names for split view labels
  matrixData._g1Name = groups[0]?.name || 'Group 1';
  matrixData._g2Name = groups[1]?.name || 'Group 2';

  // Bind toggle events (once)
  if (!renderMatrix._bound) {
    renderMatrix._bound = true;
    document.getElementById('matrixToggle').addEventListener('click', e => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      document.querySelectorAll('#matrixToggle .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      matrixView = btn.dataset.view;
      if (matrixData) paintMatrixCells(matrixData);
    });
  }

  paintMatrixCells(data);

  document.getElementById('matrixUpdated').textContent =
    `Last loaded: ${new Date().toLocaleTimeString()}`;
}

function paintMatrixCells({ group1Teams, group2Teams, cells, _g1Name, _g2Name }) {
  const headerRow = document.getElementById('matrixHeader');
  const tbody     = document.getElementById('matrixBody');

  // Header
  headerRow.innerHTML = '<th></th>';
  for (const p of group2Teams) {
    const th = document.createElement('th');
    th.textContent = p.label;
    headerRow.appendChild(th);
  }

  // Rows
  tbody.innerHTML = '';
  for (const g1 of group1Teams) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.textContent = g1.label;
    tr.appendChild(rowHeader);

    for (const g2 of group2Teams) {
      const td   = document.createElement('td');
      const cell = cells[g1.id]?.[g2.id];

      if (!cell) {
        td.className = 'cell-empty';
        td.textContent = '—';
      } else if (matrixView === 'split') {
        // Show both scores stacked
        td.className = 'cell-score cell-split';
        td.title = `${g1.label} × ${g2.label} — click for details`;

        const g1Val = cell.g1Avg != null ? cell.g1Avg.toFixed(1) : '—';
        const g2Val = cell.g2Avg != null ? cell.g2Avg.toFixed(1) : '—';
        const g1Class = cell.g1Avg != null ? (cell.g1Avg >= 4 ? 'split-high' : cell.g1Avg >= 3 ? 'split-mid' : 'split-low') : 'split-none';
        const g2Class = cell.g2Avg != null ? (cell.g2Avg >= 4 ? 'split-high' : cell.g2Avg >= 3 ? 'split-mid' : 'split-low') : 'split-none';

        td.innerHTML = `<span class="split-score ${g1Class}" title="${escHtml(_g1Name)} gave">${g1Val}</span><span class="split-score ${g2Class}" title="${escHtml(_g2Name)} gave">${g2Val}</span>`;
        td.addEventListener('click', () => showCellModal(g1.label, g2.label, cell));
      } else {
        const avg = cell.average;
        td.className = `cell-score ${avg >= 4 ? 'cell-high' : avg >= 3 ? 'cell-mid' : 'cell-low'}`;
        td.textContent = avg.toFixed(2);
        td.title = `${g1.label} × ${g2.label} — click for details`;
        td.addEventListener('click', () => showCellModal(g1.label, g2.label, cell));
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

/* ── Cell modal ──────────────────────────────────────────────────── */
function showCellModal(label1, label2, cell) {
  document.getElementById('modalTitle').textContent = `${label1} × ${label2}`;

  const avg  = cell.average;
  const avgEl = document.getElementById('modalAvg');
  avgEl.textContent = `Average: ${avg.toFixed(2)} / 5`;
  avgEl.style.color = avg >= 4 ? 'var(--success)' : avg >= 3 ? 'var(--amber)' : 'var(--error)';

  const container = document.getElementById('modalDetails');
  container.innerHTML = '';

  // Build a lookup of pair labels
  const allPairs = db_pairLabels || {};

  for (const d of cell.details) {
    const div = document.createElement('div');
    div.className = 'rating-detail';

    const scores = d.scores || {};
    const vals = Object.values(scores);
    const rowAvg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '—';

    const raterLabel = allPairs[d.rater] || d.rater;
    const ratedLabel = allPairs[d.rated] || d.rated;

    let scoresHtml = '';
    for (let i = 0; i < currentCriteria.length; i++) {
      const axisKey = `axis${i}`;
      const val = scores[axisKey];
      const name = currentCriteria[i]?.name || `Axis ${i + 1}`;
      scoresHtml += `<div class="score-item"><span>${escHtml(name)}: </span><span>${val != null ? val + '/5' : '—'}</span></div>`;
    }

    div.innerHTML = `
      <div class="detail-header">${escHtml(raterLabel)} rated ${escHtml(ratedLabel)} &mdash; avg ${rowAvg}</div>
      <div class="scores">${scoresHtml}</div>
      ${d.notes ? `<div class="notes">"${escHtml(d.notes)}"</div>` : ''}
    `;
    container.appendChild(div);
  }

  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
}

/* ── Matches ─────────────────────────────────────────────────────── */
async function loadMatches() {
  const res  = await authFetch('/api/dashboard/rankings');
  const data = await res.json();

  renderMutual(data.mutual);
  renderOneSided(data.oneSided);
}

function renderMutual(mutual) {
  const el = document.getElementById('mutualList');
  if (!mutual.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;">No mutual matches yet.</p>';
    return;
  }
  el.innerHTML = '';
  for (const m of mutual) {
    const isBoth1 = m.rank1 === 1 && m.rank2 === 1;
    const div = document.createElement('div');
    div.className = `match-item ${isBoth1 ? 'mutual-1' : 'mutual'}`;
    div.innerHTML = `
      <div>
        <div class="match-pairs">${m.team1} &harr; ${m.team2}</div>
        <div class="match-ranks">${m.team1} ranked #${m.rank1} &bull; ${m.team2} ranked #${m.rank2}</div>
      </div>
      <span class="match-badge ${isBoth1 ? 'badge-mutual-1' : 'badge-mutual'}">
        ${isBoth1 ? 'Mutual #1' : 'Mutual'}
      </span>
    `;
    el.appendChild(div);
  }
}

function renderOneSided(oneSided) {
  const el = document.getElementById('oneSidedList');
  if (!oneSided.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem;">No data yet.</p>';
    return;
  }
  el.innerHTML = '';
  for (const m of oneSided) {
    const div = document.createElement('div');
    div.className = 'match-item one-sided';
    div.innerHTML = `
      <div>
        <div class="match-pairs">${m.team1} &rarr; ${m.team2}</div>
        <div class="match-ranks">${m.team1} ranked #${m.rank1} &bull; ${m.team2HasRanked ? `${m.team2} hasn't ranked them` : `${m.team2} hasn't submitted`}</div>
      </div>
      <span class="match-badge badge-one-side">One-sided</span>
    `;
    el.appendChild(div);
  }
}

/* ── Progress ────────────────────────────────────────────────────── */
async function loadProgress() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();
  sessionGroups = data.groups || sessionGroups;
  renderProgress(data);
}

function renderProgress({ groups, pairs, ratingCounts, rankingsSubmitted }) {
  const container = document.getElementById('progressSection');
  container.innerHTML = '';

  for (const g of groups) {
    const groupTeams = pairs.filter(p => p.cohort === g.key);

    const h3 = document.createElement('h3');
    h3.className = 'progress-section';
    h3.textContent = `${g.name} — Submissions`;
    container.appendChild(h3);

    const wrap  = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const table = document.createElement('table');
    table.className = 'progress-table';

    const thead = table.createTHead();
    const hrow  = thead.insertRow();
    hrow.insertCell().textContent = 'Team';
    const ratedTh = document.createElement('th');
    ratedTh.textContent = 'Ratings';
    hrow.appendChild(ratedTh);
    const rankTh = document.createElement('th');
    rankTh.textContent = 'Ranking';
    hrow.appendChild(rankTh);

    const tbody = table.createTBody();
    for (const p of groupTeams) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = p.label;

      const countTd = tr.insertCell();
      const count = ratingCounts[p.id] || 0;
      countTd.innerHTML = count > 0
        ? `<span class="dot-done">${count} submitted</span>`
        : '<span class="dot-empty">None yet</span>';

      const rankTd = tr.insertCell();
      const ranked = rankingsSubmitted.includes(p.id);
      rankTd.innerHTML = ranked
        ? '<span class="rank-done">Done</span>'
        : '<span class="rank-no">—</span>';
    }

    wrap.appendChild(table);
    container.appendChild(wrap);
  }
}

/* ── Team Codes tab ───────────────────────────────────────────── */
async function loadTeamCodes() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();
  const grid = document.getElementById('teamCodesGrid');
  grid.innerHTML = '';

  // Also populate bulk names columns in settings
  const bulkCols = document.getElementById('bulkNamesCols');
  bulkCols.innerHTML = '';

  for (const g of data.groups) {
    const groupTeams = data.pairs.filter(p => p.cohort === g.key);

    // Team codes section
    const h4 = document.createElement('h4');
    h4.textContent = g.name;
    h4.className = 'pair-group-label';
    grid.appendChild(h4);

    for (const p of groupTeams) {
      const row = document.createElement('div');
      row.className = 'team-code-row';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'team-code-label';
      labelSpan.textContent = p.label;

      const codeSpan = document.createElement('span');
      codeSpan.className = 'team-code-value';
      codeSpan.textContent = p.code;
      codeSpan.title = 'Click to copy';
      codeSpan.addEventListener('click', () => {
        navigator.clipboard.writeText(p.code);
        codeSpan.textContent = 'Copied!';
        setTimeout(() => { codeSpan.textContent = p.code; }, 1500);
      });

      row.appendChild(labelSpan);
      row.appendChild(codeSpan);
      grid.appendChild(row);
    }

    // Bulk names column
    const col = document.createElement('div');
    col.className = 'bulk-names-col';
    col.innerHTML = `
      <label>${escHtml(g.name)}</label>
      <textarea data-group="${g.key}" rows="8" placeholder="Name 1&#10;Name 2&#10;..."></textarea>
    `;
    bulkCols.appendChild(col);
  }
}

/* ── Settings: Print / Copy Codes ─────────────────────────────── */
async function handlePrintCodes() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Team Codes</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
  h1 { font-size: 18px; margin-bottom: 16px; text-align: center; }
  h2 { font-size: 14px; margin: 16px 0 8px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
  .codes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .code-card {
    border: 2px dashed #ccc; border-radius: 8px; padding: 12px 16px;
    display: flex; justify-content: space-between; align-items: center;
    page-break-inside: avoid;
  }
  .code-card .label { font-size: 13px; color: #333; }
  .code-card .code { font-family: 'SF Mono', 'Consolas', monospace; font-size: 22px; font-weight: 700; letter-spacing: 3px; color: #000; }
  @media print {
    body { padding: 10px; }
    .code-card { border: 2px dashed #999; }
  }
</style>
</head><body>
<h1>Creating Connections — Team Codes</h1>`;

  for (const g of data.groups) {
    const groupTeams = data.pairs.filter(p => p.cohort === g.key);
    html += `<h2>${escHtml(g.name)}</h2><div class="codes-grid">`;
    for (const p of groupTeams) {
      html += `<div class="code-card"><span class="label">${escHtml(p.label)}</span><span class="code">${escHtml(p.code)}</span></div>`;
    }
    html += `</div>`;
  }

  html += `</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

async function handleCopyAllCodes() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();

  let text = '';
  for (const g of data.groups) {
    const groupTeams = data.pairs.filter(p => p.cohort === g.key);
    text += `${g.name}\n${'─'.repeat(30)}\n`;
    for (const p of groupTeams) {
      text += `${p.label.padEnd(20)} ${p.code}\n`;
    }
    text += '\n';
  }

  await navigator.clipboard.writeText(text.trim());
  const btn = document.getElementById('copyAllCodesBtn');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy All Codes'; }, 2000);
}

/* ── Settings: Bulk Names ──────────────────────────────────────── */
async function handleBulkNames() {
  const textareas = document.querySelectorAll('#bulkNamesCols textarea');
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();

  let updated = 0;
  const updates = [];

  for (const ta of textareas) {
    const groupKey = ta.dataset.group;
    const names = ta.value.trim().split('\n').filter(n => n.trim());
    const groupTeams = data.pairs.filter(p => p.cohort === groupKey);

    for (let i = 0; i < names.length && i < groupTeams.length; i++) {
      updates.push({ pairId: groupTeams[i].id, label: names[i].trim().slice(0, 30) });
    }
  }

  for (const u of updates) {
    try {
      const r = await fetch('/api/dashboard/pair/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
        body: JSON.stringify(u),
      });
      const d = await r.json();
      if (d.success) updated++;
    } catch { /* skip */ }
  }

  alert(`${updated} team name${updated !== 1 ? 's' : ''} updated.`);
  loadPairNames();
  loadTeamCodes();
}

/* ── Settings: Team Names ───────────────────────────────────────── */
async function loadPairNames() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();
  const grid = document.getElementById('pairNamesGrid');
  grid.innerHTML = '';

  for (const g of data.groups) {
    const groupTeams = data.pairs.filter(p => p.cohort === g.key);

    const h4 = document.createElement('h4');
    h4.textContent = g.name;
    h4.className = 'pair-group-label';
    grid.appendChild(h4);

    for (const p of groupTeams) {
      const row = document.createElement('div');
      row.className = 'pair-name-row';

      const idSpan = document.createElement('span');
      idSpan.className = 'pair-name-id';
      idSpan.textContent = p.code;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pair-name-input';
      input.value = p.label;
      input.maxLength = 30;
      input.dataset.pairId = p.id;

      const status = document.createElement('span');
      status.className = 'pair-name-status';

      input.addEventListener('change', async () => {
        const newLabel = input.value.trim();
        if (!newLabel) { input.value = p.label; return; }
        try {
          const r = await fetch('/api/dashboard/pair/label', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
            body: JSON.stringify({ pairId: p.id, label: newLabel }),
          });
          const d = await r.json();
          if (d.success) {
            status.textContent = 'Saved';
            status.className = 'pair-name-status saved';
            setTimeout(() => { status.textContent = ''; status.className = 'pair-name-status'; }, 2000);
          }
        } catch {
          status.textContent = 'Error';
          status.className = 'pair-name-status error';
        }
      });

      row.appendChild(idSpan);
      row.appendChild(input);
      row.appendChild(status);
      grid.appendChild(row);
    }
  }
}

/* ── Settings: New Session ──────────────────────────────────────── */
function loadNewSessionForm() {
  const form = document.getElementById('newSessionForm');
  const groups = sessionGroups.length ? sessionGroups : [
    { key: 'group1', name: 'Group A', count: 10 },
    { key: 'group2', name: 'Group B', count: 10 },
  ];

  form.innerHTML = '';
  for (let i = 0; i < 2; i++) {
    const g = groups[i] || { name: `Group ${String.fromCharCode(65 + i)}`, count: 10 };
    const div = document.createElement('div');
    div.className = 'session-field';
    div.innerHTML = `
      <label>Group ${i + 1} name</label>
      <input type="text" class="session-group-name" data-idx="${i}" value="${escHtml(g.name)}" maxlength="30">
      <label style="margin-top:6px;">Number of teams</label>
      <input type="number" class="session-group-count" data-idx="${i}" min="1" max="30" value="${g.count}">
    `;
    form.appendChild(div);
  }

  const btn = document.createElement('button');
  btn.className = 'btn-submit btn-danger';
  btn.id = 'newSessionBtn';
  btn.textContent = 'Reset & Start New Session';
  btn.addEventListener('click', handleNewSession);
  form.appendChild(btn);
}

async function handleNewSession() {
  const names  = document.querySelectorAll('.session-group-name');
  const counts = document.querySelectorAll('.session-group-count');

  const groups = [];
  for (let i = 0; i < 2; i++) {
    groups.push({
      name:  names[i]?.value.trim() || `Group ${String.fromCharCode(65 + i)}`,
      count: parseInt(counts[i]?.value, 10) || 10,
    });
  }

  const total = groups.reduce((s, g) => s + g.count, 0);
  if (!confirm(`This will delete ALL ratings and rankings and create ${total} teams (${groups[0].name}: ${groups[0].count}, ${groups[1].name}: ${groups[1].count}). Continue?`)) {
    return;
  }

  try {
    const res = await fetch('/api/dashboard/new-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
      body: JSON.stringify({ groups }),
    });
    const data = await res.json();
    if (data.success) {
      alert('New session created. Refreshing…');
      window.location.reload();
    } else {
      alert('Error: ' + (data.error || 'Unknown'));
    }
  } catch {
    alert('Network error');
  }
}

/* ── Settings: Criteria ──────────────────────────────────────────── */
const AXIS_COLORS = [
  'var(--accent-teal)', 'var(--accent-purple)', 'var(--accent-sky)',
  '#e87461', '#f5a623', '#7ec8e3', '#b8d86b', '#c49bde',
];

async function loadCriteria() {
  const res  = await fetch('/api/criteria');
  const criteria = await res.json();
  currentCriteria = criteria;
  renderCriteriaEditor(criteria);
}

function renderCriteriaEditor(criteria) {
  const editor = document.getElementById('criteriaEditor');
  editor.innerHTML = '';

  criteria.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'criteria-row';
    div.innerHTML = `
      <div class="criteria-field">
        <label style="color:${AXIS_COLORS[i % AXIS_COLORS.length]}">Axis ${i + 1}: Name</label>
        <input type="text" class="criteria-input" data-idx="${i}" data-prop="name" value="${escHtml(c.name)}" maxlength="30">
      </div>
      <div class="criteria-field">
        <label>Low label (1)</label>
        <input type="text" class="criteria-input" data-idx="${i}" data-prop="lowLabel" value="${escHtml(c.lowLabel)}" maxlength="30">
      </div>
      <div class="criteria-field">
        <label>High label (5)</label>
        <input type="text" class="criteria-input" data-idx="${i}" data-prop="highLabel" value="${escHtml(c.highLabel)}" maxlength="30">
      </div>
    `;
    editor.appendChild(div);
  });

  // Update button states
  updateAxisButtons(criteria.length);
}

function updateAxisButtons(count) {
  const addBtn = document.getElementById('addAxisBtn');
  const removeBtn = document.getElementById('removeAxisBtn');
  if (addBtn) addBtn.disabled = count >= 8;
  if (removeBtn) removeBtn.disabled = count <= 2;
}

function handleAddAxis() {
  const criteria = collectCriteriaFromEditor();
  if (criteria.length >= 8) return;
  criteria.push({ name: '', lowLabel: '', highLabel: '' });
  renderCriteriaEditor(criteria);
}

function handleRemoveAxis() {
  const criteria = collectCriteriaFromEditor();
  if (criteria.length <= 2) return;
  criteria.pop();
  renderCriteriaEditor(criteria);
}

function collectCriteriaFromEditor() {
  const inputs = document.querySelectorAll('.criteria-input');
  const criteria = [];
  inputs.forEach(inp => {
    const idx  = parseInt(inp.dataset.idx, 10);
    const prop = inp.dataset.prop;
    if (!criteria[idx]) criteria[idx] = {};
    criteria[idx][prop] = inp.value.trim();
  });
  return criteria;
}

async function handleSaveCriteria() {
  const criteria = collectCriteriaFromEditor();

  if (criteria.length < 2 || criteria.length > 8) {
    alert('You need between 2 and 8 axes.');
    return;
  }

  try {
    const res = await fetch('/api/dashboard/criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
      body: JSON.stringify({ criteria }),
    });
    const data = await res.json();
    if (data.success) {
      currentCriteria = data.criteria || criteria;
      alert('Criteria saved. Students will see updated labels on next page load.');
    } else {
      alert('Error: ' + (data.error || 'Unknown'));
    }
  } catch {
    alert('Network error');
  }
}

/* ── Util ────────────────────────────────────────────────────────── */
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
