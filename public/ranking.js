/* ── State ───────────────────────────────────────────────────────── */
let pairsData = { sem3: [], sem12: [] };

/* ── Init ────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadPairs();
  restoreYourPair();
  bindEvents();
});

async function loadPairs() {
  const res = await fetch('/api/pairs');
  pairsData = await res.json();
  populateYourPair();
}

function populateYourPair() {
  const sel = document.getElementById('yourPair');
  sel.innerHTML = '<option value="">— Select your pair —</option>';

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

function restoreYourPair() {
  const saved = localStorage.getItem('myPairId');
  if (saved) {
    const sel = document.getElementById('yourPair');
    sel.value = saved;
    if (sel.value === saved) populateRankDropdowns(saved);
  }
}

function getOppositePairs(yourPairId) {
  const isSem2 = pairsData.sem3.some(p => p.id === yourPairId);
  return isSem2 ? pairsData.sem12 : pairsData.sem3;
}

function populateRankDropdowns(yourPairId) {
  const opposite = getOppositePairs(yourPairId);
  const selects  = ['rank1', 'rank2', 'rank3'];

  for (const id of selects) {
    const sel = document.getElementById(id);
    sel.disabled = false;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Select —</option>';
    for (const p of opposite) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  filterDuplicates();
}

/* Disable already-selected options in sibling dropdowns */
function filterDuplicates() {
  const ids    = ['rank1', 'rank2', 'rank3'];
  const values = ids.map(id => document.getElementById(id).value).filter(Boolean);

  for (const id of ids) {
    const sel = document.getElementById(id);
    const own = sel.value;
    for (const opt of sel.options) {
      if (!opt.value) continue;
      opt.disabled = values.includes(opt.value) && opt.value !== own;
    }
  }
}

/* ── Events ──────────────────────────────────────────────────────── */
function bindEvents() {
  document.getElementById('yourPair').addEventListener('change', e => {
    const val = e.target.value;
    if (val) {
      localStorage.setItem('myPairId', val);
      populateRankDropdowns(val);
    } else {
      ['rank1', 'rank2', 'rank3'].forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="">— Select your pair first —</option>';
        sel.disabled = true;
      });
    }
  });

  ['rank1', 'rank2', 'rank3'].forEach(id => {
    document.getElementById(id).addEventListener('change', filterDuplicates);
  });

  document.getElementById('rankingForm').addEventListener('submit', handleSubmit);
}

/* ── Submit ──────────────────────────────────────────────────────── */
async function handleSubmit(e) {
  e.preventDefault();

  const pair  = document.getElementById('yourPair').value;
  const rank1 = document.getElementById('rank1').value;
  const rank2 = document.getElementById('rank2').value;
  const rank3 = document.getElementById('rank3').value;

  if (!pair)  return showBanner('Please select your pair ID.', 'error');
  if (!rank1) return showBanner('Please select your 1st preference.', 'error');
  if (!rank2) return showBanner('Please select your 2nd preference.', 'error');
  if (!rank3) return showBanner('Please select your 3rd preference.', 'error');

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/ranking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair, rank1, rank2, rank3 }),
    });
    const data = await res.json();

    if (data.success) {
      showBanner('Preferences submitted! You\'re all done.', 'success');
      btn.textContent = 'Submitted';
    } else {
      showBanner(data.error || 'Something went wrong.', 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Ranking';
    }
  } catch {
    showBanner('Network error — please try again.', 'error');
    btn.disabled = false;
    btn.textContent = 'Submit Ranking';
  }
}

/* ── Banner ──────────────────────────────────────────────────────── */
function showBanner(msg, type) {
  const el = document.getElementById('banner');
  el.textContent = msg;
  el.className = `banner show ${type}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (type === 'error') setTimeout(() => el.classList.remove('show'), 4000);
}
