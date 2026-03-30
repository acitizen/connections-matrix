/* ── Auth ────────────────────────────────────────────────────────── */
let adminPassword = localStorage.getItem('adminPassword') || '';

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
  document.getElementById('newSessionBtn').addEventListener('click', handleNewSession);
  document.getElementById('saveCriteriaBtn').addEventListener('click', handleSaveCriteria);
  loadPairNames();
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
function renderMatrix({ sem3Pairs, sem12Pairs, cells }) {
  const headerRow = document.getElementById('matrixHeader');
  const tbody     = document.getElementById('matrixBody');

  // Header
  headerRow.innerHTML = '<th></th>';
  for (const p of sem12Pairs) {
    const th = document.createElement('th');
    th.textContent = p.label;
    headerRow.appendChild(th);
  }

  // Rows
  tbody.innerHTML = '';
  for (const s2 of sem3Pairs) {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.textContent = s2.label;
    tr.appendChild(rowHeader);

    for (const s1 of sem12Pairs) {
      const td   = document.createElement('td');
      const cell = cells[s2.id]?.[s1.id];

      if (!cell) {
        td.className = 'cell-empty';
        td.textContent = '—';
      } else {
        const avg = cell.average;
        td.className = `cell-score ${avg >= 4 ? 'cell-high' : avg >= 3 ? 'cell-mid' : 'cell-low'}`;
        td.textContent = avg.toFixed(2);
        td.title = `${s2.label} × ${s1.label} — click for details`;
        td.addEventListener('click', () => showCellModal(s2.label, s1.label, cell));
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  document.getElementById('matrixUpdated').textContent =
    `Last loaded: ${new Date().toLocaleTimeString()}`;
}

/* ── Cell modal ──────────────────────────────────────────────────── */
function showCellModal(s2Label, s1Label, cell) {
  document.getElementById('modalTitle').textContent = `${s2Label} × ${s1Label}`;

  const avg  = cell.average;
  const avgEl = document.getElementById('modalAvg');
  avgEl.textContent = `Average: ${avg.toFixed(2)} / 5`;
  avgEl.style.color = avg >= 4 ? 'var(--success)' : avg >= 3 ? 'var(--amber)' : 'var(--error)';

  const container = document.getElementById('modalDetails');
  container.innerHTML = '';

  for (const d of cell.details) {
    const div = document.createElement('div');
    div.className = 'rating-detail';
    const rowAvg = ((d.skillComp + d.projectAlign + d.commFit) / 3).toFixed(2);
    div.innerHTML = `
      <div class="detail-header">${d.rater} rated ${d.rated} &mdash; Round ${d.round} &mdash; avg ${rowAvg}</div>
      <div class="scores">
        <div class="score-item"><span>Skill: </span><span>${d.skillComp}/5</span></div>
        <div class="score-item"><span>Project: </span><span>${d.projectAlign}/5</span></div>
        <div class="score-item"><span>Comms: </span><span>${d.commFit}/5</span></div>
      </div>
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
    const isBoth1 = m.sem3Rank === 1 && m.sem12Rank === 1;
    const div = document.createElement('div');
    div.className = `match-item ${isBoth1 ? 'mutual-1' : 'mutual'}`;
    div.innerHTML = `
      <div>
        <div class="match-pairs">${m.sem3} &harr; ${m.sem12}</div>
        <div class="match-ranks">${m.sem3} ranked #${m.sem3Rank} &bull; ${m.sem12} ranked #${m.sem12Rank}</div>
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
        <div class="match-pairs">${m.sem3} &rarr; ${m.sem12}</div>
        <div class="match-ranks">${m.sem3} ranked #${m.sem3Rank} &bull; ${m.sem12HasRanked ? `${m.sem12} hasn't ranked them` : `${m.sem12} hasn't submitted`}</div>
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
  renderProgress(data);
}

function renderProgress({ pairs, ratingsByPair, rankingsSubmitted }) {
  const container = document.getElementById('progressSection');
  container.innerHTML = '';

  const sem3  = pairs.filter(p => p.cohort === 'sem3');
  const sem12 = pairs.filter(p => p.cohort === 'sem12');
  const rounds = [1,2,3,4,5,6,7,8,9,10];

  for (const [groupLabel, group] of [['Semester 3', sem3], ['Semester 1 & 2', sem12]]) {
    const h3 = document.createElement('h3');
    h3.className = 'progress-section';
    h3.textContent = `${groupLabel} — round ratings`;
    container.appendChild(h3);

    const wrap  = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const table = document.createElement('table');
    table.className = 'progress-table';

    const thead = table.createTHead();
    const hrow  = thead.insertRow();
    hrow.insertCell().textContent = 'Pair';
    for (const r of rounds) {
      const th = document.createElement('th');
      th.textContent = `R${r}`;
      hrow.appendChild(th);
    }
    const rankTh = document.createElement('th');
    rankTh.textContent = 'Ranking';
    hrow.appendChild(rankTh);

    const tbody = table.createTBody();
    for (const p of group) {
      const tr  = tbody.insertRow();
      tr.insertCell().textContent = p.label;
      for (const r of rounds) {
        const td   = tr.insertCell();
        const done = ratingsByPair[p.id]?.[r]?.length > 0;
        td.innerHTML = done
          ? '<span class="dot-done">&#10003;</span>'
          : '<span class="dot-empty">&#8729;</span>';
      }
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

/* ── Settings: Pair Names ────────────────────────────────────────── */
async function loadPairNames() {
  const res  = await authFetch('/api/dashboard/progress');
  const data = await res.json();
  const grid = document.getElementById('pairNamesGrid');
  grid.innerHTML = '';

  const sem3  = data.pairs.filter(p => p.cohort === 'sem3');
  const sem12 = data.pairs.filter(p => p.cohort === 'sem12');

  for (const [groupLabel, group] of [['Semester 3', sem3], ['Semester 1 & 2', sem12]]) {
    const h4 = document.createElement('h4');
    h4.textContent = groupLabel;
    h4.className = 'pair-group-label';
    grid.appendChild(h4);

    for (const p of group) {
      const row = document.createElement('div');
      row.className = 'pair-name-row';

      const idSpan = document.createElement('span');
      idSpan.className = 'pair-name-id';
      idSpan.textContent = p.id;

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

/* ── Settings: New Session ───────────────────────────────────────── */
async function handleNewSession() {
  const numSem3  = parseInt(document.getElementById('numSem3').value, 10);
  const numSem12 = parseInt(document.getElementById('numSem12').value, 10);

  if (!confirm(`This will delete ALL ratings and rankings and create ${numSem3} Sem 3 + ${numSem12} Sem 1&2 pairs. Continue?`)) {
    return;
  }

  try {
    const res = await fetch('/api/dashboard/new-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
      body: JSON.stringify({ numSem3, numSem12 }),
    });
    const data = await res.json();
    if (data.success) {
      alert(`New session created: ${data.sem3} Sem 3 pairs + ${data.sem12} Sem 1&2 pairs. Refreshing…`);
      window.location.reload();
    } else {
      alert('Error: ' + (data.error || 'Unknown'));
    }
  } catch {
    alert('Network error');
  }
}

/* ── Settings: Criteria ──────────────────────────────────────────── */
async function loadCriteria() {
  const res  = await fetch('/api/criteria');
  const criteria = await res.json();
  const editor = document.getElementById('criteriaEditor');
  editor.innerHTML = '';

  const colors = ['var(--accent-teal)', 'var(--accent-purple)', 'var(--accent-sky)'];

  criteria.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'criteria-row';
    div.innerHTML = `
      <div class="criteria-field">
        <label style="color:${colors[i]}">Axis ${i + 1}: Name</label>
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
}

async function handleSaveCriteria() {
  const inputs = document.querySelectorAll('.criteria-input');
  const criteria = [{}, {}, {}];
  inputs.forEach(inp => {
    const idx  = parseInt(inp.dataset.idx, 10);
    const prop = inp.dataset.prop;
    criteria[idx][prop] = inp.value.trim();
  });

  try {
    const res = await fetch('/api/dashboard/criteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminPassword}` },
      body: JSON.stringify({ criteria }),
    });
    const data = await res.json();
    if (data.success) {
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
