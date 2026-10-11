// classify.js — sort saved questions into MOE learning objectives (v1.5.0).
//
// The AI server does the sorting (mode 'classify'). When it cannot be reached
// a keyword match stands in, so every question still gets an objective.

import { SYL_LOS, SYL_LO_BY_ID } from './syllabus.js?v=1.5.1';
import { classifyQuestions } from './ai.js?v=1.5.1';

export const CLASSIFY_BATCH = 20;
const MIN_SCORE = 2;

const STOP = new Set(('a an the of and or to in on for with by is are was were be as at from that this ' +
  'these those it its into using use up than then how many much what which who each more less one two ' +
  'involving including given numbers number problems problem solving 1-step 2-step word step').split(' '));

function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(w => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1'));
}

// Extra cue words a P3 question uses for a sub-strand without naming it.
const CUES = {
  'Money': ['$', 'cent', 'dollar', 'cost', 'spent', 'price', 'change'],
  'Measurement': ['cm', 'km', 'kg', 'litre', 'ml', 'length', 'mass', 'volume', 'metre'],
  'Time': ['minute', 'hour', 'clock', 'a.m', 'p.m', 'second'],
  'Fractions': ['fraction', '/', 'numerator', 'denominator', 'half', 'quarter'],
  'Geometry': ['angle', 'line', 'shape', 'triangle', 'square', 'rectangle'],
  'Area and Volume': ['area', 'perimeter', 'square unit'],
  'Data Analysis': ['graph', 'table', 'chart', 'bar graph'],
};

const LO_WORDS = SYL_LOS.map(lo => ({ lo, set: new Set(words(lo.text + ' ' + lo.topic + ' ' + lo.sub)) }));

/** Best learning objective by word overlap, or [] when nothing is close. Prefers P3. */
export function keywordClassify(text, level = 'P3') {
  const qw = new Set(words(text));
  const raw = String(text || '').toLowerCase();
  let best = null; let bestScore = 0;
  for (const { lo, set } of LO_WORDS) {
    let score = 0;
    for (const w of qw) if (set.has(w)) score += 1;
    for (const cue of CUES[lo.sub] || []) if (raw.includes(cue)) score += 0.75;
    if (lo.level === level) score += 0.6;
    if (score > bestScore) { bestScore = score; best = lo; }
  }
  return best && bestScore >= MIN_SCORE ? [best.id] : [];
}

/** The words that describe a block: question text plus options. */
export function blockText(b) {
  return [b.questionText || ''].concat(b.options || []).join('\n').slice(0, 3000);
}

export function needsClassify(b) {
  return !!b && !b.losManual && !Array.isArray(b.los);
}

/** Classify up to CLASSIFY_BATCH blocks. Resolves Map(id -> [loId]). Never throws. */
export async function classifyBatch(list, signal) {
  const out = new Map();
  const qs = list.slice(0, CLASSIFY_BATCH).map(b => ({ id: b.id, text: blockText(b) }));
  if (!qs.length) return out;
  try {
    const los = SYL_LOS.map(lo => ({ id: lo.id, text: lo.level + ' ' + lo.text, topic: lo.sub }));
    const items = await classifyQuestions({ questions: qs, los, signal });
    for (const it of items) out.set(it.id, it.los.filter(id => SYL_LO_BY_ID[id]).slice(0, 3));
  } catch (err) {
    if (err && err.cancelled) return out;
    console.warn('Sorting by the AI failed; using the keyword match.', err);
  }
  for (const q of qs) if (!out.has(q.id)) out.set(q.id, keywordClassify(q.text));
  return out;
}
