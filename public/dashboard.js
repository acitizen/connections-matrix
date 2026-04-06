/* ── State ────────────────────────────────────────────────────────────── */
let currentUser   = null;
let allSessions   = [];
let activeSession = null;
let activeView    = 'overview';

/* ── Init ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/auth/me');
  if (!res.ok) { window.location.href = '/login'; return; }
  currentUser = await res.json();

  const userLabel = `${currentUser.username}${currentUser.role === 'admin' ? ' · Admin' : ''}`;
  document.getElementById('sessionsUserLabel').textContent = userLabel;
  document.getElementById('sidebarUserLabel').textContent  = userLabel;

  if (currentUser.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  bindGlobalEvents();
  await loadSessions();
  showLayer('sessions');
});

/* ── Global event bindings ────────────────────────────────────────────── */
function bindGlobalEvents() {
  document.getElementById('sessionsLogout').addEventListener('click', doLogout);
  document.getElementById('detailLogout').addEventListener('click', doLogout);
  document.getElementById('backToSessions').addEventListener('click', () => showLayer('sessions'));
  document.getElementById('newSessionBtn').addEventListener('click', openNewSessionModal);
  document.getElementById('newSessionClose').addEventListener('click', closeNewSessionModal);
  document.getElementById('newSessionModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewSessionModal();
  });
  document.getElementById('nsCreate').addEventListener('click', handleCreateSession);

  document.querySelectorAll('#sidebarNav .nav-item, .sidebar-secondary .nav-item').forEach(btn => {
    btn.addEventListener('click', () => { if (activeSession) switchView(btn.dataset.view); });
  });

  document.getElementById('modalClose').addEventListener('click', () => closeModal('modalOverlay'));
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalOverlay');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal('modalOverlay'); closeNewSessionModal(); }
  });


  document.getElementById('archivedToggle').addEventListener('click', () => {
    const list = document.getElementById('archivedSessionsList');
    const btn  = document.getElementById('archivedToggle');
    const open = list.style.display === 'none';
    list.style.display  = open ? '' : 'none';
    btn.textContent     = (open ? '▾' : '▸') + ' Archived sessions';
  });
}

/* ── Auth ─────────────────────────────────────────────────────────────── */
async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

/* ── Sessions list ────────────────────────────────────────────────────── */
async function loadSessions() {
  const res = await fetch('/api/sessions');
  if (!res.ok) return;
  allSessions = await res.json();
  renderSessionList();
}

function renderSessionList() {
  const active   = allSessions.filter(s => s.status === 'active');
  const archived = allSessions.filter(s => s.status === 'archived');

  const activeEl   = document.getElementById('activeSessionsList');
  const archivedEl = document.getElementById('archivedSessionsList');

  activeEl.innerHTML = active.length
    ? active.map(sessionCard).join('')
    : '<p class="empty-state">No active sessions. Create one to get started.</p>';
  archivedEl.innerHTML = archived.map(sessionCard).join('');
  document.getElementById('archivedSessionsSection').style.display = archived.length ? '' : 'none';

  [activeEl, archivedEl].forEach(el => {
    el.querySelectorAll('.session-card').forEach(card => {
      card.addEventListener('click', () => openSession(parseInt(card.dataset.id, 10)));
    });
  });
}

function sessionCard(s) {
  const stats    = s.stats || {};
  const creator  = s.creator_username || '';
  const statLine = stats.totalPairs
    ? `${stats.ratingsSubmitted} ratings · ${stats.totalPairs} students`
    : 'No students yet';
  return `
    <div class="session-card ${s.status === 'archived' ? 'archived' : ''}" data-id="${s.id}">
      <div class="session-card-top">
        <span class="session-card-name">${esc(s.name)}</span>
      </div>
      <div class="session-card-meta">
        ${currentUser.role === 'admin' && creator ? `<span>${esc(creator)}</span> · ` : ''}${statLine}
      </div>
      ${s.status === 'archived' ? '<div class="session-archived-badge">Archived</div>' : ''}
    </div>`;
}

