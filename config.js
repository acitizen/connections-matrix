const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(__dirname, 'session.json');

const DEFAULT_GROUPS = [
  { key: 'group1', name: 'Group A', count: 10 },
  { key: 'group2', name: 'Group B', count: 10 },
];

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return { groups: DEFAULT_GROUPS };
  }
}

function saveSession(session) {
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
}

function buildPairs(groups) {
  const pairs = [];
  for (const g of groups) {
    for (let i = 1; i <= g.count; i++) {
      const num = String(i).padStart(2, '0');
      const id = `${g.key}-${num}`;
      pairs.push({ id, cohort: g.key, label: id });
    }
  }
  return pairs;
}

// Generate default pairs from session config
const session = loadSession();
const PAIRS = buildPairs(session.groups);

module.exports = { PAIRS, DEFAULT_GROUPS, loadSession, saveSession, buildPairs };
