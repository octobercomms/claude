// Content-quality scorer — turns Claude's per-factor E‑E‑A‑T + CITE grades
// into a deterministic, rubric-weighted overall grade and publish verdict.
//
// Same split as the Strategist's ad-audit: the rubric (categories, weights,
// grade bands) is the fixed spine; Claude supplies the qualitative per-factor
// judgement; this module does the deterministic aggregation so two runs on the
// same grades produce the same overall grade. Pure — no DB, no Claude, no
// network — so it's trivially testable. Methodology mined (MIT) from
// AgriciDaniel/claude-seo + seranking/seo-skills.

const rubric = require('../data/contentAuditRubric.json');

// Normalise a Claude-returned letter grade (e.g. "b+", "A ", "c") to a 0–1
// score via the rubric's grade_scores table. Unknown/blank → null (excluded
// from the weighted average, exactly like an 'na' finding in adAudit).
function gradeToScore(grade) {
  if (!grade) return null;
  const key = String(grade).trim().toUpperCase();
  const table = rubric.grade_scores || {};
  if (key in table) return table[key];
  // Tolerate a bare letter when a +/- variant was returned but not tabled.
  const bare = key[0];
  return bare in table ? table[bare] : null;
}

function bandFor(bands, score, field) {
  // bands are sorted high→low by `min`; first match wins.
  for (const b of bands) if (score >= b.min) return b[field];
  return bands[bands.length - 1][field];
}

// factors: { experience, expertise, authoritativeness, trust, cite } where each
// value is a letter grade string (or { grade } object). Returns the weighted
// overall + per-category breakdown.
function scoreContent(factors = {}) {
  const get = (id) => {
    const v = factors[id];
    if (v == null) return null;
    return typeof v === 'object' ? v.grade : v;
  };

  const categories = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const cat of rubric.categories) {
    const letter = get(cat.id);
    const score = gradeToScore(letter);
    if (score != null) {
      weightedSum += score * cat.weight;
      weightTotal += cat.weight;
    }
    categories.push({
      id: cat.id,
      label: cat.label,
      weight: cat.weight,
      grade: letter ? String(letter).trim().toUpperCase() : null,
      score,
    });
  }

  // No gradeable factors at all — signal "unknown" rather than a false F.
  if (weightTotal === 0) {
    return { score: null, grade: null, verdict: null, categories };
  }

  const score100 = Math.round((weightedSum / weightTotal) * 100);
  return {
    score: score100,
    grade: bandFor(rubric.grade_bands, score100, 'grade'),
    verdict: bandFor(rubric.verdict_bands, score100, 'verdict'),
    categories,
  };
}

module.exports = { scoreContent, gradeToScore };