/* ── Open session ─────────────────────────────────────────────────────── */
async function openSession(id) {
  const s = allSessions.find(x => x.id === id);
  if (!s) return;
  activeSession = s;

  document.getElementById('sidebarName').textContent = s.name;
  document.getElementById('sidebarStatus').textContent = s.status === 'archived' ? 'Archived' : 'Active';
  document.getElementById('sidebarStatus').className  = 'session-status-badge ' + s.status;

  showLayer('detail');
  switchView('overview');
}

/* ── Layer switching ──────────────────────────────────────────────────── */
function showLayer(layer) {
  document.getElementById('view-sessions').style.display = layer === 'sessions' ? '' : 'none';
  document.getElementById('view-detail').style.display   = layer === 'detail'   ? 'flex' : 'none';
  if (layer === 'sessions') { activeSession = null; loadSessions(); }
}

/* ── View switching ───────────────────────────────────────────────────── */
function switchView(view) {
  activeView = view;
  document.querySelectorAll('#sidebarNav .nav-item, .sidebar-secondary .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const content = document.getElementById('dashContent');
  content.innerHTML = '<div class="loading-spinner"></div>';

  const views = { overview: renderOverview, matrix: renderMatrix,
                  codes: renderCodes, setup: renderSetup, exports: renderExports, users: renderUsers };
  (views[view] || (() => { content.innerHTML = '<p>View not found.</p>'; }))();
}

/* ── Overview ─────────────────────────────────────────────────────────── */
async function renderOverview() {
  const res      = await fetch(`/api/sessions/${activeSession.id}/progress`);
  const progress = await res.json();
  const s        = activeSession;
  const groups   = progress.groups || [];
  const pairs    = progress.pairs  || [];
  const g1Key    = groups[0]?.key || 'group1';
  const g2Pairs  = pairs.filter(p => p.cohort !== g1Key);
  const g1Pairs  = pairs.filter(p => p.cohort === g1Key);

  const totalRatings = pairs.reduce((n, p) => n + (progress.ratingCounts[p.id] || 0), 0);

  document.getElementById('dashContent').innerHTML = `
    <div class="view-header">
      <h2>${esc(s.name)}</h2>
    </div>

    <div class="stats-row">
      <div class="stat-card"><div class="stat-value">${pairs.length}</div><div class="stat-label">Students</div></div>
      <div class="stat-card"><div class="stat-value">${totalRatings}</div><div class="stat-label">Ratings</div></div>
    </div>

    <div class="section-header"><h3>Submission progress</h3></div>
    <div class="progress-cols">
      ${groups.map(g => {
        const gPairs = pairs.filter(p => p.cohort === g.key);
        const max    = pairs.filter(p => p.cohort !== g.key).length;
        return `
          <div>
            <div class="progress-group-label">${esc(g.name)}</div>
            ${gPairs.map(p => {
              const count  = progress.ratingCounts[p.id] || 0;
              const pct    = max ? Math.round(count / max * 100) : 0;
              return `
                <div class="progress-row">
                  <span class="progress-team">${esc(p.label !== p.id ? p.label : p.code)}</span>
                  <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
                  <span class="progress-count">${count}/${max}</span>
                </div>`;
            }).join('')}
          </div>`;
      }).join('')}
    </div>

    <div class="section-header" style="margin-top:32px;"><h3>Session actions</h3></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${s.status !== 'archived'
        ? `<button class="btn-submit btn-sm" id="archiveBtn">Archive session</button>
           <button class="btn-submit btn-sm btn-secondary" id="duplicateBtn">Duplicate config</button>`
        : `<button class="btn-submit btn-sm" id="unarchiveBtn">Restore session</button>`}
      <button class="btn-submit btn-sm btn-danger" id="deleteSessionBtn">Delete session</button>
    </div>
  `;

  document.getElementById('archiveBtn')?.addEventListener('click', () => handleArchive(true));
  document.getElementById('unarchiveBtn')?.addEventListener('click', () => handleArchive(false));
  document.getElementById('duplicateBtn')?.addEventListener('click', handleDuplicate);
  document.getElementById('deleteSessionBtn')?.addEventListener('click', handleDeleteSession);
}

async function handleArchive(archive) {
  if (!confirm(`${archive ? 'Archive' : 'Restore'} this session?`)) return;
  const res = await fetch(`/api/sessions/${activeSession.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: archive ? 'archived' : 'active' }),
  });
  if (res.ok) {
    activeSession.status = archive ? 'archived' : 'active';
    document.getElementById('sidebarStatus').textContent = archive ? 'Archived' : 'Active';
    document.getElementById('sidebarStatus').className   = 'session-status-badge ' + activeSession.status;
    switchView('overview');
  }
}

async function handleDuplicate() {
  const name = prompt('Name for the new session:', `${activeSession.name} (copy)`);
  if (!name) return;
  const res = await fetch(`/api/sessions/${activeSession.id}/duplicate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.ok) { allSessions.unshift(await res.json()); showLayer('sessions'); }
}

async function handleDeleteSession() {
  if (!confirm(`Delete "${activeSession.name}"? This permanently deletes all data.`)) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  const res = await fetch(`/api/sessions/${activeSession.id}`, { method: 'DELETE' });
  if (res.ok) showLayer('sessions');
}

/* ── Matrix ───────────────────────────────────────────────────────────── */
async function renderMatrix() {
  const res  = await fetch(`/api/sessions/${activeSession.id}/matrix`);
  const data = await res.json();
  const { groups, criteria, group1Teams: g1, group2Teams: g2, cells } = data;
  const g1Name = esc(groups[0]?.name || 'Group 1');
  const g2Name = esc(groups[1]?.name || 'Group 2');
  let view = 'combined';

  function buildTable() {
    const tbody = g1.map(r => {
      const tds = g2.map(c => {
        const cell = cells[r.id]?.[c.id];
        if (!cell) return `<td class="cell-empty" data-r="${r.id}" data-c="${c.id}">—</td>`;

        if (view === 'split') {
          const g1Val = cell.g1Avg != null ? cell.g1Avg.toFixed(1) : '—';
          const g2Val = cell.g2Avg != null ? cell.g2Avg.toFixed(1) : '—';
          const g1Cls = cell.g1Avg != null ? (cell.g1Avg >= 4 ? 'split-high' : cell.g1Avg >= 3 ? 'split-mid' : 'split-low') : 'split-none';
          const g2Cls = cell.g2Avg != null ? (cell.g2Avg >= 4 ? 'split-high' : cell.g2Avg >= 3 ? 'split-mid' : 'split-low') : 'split-none';
          return `<td class="cell-score cell-split" data-r="${r.id}" data-c="${c.id}" title="${esc(r.label)} × ${esc(c.label)}"><span class="split-score ${g1Cls}" title="${g1Name} gave">${g1Val}</span><span class="split-score ${g2Cls}" title="${g2Name} gave">${g2Val}</span></td>`;
        }

        const val = cell.average;
        if (val == null) return `<td class="cell-empty" data-r="${r.id}" data-c="${c.id}">—</td>`;
        const cls = val >= 4 ? 'high' : val >= 3 ? 'mid' : 'low';
        return `<td class="cell-score cell-${cls}" data-r="${r.id}" data-c="${c.id}">${val.toFixed(1)}</td>`;
      }).join('');
      return `<tr><th class="matrix-row-head">${esc(r.label)}</th>${tds}</tr>`;
    }).join('');
    return `<thead><tr><th></th>${g2.map(c => `<th class="matrix-col-head">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${tbody}</tbody>`;
  }

  const content = document.getElementById('dashContent');
  content.innerHTML = `
    <div class="view-header"><h2>Compatibility Matrix</h2></div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
      <div class="matrix-toggle" id="matrixToggle">
        <button class="toggle-btn active" data-v="combined">Combined</button>
        <button class="toggle-btn" data-v="split">Split by Group</button>
      </div>
      <span style="font-size:.8rem;color:var(--text-muted);">Click a cell for details.</span>
      <span>
        <span class="legend-pill high">≥ 4.0</span>
        <span class="legend-pill mid">3.0–3.9</span>
        <span class="legend-pill low">&lt; 3.0</span>
      </span>
    </div>
    <div class="matrix-wrap"><table class="matrix-table" id="matrixTable">${buildTable()}</table></div>`;

  content.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      view = btn.dataset.v;
      content.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('matrixTable').innerHTML = buildTable();
      bindCells();
    });
  });
  bindCells();

  function bindCells() {
    document.querySelectorAll('.cell-score').forEach(td => {
      td.addEventListener('click', () => {
        const cell = cells[td.dataset.r]?.[td.dataset.c];
        const r    = g1.find(t => t.id === td.dataset.r);
        const c    = g2.find(t => t.id === td.dataset.c);
        if (cell && r && c) openCellModal(r, c, cell, groups, criteria);
      });
    });
  }
}

function openCellModal(r, c, cell, groups, criteria) {
  document.getElementById('modalTitle').textContent = `${r.label} × ${c.label}`;
  document.getElementById('modalAvg').innerHTML =
    `Combined: <span style="color:var(--accent-sky)">${cell.average?.toFixed(2)}</span>` +
    (cell.g1Avg != null ? `&nbsp;&nbsp;${esc(groups[0]?.name || 'G1')} gave: ${cell.g1Avg.toFixed(2)}` : '') +
    (cell.g2Avg != null ? `&nbsp;&nbsp;${esc(groups[1]?.name || 'G2')} gave: ${cell.g2Avg.toFixed(2)}` : '');

  document.getElementById('modalDetails').innerHTML = (cell.details || []).map(d => {
    const chips = (criteria || []).map((cr, i) => {
      const v = d.scores?.[`axis${i}`];
      return v != null ? `<span class="score-chip">${esc(cr.name)}: ${v}</span>` : '';
    }).join('');
    const time = d.timestamp ? new Date(d.timestamp).toLocaleString() : '';
    return `
      <div class="detail-row">
        <div class="detail-header"><strong>${esc(d.rater)} → ${esc(d.rated)}</strong><span class="detail-time">${time}</span></div>
        <div class="score-chips">${chips}</div>
        ${d.notes ? `<div class="detail-notes">${esc(d.notes)}</div>` : ''}
      </div>`;
  }).join('');
  openModal('modalOverlay');
}

/* ── Progress ─────────────────────────────────────────────────────────── */
async function renderProgress() {
  const res    = await fetch(`/api/sessions/${activeSession.id}/progress`);
  const data   = await res.json();
  const groups = data.groups || [];
  const pairs  = data.pairs  || [];

  document.getElementById('dashContent').innerHTML = `
    <div class="view-header"><h2>Submission Tracker</h2></div>
    <div class="progress-cols">
      ${groups.map(g => {
        const gPairs = pairs.filter(p => p.cohort === g.key);
        const max    = pairs.filter(p => p.cohort !== g.key).length;
        return `
          <div>
            <div class="progress-group-label">${esc(g.name)}</div>
            <table class="progress-table">
              <thead><tr><th>Name</th><th>Code</th><th>Ratings</th></tr></thead>
              <tbody>
                ${gPairs.map(p => {
                  const count  = data.ratingCounts[p.id] || 0;
                  return `<tr>
                    <td>${esc(p.label !== p.id ? p.label : '—')}</td>
                    <td><code>${esc(p.code || '—')}</code></td>
                    <td class="${count >= max ? 'progress-done' : ''}">${count}/${max}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      }).join('')}
    </div>`;
}

/* ── Codes ────────────────────────────────────────────────────────────── */
async function renderCodes() {
  const pairsRes = await fetch(`/api/sessions/${activeSession.id}/pairs`);
  const pairsData = await pairsRes.json();
  const groups    = Object.entries(pairsData.groups || {});
  const allPairs  = groups.flatMap(([k, g]) => g.teams.map(t => ({ ...t, groupKey: k, groupName: g.name })));

  document.getElementById('dashContent').innerHTML = `
    <div class="view-header"><h2>Student Codes</h2></div>
    <p style="margin-bottom:12px;">Each student enters their unique code to join. Click a code to copy it.</p>
    <div style="display:flex;gap:8px;margin-bottom:16px;">
      <button class="btn-submit btn-sm btn-secondary" id="copyAllCodesBtn">Copy all codes</button>
      <button class="btn-submit btn-sm btn-secondary" id="printCodesBtn">Print codes</button>
    </div>
    <div class="team-codes-grid">
      ${groups.map(([k, g]) => `
        <div>
          <div class="codes-group-label">${esc(g.name)}</div>
          ${g.teams.map(t => `
            <div class="code-chip" data-code="${esc(t.code)}" title="Click to copy">
              <span class="code-chip-name">${esc(t.label !== t.id ? t.label : '—')}</span>
              <span class="code-chip-code">${esc(t.code)}</span>
              <span class="code-chip-copy">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </span>
              <span class="code-chip-tick" style="display:none;">Copied!</span>
            </div>`).join('')}
        </div>`).join('')}
    </div>
  `;

  // Code chips
  document.querySelectorAll('.code-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      navigator.clipboard.writeText(chip.dataset.code);
      chip.classList.add('copied');
      const copyIcon = chip.querySelector('.code-chip-copy');
      const tick = chip.querySelector('.code-chip-tick');
      if (copyIcon) copyIcon.style.display = 'none';
      if (tick) tick.style.display = 'inline';
      setTimeout(() => {
        chip.classList.remove('copied');
        if (copyIcon) copyIcon.style.display = '';
        if (tick) tick.style.display = 'none';
      }, 1200);
    });
  });

  document.getElementById('copyAllCodesBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(allPairs.map(p => `${p.label !== p.id ? p.label : p.id}: ${p.code}`).join('\n'));
  });

  document.getElementById('printCodesBtn').addEventListener('click', () => {
    const sessionName = esc(activeSession.name);
    const cards = groups.map(([k, g]) =>
      g.teams.map(t => {
        const name = t.label !== t.id ? esc(t.label) : '';
        return `<div class="print-card">
          <div class="print-card-session">${sessionName}</div>
          ${name ? `<div class="print-card-name">${name}</div>` : ''}
          <div class="print-card-code">${esc(t.code)}</div>
          <div class="print-card-group">${esc(g.name)}</div>
          <div class="print-card-url">creatingconnections.site</div>
        </div>`;
      }).join('')
    ).join('');

    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>Student Codes — ${sessionName}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      .subtitle { font-size: 13px; color: #666; margin-bottom: 16px; }
      .print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .print-card {
        border: 2px solid #222; border-radius: 10px; padding: 16px 12px;
        text-align: center; page-break-inside: avoid;
      }
      .print-card-session { font-size: 11px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
      .print-card-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
      .print-card-code { font-size: 32px; font-weight: 800; letter-spacing: 3px; font-family: 'SF Mono', 'Consolas', monospace; margin: 8px 0; }
      .print-card-group { font-size: 11px; color: #888; margin-bottom: 4px; }
      .print-card-url { font-size: 10px; color: #aaa; }
      @media print {
        body { padding: 0; }
        .print-grid { gap: 8px; }
        .no-print { display: none; }
      }
    </style></head><body>
      <h1>Student Codes</h1>
      <p class="subtitle">${sessionName} — Cut along the lines and hand out to students</p>
      <div class="print-grid">${cards}</div>
      <script>window.onafterprint = () => window.close(); window.print();<\/script>
    </body></html>`);
    w.document.close();
  });
}

