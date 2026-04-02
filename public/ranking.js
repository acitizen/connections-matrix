/* ── State ───────────────────────────────────────────────────────── */
let myTeam = null;
let oppositeTeams = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Check saved code
  const savedCode = localStorage.getItem('teamCode');
  if (savedCode) {
    await authenticateCode(savedCode);
  }

  bindCodeEntry();
  bindForm();
});

/* ── Code entry ─────────────────────────────────────────────────── */
function bindCodeEntry() {
  document.getElementById('rankCodeSubmit').addEventListener('click', handleCodeSubmit);
  document.getElementById('rankCodeInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCodeSubmit();
  });
}

async function handleCodeSubmit() {
  const code = document.getElementById('rankCodeInput').value.trim().toUpperCase();
  if (!code) return;

  const ok = await authenticateCode(code);
  if (ok) {
    localStorage.setItem('teamCode', code);
  } else {
    document.getElementById('rankCodeError').style.display = 'block';
  }
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
    myTeam = data.team;
    oppositeTeams = data.oppositeTeams;

    // Show form, hide code gate
    document.getElementById('rankCodeGate').style.display = 'none';
    document.getElementById('rankingForm').style.display = 'block';

    populateRankDropdowns();
    return true;
  } catch {
    return false;
  }
}

function populateRankDropdowns() {
  for (const selId of ['rank1', 'rank2', 'rank3']) {
    const sel = document.getElementById(selId);
    sel.innerHTML = '<option value="">— Select —</option>';
    for (const t of oppositeTeams) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label === t.id ? t.id : t.label;
      sel.appendChild(opt);
    }
  }
}

/* ── Form ────────────────────────────────────────────────────────── */
function bindForm() {
  document.getElementById('rankingForm').addEventListener('submit', async e => {
    e.preventDefault();

    if (!myTeam) return showBanner('Enter your team code first.', 'error');

    const rank1 = document.getElementById('rank1').value;
    const rank2 = document.getElementById('rank2').value;
    const rank3 = document.getElementById('rank3').value;

    if (!rank1 || !rank2 || !rank3) {
      return showBanner('Please select all three preferences.', 'error');
    }
    if (new Set([rank1, rank2, rank3]).size < 3) {
      return showBanner('Each preference must be a different team.', 'error');
    }

    try {
      const res = await fetch('/api/ranking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair: myTeam.id, rank1, rank2, rank3 }),
      });
      const data = await res.json();
      if (data.success) {
        showBanner('Ranking submitted!', 'success');
        document.getElementById('submitBtn').textContent = 'Update Ranking';
      } else {
        showBanner(data.error || 'Error submitting.', 'error');
      }
    } catch {
      showBanner('Network error.', 'error');
    }
  });
}

/* ── Banner ──────────────────────────────────────────────────────── */
function showBanner(msg, type) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner ${type} show`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'banner'; }, 3500);
}
