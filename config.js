// Pair configuration — edit here to adjust pair IDs and counts
const PAIRS = [];

// Semester 3 pairs
for (let i = 1; i <= 10; i++) {
  const id = `S3-${String(i).padStart(2, '0')}`;
  PAIRS.push({ id, cohort: 'sem3', label: id });
}

// Semester 1 & 2 pairs
for (let i = 1; i <= 10; i++) {
  const id = `S1-${String(i).padStart(2, '0')}`;
  PAIRS.push({ id, cohort: 'sem12', label: id });
}

module.exports = { PAIRS };