/* ── Setup ────────────────────────────────────────────────────────────── */
async function renderSetup() {
  const [pairsRes, criteriaRes] = await Promise.all([
    fetch(`/api/sessions/${activeSession.id}/pairs`),
    fetch(`/api/sessions/${activeSession.id}/criteria`),
  ]);
  const pairsData = await pairsRes.json();
  const criteria  = await criteriaRes.json();
  const groups    = Object.entries(pairsData.groups || {});
  const allPairs  = groups.flatMap(([k, g]) => g.teams.map(t => ({ ...t, groupKey: k, groupName: g.name })));

  document.getElementById('dashContent').innerHTML = `
    <div class="view-header"><h2>Customise</h2></div>

    <div class="settings-section">
      <h3>Groups</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${groups.map(([k, g]) => `
          <div>
            <div class="field"><label>Name</label><input type="text" class="group-name-input" data-key="${k}" value="${esc(g.name)}" maxlength="30"></div>
            <div class="field"><label>Students per group</label><input type="number" class="group-count-input" data-key="${k}" min="1" max="30" value="${g.teams.length}"></div>
          </div>`).join('')}
      </div>
      <button class="btn-submit btn-sm" id="saveGroupsBtn" style="margin-top:12px;">Save Groups</button>
      <p id="groupsMsg" style="display:none;margin-top:8px;font-size:.85rem;"></p>
    </div>

    <div class="settings-section">
      <h3>Edit Student Names</h3>
      <div class="pair-names-grid">
        ${allPairs.map(p => `
          <div class="pair-name-item">
            <span class="pair-code">${esc(p.code)}</span>
            <input class="pair-name-input" type="text" data-id="${p.id}" value="${esc(p.label !== p.id ? p.label : '')}" placeholder="${esc(p.id)}" maxlength="30">
          </div>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <h3>Bulk Add Names</h3>
      <p>Paste names (one per line) to assign to students in order.</p>
      <div style="display:grid;grid-template-columns:${groups.map(() => '1fr').join(' ')};gap:16px;">
        ${groups.map(([k, g]) => `
          <div>
            <div class="settings-group-label">${esc(g.name)}</div>
            <textarea class="bulk-names-area" data-group="${k}" rows="8" placeholder="${g.teams.map(t => t.id).join('\n')}"></textarea>
          </div>`).join('')}
      </div>
      <button class="btn-submit btn-sm" id="bulkNamesBtn" style="margin-top:12px;">Apply Names</button>
    </div>

    <div class="settings-section">
      <h3>Matrix Criteria</h3>
      <p>Customise compatibility axes (2–8). Changes apply to new ratings only.</p>
      <div id="criteriaEditor" class="criteria-editor">
        ${criteria.map((c, i) => `
          <div class="criteria-card">
            <div class="criteria-card-header">
              <input class="crit-name" type="text" value="${esc(c.name)}" placeholder="e.g. Skills" maxlength="30">
              <button class="btn-remove-crit" title="Remove axis">×</button>
            </div>
            <div class="criteria-card-labels">
              <div class="criteria-label-field">
                <span class="criteria-label-tag">1 =</span>
                <input class="crit-low" type="text" value="${esc(c.lowLabel)}" placeholder="e.g. Overlapping" maxlength="30">
              </div>
              <div class="criteria-label-field">
                <span class="criteria-label-tag">5 =</span>
                <input class="crit-high" type="text" value="${esc(c.highLabel)}" placeholder="e.g. Complementary" maxlength="30">
              </div>
            </div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn-submit btn-sm btn-secondary" id="addAxisBtn">+ Add axis</button>
      </div>
      <button class="btn-submit btn-sm" id="saveCriteriaBtn" style="margin-top:12px;">Save Criteria</button>
      <p id="criteriaMsg" style="display:none;margin-top:8px;font-size:.85rem;"></p>
    </div>
  `;

  // Save groups
  document.getElementById('saveGroupsBtn').addEventListener('click', async () => {
    const msgEl = document.getElementById('groupsMsg');
    const updatedGroups = [];
    document.querySelectorAll('.group-name-input').forEach(input => {
      const key   = input.dataset.key;
      const name  = input.value.trim();
      const count = parseInt(document.querySelector(`.group-count-input[data-key="${key}"]`).value, 10) || 10;
      updatedGroups.push({ name, count });
    });
    const res = await fetch(`/api/sessions/${activeSession.id}/groups`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: updatedGroups }),
    });
    const data = await res.json();
    if (data.success) {
      activeSession.config.groups = data.groups;
      msgEl.textContent = 'Groups updated.';
      msgEl.style.color = 'var(--success)';
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 2000);
      renderSetup();
    } else {
      msgEl.textContent = data.error || 'Error saving.';
      msgEl.style.color = 'var(--error)';
      msgEl.style.display = 'block';
    }
  });

  // Bulk names
  document.getElementById('bulkNamesBtn').addEventListener('click', async () => {
    const labels = [];
    document.querySelectorAll('.bulk-names-area').forEach(ta => {
      const lines  = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
      const gPairs = pairsData.groups[ta.dataset.group]?.teams || [];
      lines.forEach((line, i) => { if (gPairs[i]) labels.push({ pairId: gPairs[i].id, label: line }); });
    });
    if (labels.length) {
      await fetch(`/api/sessions/${activeSession.id}/pairs/bulk-labels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labels }),
      });
      renderSetup();
    }
  });

  // Individual pair labels
  document.querySelectorAll('.pair-name-input').forEach(input => {
    input.addEventListener('change', async () => {
      const label = input.value.trim();
      if (!label) return;
      await fetch(`/api/sessions/${activeSession.id}/pairs/${input.dataset.id}/label`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
      });
    });
  });

  // Remove criteria row
  function bindRemoveCrit() {
    document.querySelectorAll('.btn-remove-crit').forEach(btn => {
      btn.onclick = () => {
        if (document.querySelectorAll('#criteriaEditor .criteria-card').length <= 2) return;
        btn.closest('.criteria-card').remove();
      };
    });
  }
  bindRemoveCrit();

  document.getElementById('addAxisBtn').addEventListener('click', () => {
    const editor = document.getElementById('criteriaEditor');
    if (editor.querySelectorAll('.criteria-card').length >= 8) return;
    const card = document.createElement('div');
    card.className = 'criteria-card';
    card.innerHTML = `
      <div class="criteria-card-header">
        <input class="crit-name" type="text" value="" placeholder="e.g. Skills" maxlength="30">
        <button class="btn-remove-crit" title="Remove axis">×</button>
      </div>
      <div class="criteria-card-labels">
        <div class="criteria-label-field">
          <span class="criteria-label-tag">1 =</span>
          <input class="crit-low" type="text" value="" placeholder="e.g. Low" maxlength="30">
        </div>
        <div class="criteria-label-field">
          <span class="criteria-label-tag">5 =</span>
          <input class="crit-high" type="text" value="" placeholder="e.g. High" maxlength="30">
        </div>
      </div>`;
    card.querySelector('.btn-remove-crit').onclick = () => card.remove();
    editor.appendChild(card);
  });


  document.getElementById('saveCriteriaBtn').addEventListener('click', async () => {
    const crit = Array.from(document.querySelectorAll('#criteriaEditor .criteria-card')).map(card => ({
      name:      card.querySelector('.crit-name').value.trim(),
      lowLabel:  card.querySelector('.crit-low').value.trim(),
      highLabel: card.querySelector('.crit-high').value.trim(),
    })).filter(c => c.name);
    const res = await fetch(`/api/sessions/${activeSession.id}/criteria`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ criteria: crit }),
    });
    const msg = document.getElementById('criteriaMsg');
    msg.textContent = res.ok ? 'Criteria saved.' : 'Error saving criteria.';
    msg.style.cssText = `display:block;color:${res.ok ? 'var(--success)' : 'var(--error)'}`;
    setTimeout(() => { msg.style.display = 'none'; }, 2500);
  });
}

/* ── Exports ──────────────────────────────────────────────────────────── */
function renderExports() {
  const sid = activeSession.id;
  document.getElementById('dashContent').innerHTML = `
    <div class="view-header"><h2>Exports</h2></div>
    <p style="color:var(--text-muted);margin-bottom:20px;">Download session data as CSV files.</p>
    <div style="display:flex;flex-direction:column;gap:12px;max-width:340px;">
      <button class="btn-submit" data-url="/api/sessions/${sid}/export/matrix.csv">Download Compatibility Matrix</button>
      <button class="btn-submit btn-secondary" data-url="/api/sessions/${sid}/export/ratings.csv">Download All Ratings</button>
    </div>`;

  document.querySelectorAll('#dashContent button[data-url]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res  = await fetch(btn.dataset.url);
      if (!res.ok) return;
      const blob = await res.blob();
      const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: btn.dataset.url.split('/').pop(),
      });
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });
}

/* ── Users (admin only) ───────────────────────────────────────────────── */
async function renderUsers() {
  if (currentUser.role !== 'admin') {
    document.getElementById('dashContent').innerHTML = '<p>Admin access required.</p>';
    return;
  }
  const res   = await fetch('/api/users');
  const users = await res.json();

  document.getElementById('dashContent').innerHTML = `
    <div class="view-header"><h2>Users</h2></div>

    <div class="settings-section">
      <h3>Accounts</h3>
      <table class="users-table">
        <thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${esc(u.username)}</td>
              <td>${esc(u.role)}</td>
              <td style="display:flex;gap:6px;">
                <button class="btn-sm btn-secondary reset-pw-btn" data-uid="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>Reset pw</button>
                ${u.id !== currentUser.id ? `<button class="btn-sm btn-danger delete-user-btn" data-uid="${u.id}">Delete</button>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="settings-section">
      <h3>Add account</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:480px;">
        <div class="field"><label>Username</label><input id="newUsername" type="text" maxlength="40" autocapitalize="none"></div>
        <div class="field"><label>Password</label><input id="newPassword" type="password" autocomplete="new-password"></div>
        <div class="field"><label>Role</label>
          <select id="newRole"><option value="facilitator">Facilitator</option><option value="admin">Admin</option></select>
        </div>
      </div>
      <p id="addUserError" class="form-error" style="display:none;"></p>
      <button class="btn-submit btn-sm" id="addUserBtn" style="margin-top:8px;">Add Account</button>
    </div>

    <div class="settings-section">
      <h3>Change my password</h3>
      <div style="max-width:320px;">
        <div class="field"><label>Current password</label><input id="curPw" type="password" autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input id="newPw" type="password" autocomplete="new-password"></div>
        <p id="changePwMsg" style="display:none;font-size:.85rem;margin-top:6px;"></p>
        <button class="btn-submit btn-sm" id="changePwBtn" style="margin-top:8px;">Change Password</button>
      </div>
    </div>
  `;

  document.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this account?')) return;
      if ((await fetch(`/api/users/${btn.dataset.uid}`, { method: 'DELETE' })).ok) renderUsers();
    });
  });

  document.querySelectorAll('.reset-pw-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pw = prompt('New password (min 6 characters):');
      if (!pw) return;
      const r = await fetch(`/api/users/${btn.dataset.uid}/password`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }),
      });
      if (r.ok) alert('Password updated.');
      else { const d = await r.json(); alert(d.error || 'Error'); }
    });
  });

  document.getElementById('addUserBtn').addEventListener('click', async () => {
    const errorEl = document.getElementById('addUserError');
    errorEl.style.display = 'none';
    const r = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username:    document.getElementById('newUsername').value.trim(),
        password:    document.getElementById('newPassword').value,
        role:        document.getElementById('newRole').value,
      }),
    });
    if (r.ok) { renderUsers(); }
    else { const d = await r.json(); errorEl.textContent = d.error || 'Error'; errorEl.style.display = 'block'; }
  });

  document.getElementById('changePwBtn').addEventListener('click', async () => {
    const r = await fetch('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: document.getElementById('curPw').value, newPassword: document.getElementById('newPw').value }),
    });
    const d   = await r.json();
    const msg = document.getElementById('changePwMsg');
    msg.textContent = r.ok ? 'Password changed.' : (d.error || 'Error');
    msg.style.cssText = `display:block;color:${r.ok ? 'var(--success)' : 'var(--error)'}`;
  });
}

/* ── New session modal ────────────────────────────────────────────────── */
function openNewSessionModal() {
  document.getElementById('nsError').style.display = 'none';
  openModal('newSessionModal');
}
function closeNewSessionModal() { closeModal('newSessionModal'); }

async function handleCreateSession() {
  const name    = document.getElementById('nsName').value.trim();
  const errorEl = document.getElementById('nsError');
  if (!name) { errorEl.textContent = 'Session name required.'; errorEl.style.display = 'block'; return; }

  const btn = document.getElementById('nsCreate');
  btn.disabled = true;

  const res = await fetch('/api/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      groups: [
        { name: document.getElementById('nsG1Name').value.trim() || 'Group A', count: parseInt(document.getElementById('nsG1Count').value, 10) || 10 },
        { name: document.getElementById('nsG2Name').value.trim() || 'Group B', count: parseInt(document.getElementById('nsG2Count').value, 10) || 10 },
      ],
    }),
  });

  btn.disabled = false;
  if (res.ok) {
    const s = await res.json();
    allSessions.unshift(s);
    closeNewSessionModal();
    renderSessionList();
    openSession(s.id);
  } else {
    const d = await res.json();
    errorEl.textContent = d.error || 'Error creating session.';
    errorEl.style.display = 'block';
  }
}

/* ── Modal helpers ────────────────────────────────────────────────────── */
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

/* ── Util ─────────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
