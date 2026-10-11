// ─────────────────────────────────────────────────────────────────────────
// Picture It — question bank and generator (Singapore Primary 3 maths).
//
// Exports (see the module contract):
//   TOPICS                         [{ id, name, emoji }]
//   generateQuestion(topicId?, difficulty) -> Question
//   nextQuestion(settings)         -> Question (mixes parent questions in)
//   loadParentQuestions()          -> Question[] stored by the parent
//   saveParentQuestions(list)      -> bool
//
// Every generated question:
//   • is built by a small "template" function that picks numbers for one of
//     three tiers (warmup / core / stretch) and writes a Singapore-flavoured
//     word problem around them;
//   • carries a `visual: { kind, params }` for a built-in visualiser, set up
//     to show the STRUCTURE of the problem (the unknown is hidden / "?");
//   • carries a hint that nudges the child to draw before calculating;
//   • lists every sensible way of writing the answer in `answers`
//     ("$12.50" and "12.50", "1/2" and "2/4", "15:45" and "3:45 p.m." …);
//   • is validated before it is returned: the core value must be a whole,
//     non-negative number (cents, minutes, grams …) and every answer string
//     non-empty. A template that fails is simply re-rolled.
// ─────────────────────────────────────────────────────────────────────────
import {
  STORE_KEYS,
  readStore,
  writeStore,
  getSettings,
  uid,
  randomInt,
  pick,
  shuffle,
  formatNumber,
} from './core.js?v=1.4.1';

// ─────────────────────────────────────────────────────────────────────────
// Topics
// ─────────────────────────────────────────────────────────────────────────
export const TOPICS = [
  { id: 'addSub', name: 'Add & subtract to 10 000', emoji: '➕' },
  { id: 'mulDiv', name: 'Times tables 6, 7, 8, 9', emoji: '✖️' },
  { id: 'partWhole', name: 'Part-whole stories', emoji: '🧩' },
  { id: 'comparison', name: 'Comparison stories', emoji: '⚖️' },
  { id: 'multiStep', name: 'Multi-step problems', emoji: '🪜' },
  { id: 'placeValue', name: 'Place value', emoji: '🔢' },
  { id: 'patterns', name: 'Number patterns', emoji: '🔁' },
  { id: 'fractions', name: 'Fractions', emoji: '🍰' },
  { id: 'money', name: 'Money ($ and ¢)', emoji: '💵' },
  { id: 'time', name: 'Time', emoji: '⏰' },
  { id: 'length', name: 'Length (km, m, cm)', emoji: '📏' },
  { id: 'massVolume', name: 'Mass & volume', emoji: '🧃' },
  { id: 'areaPerimeter', name: 'Area & perimeter', emoji: '🟩' },
  { id: 'angles', name: 'Angles', emoji: '📐' },
  { id: 'barGraphs', name: 'Bar graphs', emoji: '📊' },
];

const TOPIC_IDS = TOPICS.map(t => t.id);
const DIFFICULTIES = ['warmup', 'core', 'stretch'];

// ─────────────────────────────────────────────────────────────────────────
// Singapore names and places
// ─────────────────────────────────────────────────────────────────────────
const PEOPLE = [
  { name: 'Ahmad', he: 'he', his: 'his', him: 'him' },
  { name: 'Siti', he: 'she', his: 'her', him: 'her' },
  { name: 'Mei Ling', he: 'she', his: 'her', him: 'her' },
  { name: 'Wei Jie', he: 'he', his: 'his', him: 'him' },
  { name: 'Priya', he: 'she', his: 'her', him: 'her' },
  { name: 'Ravi', he: 'he', his: 'his', him: 'him' },
  { name: 'Nurul', he: 'she', his: 'her', him: 'her' },
  { name: 'Jun Hao', he: 'he', his: 'his', him: 'him' },
  { name: 'Aisyah', he: 'she', his: 'her', him: 'her' },
  { name: 'Kumar', he: 'he', his: 'his', him: 'him' },
  { name: 'Hui Min', he: 'she', his: 'her', him: 'her' },
  { name: 'Farhan', he: 'he', his: 'his', him: 'him' },
  { name: 'Divya', he: 'she', his: 'her', him: 'her' },
  { name: 'Zhi Hao', he: 'he', his: 'his', him: 'him' },
  { name: 'Li Ting', he: 'she', his: 'her', him: 'her' },
  { name: 'Arjun', he: 'he', his: 'his', him: 'him' },
  { name: 'Hafiz', he: 'he', his: 'his', him: 'him' },
  { name: 'Xin Yi', he: 'she', his: 'her', him: 'her' },
  { name: 'Daniel', he: 'he', his: 'his', him: 'him' },
  { name: 'Chloe', he: 'she', his: 'her', him: 'her' },
  { name: 'Irfan', he: 'he', his: 'his', him: 'him' },
  { name: 'Kavya', he: 'she', his: 'her', him: 'her' },
  { name: 'Ethan', he: 'he', his: 'his', him: 'him' },
  { name: 'Shu Fen', he: 'she', his: 'her', him: 'her' },
];

const RELATIVES = ['Mum', 'Dad', 'Grandma', 'Grandpa', 'Auntie Mary', 'Uncle Lim', 'Ah Ma', 'Ah Gong'];

const SHOPS = ['the NTUC FairPrice', 'the school bookshop', 'the Popular bookstore', 'the provision shop',
  'the hawker centre', 'the Sheng Siong supermarket', 'the neighbourhood bakery', 'the school canteen'];

const PLACES = ['Sentosa', 'the Singapore Zoo', 'Gardens by the Bay', 'East Coast Park', 'the Science Centre',
  'Jurong Bird Park', 'the National Library', 'Bukit Timah Nature Reserve', 'the Botanic Gardens', 'Pasir Ris Park'];

const EVENTS = ['the National Day celebration', 'the school carnival', 'Racial Harmony Day',
  'the Children\'s Day concert', 'the Chinese New Year bazaar', 'the Hari Raya open house',
  'the Deepavali light-up', 'the Sports Day'];

// Things that can be counted, with an emoji for equal-group pictures.
const COUNTABLES = [
  { one: 'sticker', many: 'stickers', emoji: '⭐' },
  { one: 'marble', many: 'marbles', emoji: '🔵' },
  { one: 'curry puff', many: 'curry puffs', emoji: '🥟' },
  { one: 'ang ku kueh', many: 'ang ku kueh', emoji: '🍡' },
  { one: 'pineapple tart', many: 'pineapple tarts', emoji: '🍪' },
  { one: 'rambutan', many: 'rambutans', emoji: '🔴' },
  { one: 'durian puff', many: 'durian puffs', emoji: '🧁' },
  { one: 'pencil', many: 'pencils', emoji: '✏️' },
  { one: 'storybook', many: 'storybooks', emoji: '📘' },
  { one: 'orange', many: 'oranges', emoji: '🍊' },
  { one: 'egg tart', many: 'egg tarts', emoji: '🥧' },
  { one: 'kueh lapis', many: 'pieces of kueh lapis', emoji: '🟫' },
  { one: 'satay stick', many: 'satay sticks', emoji: '🍢' },
  { one: 'ketupat', many: 'ketupat', emoji: '🟩' },
  { one: 'muruku', many: 'pieces of muruku', emoji: '🥨' },
  { one: 'Pokémon card', many: 'Pokémon cards', emoji: '🃏' },
];

const CONTAINERS = [
  { one: 'box', many: 'boxes' },
  { one: 'bag', many: 'bags' },
  { one: 'packet', many: 'packets' },
  { one: 'tray', many: 'trays' },
  { one: 'tin', many: 'tins' },
  { one: 'basket', many: 'baskets' },
];

// Things bought at a shop, with typical price ranges in cents (by tier).
const SHOP_ITEMS = [
  { name: 'file', many: 'files', price: [[50, 300], [120, 650], [250, 1250]] },
  { name: 'storybook', many: 'storybooks', price: [[300, 900], [450, 1500], [850, 2450]] },
  { name: 'packet of chicken rice', many: 'packets of chicken rice', price: [[300, 450], [350, 550], [380, 650]] },
  { name: 'bowl of laksa', many: 'bowls of laksa', price: [[350, 500], [400, 650], [450, 750]] },
  { name: 'cup of bubble tea', many: 'cups of bubble tea', price: [[200, 450], [280, 580], [320, 690]] },
  { name: 'box of crayons', many: 'boxes of crayons', price: [[150, 400], [230, 680], [345, 975]] },
  { name: 'water bottle', many: 'water bottles', price: [[300, 800], [490, 1290], [690, 1890]] },
  { name: 'kaya toast set', many: 'kaya toast sets', price: [[250, 450], [320, 560], [380, 680]] },
  { name: 'eraser', many: 'erasers', price: [[30, 100], [45, 150], [60, 220]] },
  { name: 'ice-cream sandwich', many: 'ice-cream sandwiches', price: [[100, 200], [120, 250], [150, 300]] },
];

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────
const R = randomInt;
const fmt = n => formatNumber(n);

function tierOf(difficulty) {
  if (difficulty === 'warmup') return 0;
  if (difficulty === 'stretch') return 2;
  return 1;
}

// tiers(t, a, b, c) -> a, b or c by tier.
function tiers(t, a, b, c) {
  return [a, b, c][Math.max(0, Math.min(2, t))];
}

// [min, max] per tier -> random int in that tier's range.
function inTier(t, ranges) {
  const r = tiers(t, ranges[0], ranges[1], ranges[2]);
  return R(r[0], r[1]);
}

// n distinct people.
function people(n) {
  return shuffle(PEOPLE).slice(0, n);
}

function person() {
  return pick(PEOPLE);
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n, one, many) {
  return n === 1 ? one : (many || one + 's');
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

function digitsOf(n) {
  return String(n).split('').map(Number);
}

// Split a number into place-value jumps for a number line: 2 468 -> [2000, 400, 60, 8].
function placeJumps(n, sign) {
  const s = sign < 0 ? -1 : 1;
  const out = [];
  const d = digitsOf(n);
  d.forEach((digit, i) => {
    const value = digit * Math.pow(10, d.length - 1 - i);
    if (value) out.push(s * value);
  });
  return out.length ? out : [s * n];
}

// Does a + b need regrouping in at least one column?
function addRegroups(a, b) {
  while (a > 0 || b > 0) {
    if ((a % 10) + (b % 10) >= 10) return true;
    a = Math.floor(a / 10); b = Math.floor(b / 10);
  }
  return false;
}

// Does a - b need regrouping (borrowing) in at least one column?
function subRegroups(a, b) {
  while (b > 0) {
    if ((a % 10) < (b % 10)) return true;
    a = Math.floor(a / 10); b = Math.floor(b / 10);
  }
  return false;
}

// Random pair (a, b) with a + b <= max needing regrouping.
function regroupAddPair(t) {
  const spec = tiers(t,
    { a: [120, 680], b: [110, 299], max: 999 },
    { a: [1200, 6800], b: [450, 2999], max: 9999 },
    { a: [2400, 7900], b: [1250, 4999], max: 9999 });
  for (let i = 0; i < 60; i++) {
    const a = R(spec.a[0], spec.a[1]);
    const b = R(spec.b[0], spec.b[1]);
    if (a + b <= spec.max && addRegroups(a, b)) return [a, b];
  }
  return tiers(t, [278, 156], [3468, 1775], [4689, 3557]);
}

// Random pair (a, b) with a - b > 0 needing regrouping.
function regroupSubPair(t) {
  for (let i = 0; i < 80; i++) {
    let a, b;
    if (t === 0) { a = R(300, 999); b = R(105, a - 50); }
    else if (t === 1) { a = R(2000, 9800); b = R(500, a - 200); }
    else {
      // Subtracting across zeros: 5 000, 7 003, 6 040 …
      const th = R(3, 9);
      a = pick([th * 1000, th * 1000 + R(1, 9), th * 1000 + R(1, 9) * 10, th * 1000 + R(1, 9) * 100]);
      b = R(1111, a - 300);
    }
    if (b > 0 && a - b > 0 && subRegroups(a, b)) return [a, b];
  }
  return tiers(t, [632, 278], [5124, 2867], [7000, 2468]);
}

function centsText(c) {
  return '$' + (c / 100).toFixed(2);
}

// Short friendly money text: "$5" for whole dollars, "$4.85" otherwise, "85¢" under a dollar.
function moneyText(c, preferCents) {
  if (preferCents && c < 100) return c + '¢';
  if (c % 100 === 0) return '$' + (c / 100);
  return centsText(c);
}

// 24-hour clock helpers.
function twelveHour(h24, m) {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'a.m.' : 'p.m.';
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

function twentyFour(h24, m) {
  return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function durationText(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

// ─────────────────────────────────────────────────────────────────────────
// Accepted-answer builders
// ─────────────────────────────────────────────────────────────────────────
function intAnswers(n, unit) {
  const out = [String(n), fmt(n)];
  if (unit) out.push(`${n} ${unit}`, `${n}${unit}`);
  return uniq(out);
}

function dollarAnswers(cents) {
  const d = (cents / 100).toFixed(2);
  const out = ['$' + d, d];
  if (cents % 100 === 0) out.push(String(cents / 100), '$' + (cents / 100));
  else out.push(String(Number(d)));
  return uniq(out);
}

function centAnswers(cents) {
  return uniq([String(cents), cents + '¢', cents + ' cents', cents + 'c']);
}

// A fraction n/d (in lowest terms or not) and every equivalent with a
// denominator up to 48. `simplestOnly` accepts just the lowest-terms form.
function fractionAnswers(n, d, simplestOnly) {
  const g = gcd(n, d);
  const sn = n / g, sd = d / g;
  if (sn === 0) return ['0'];
  if (sn === sd) return uniq(['1', '1/1', `${d}/${d}`]);
  if (simplestOnly) return [`${sn}/${sd}`];
  const out = [];
  for (let k = 1; sd * k <= 48; k++) out.push(`${sn * k}/${sd * k}`);
  return uniq(out);
}

function clockAnswers(h24, m) {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m).padStart(2, '0');
  const sfx = h24 < 12 ? ['a.m.', 'am', 'a.m', 'in the morning'] : ['p.m.', 'pm', 'p.m'];
  const out = [];
  for (const s of sfx) { out.push(`${h}:${mm} ${s}`, `${h}.${mm} ${s}`); }
  return uniq(out);
}

function twentyFourAnswers(h24, m) {
  const hh = String(h24).padStart(2, '0'), mm = String(m).padStart(2, '0');
  return uniq([`${hh}:${mm}`, `${hh}${mm}`, `${hh}${mm} h`, `${hh}${mm}h`, `${h24}:${mm}`, `${hh}.${mm}`]);
}

function durationAnswers(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  const out = [];
  if (h && m) {
    out.push(`${h} h ${m} min`, `${h}h ${m}min`, `${h} h ${m} mins`, `${h} hours ${m} minutes`,
      `${h} hour ${m} minutes`, `${h} hr ${m} min`, `${h} hrs ${m} mins`);
  } else if (h) {
    out.push(`${h} h`, `${h} hours`, `${h} hour`, `${h} hr`);
  } else {
    out.push(`${m} min`, `${m} minutes`, String(m));
  }
  return uniq(out);
}

function uniq(list) {
  return Array.from(new Set(list.filter(x => x != null && String(x).trim() !== '').map(String)));
}

// ─────────────────────────────────────────────────────────────────────────
// Visual builders — params exactly as the built-in visualisers expect.
// ─────────────────────────────────────────────────────────────────────────
const V = {
  // parts: [{label, value, hidden?}]; set totalHidden when the WHOLE is the unknown.
  partWhole(parts, totalLabel, unit, totalHidden) {
    const params = { mode: 'part-whole', parts: parts.map(p => ({ label: p.label, value: p.value, hidden: !!p.hidden })), totalLabel: totalLabel || 'total', unit: unit || '' };
    if (totalHidden) params.totalHidden = true;
    return { kind: 'barModel', params };
  },
  // bars: [{label, value, hidden?}] — compare mode reads `bars`; `parts` is kept for the contract.
  compare(bars, unit, totalLabel) {
    const list = bars.map(b => ({ label: b.label, value: b.value, hidden: !!b.hidden }));
    return { kind: 'barModel', params: { mode: 'compare', bars: list, parts: list, totalLabel: totalLabel || '', unit: unit || '' } };
  },
  numberLine(from, jumps) {
    return { kind: 'numberLine', params: { from, jumps: jumps.filter(j => j !== 0) } };
  },
  placeValue(number) {
    return { kind: 'placeValue', params: { number } };
  },
  groups(groups, perGroup, mode, item, total) {
    const params = { groups, perGroup, mode: mode || 'multiply', item: item || '●' };
    if (total != null) params.total = total;
    return { kind: 'equalGroups', params };
  },
  array(rows, cols) {
    return { kind: 'array', params: { rows, cols } };
  },
  fraction(denominator, numerator, compareDen) {
    const params = { denominator };
    if (numerator != null) { params.numerator = numerator; params.shaded = numerator; }
    if (compareDen) params.compare = { denominator: compareDen };
    return { kind: 'fractionBars', params };
  },
  clock(hours, minutes, addMinutes) {
    const add = Math.max(15, Math.min(720, Math.ceil((addMinutes || 60) / 15) * 15));
    return { kind: 'clock', params: { hours, minutes, addMinutes: add } };
  },
  money(amounts, labels) {
    return { kind: 'money', params: { amounts: amounts.slice(0, 3), labels: (labels || []).slice(0, 3) } };
  },
  area(width, height, unit) {
    return { kind: 'areaGrid', params: { width, height, unit: unit || 'cm' } };
  },
  measure(kind, values, unit, labels) {
    const params = { kind, values: values.slice(0, 4), unit };
    if (labels) params.labels = labels.slice(0, 4);
    return { kind: 'measure', params };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Question builder. Templates return:
//   { text, answers, value, unit?, hint, visual, allowZero? }
// `value` is the core whole-number answer in the smallest unit used
// (cents, minutes, grams, ml, cm, or a numerator for fractions) and is what
// validate() checks.
// ─────────────────────────────────────────────────────────────────────────
function validate(q) {
  if (!q || typeof q.text !== 'string' || !q.text.trim()) return false;
  if (!Array.isArray(q.answers) || !q.answers.length) return false;
  if (q.answers.some(a => typeof a !== 'string' || !a.trim())) return false;
  const values = [].concat(q.value);
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return false;
    if (v < 0 || (v === 0 && !q.allowZero)) return false;
    if (v > 10000) return false; // P3 works within 10 000
  }
  if (!q.visual || !q.visual.kind || !q.visual.params) return false;
  if (!visualOk(q.visual)) return false;
  if (/NaN|undefined|Infinity/.test(q.text + q.answers.join('|'))) return false;
  return true;
}

// Sanity checks so a visual never gets nonsense.
function visualOk(v) {
  const p = v.params;
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  switch (v.kind) {
    case 'barModel': {
      const list = p.mode === 'compare' ? p.bars : p.parts;
      return Array.isArray(list) && list.length > 0 && list.every(x => finite(x.value) && x.value >= 0);
    }
    case 'numberLine':
      return finite(p.from) && Array.isArray(p.jumps) && p.jumps.length > 0 && p.jumps.every(finite);
    case 'placeValue':
      return finite(p.number) && p.number >= 0;
    case 'equalGroups':
      return finite(p.groups) && finite(p.perGroup) && p.groups >= 1 && p.perGroup >= 1;
    case 'array':
      return finite(p.rows) && finite(p.cols) && p.rows >= 1 && p.cols >= 1;
    case 'fractionBars':
      return finite(p.denominator) && p.denominator >= 1 && p.denominator <= 12;
    case 'clock':
      return finite(p.hours) && finite(p.minutes) && p.hours >= 0 && p.hours <= 23 && p.minutes >= 0 && p.minutes <= 59;
    case 'money':
      return Array.isArray(p.amounts) && p.amounts.length > 0 && p.amounts.every(a => finite(a) && a > 0);
    case 'areaGrid':
      return finite(p.width) && finite(p.height) && p.width >= 1 && p.width <= 14 && p.height >= 1 && p.height <= 10;
    case 'measure':
      return Array.isArray(p.values) && p.values.length > 0 && p.values.every(a => finite(a) && a > 0);
    default:
      return false;
  }
}

function finish(topic, q) {
  const out = {
    id: uid('gen'),
    source: 'generated',
    topic,
    text: q.text,
    answers: uniq(q.answers),
    hint: q.hint,
    visual: q.visual,
  };
  if (q.unit) out.unit = q.unit;
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. ADDITION & SUBTRACTION WITHIN 10 000 (with regrouping)
// ═════════════════════════════════════════════════════════════════════════
const addSubTemplates = [
  // Bare addition sum on a number line.
  function addPlain(t) {
    const [a, b] = regroupAddPair(t);
    return {
      text: `Find the value of ${fmt(a)} + ${fmt(b)}.`,
      answers: intAnswers(a + b), value: a + b,
      hint: `Start at ${fmt(a)} on the number line and jump on ${fmt(b)} one place at a time — thousands, hundreds, tens, then ones. Watch for a regroup!`,
      visual: V.numberLine(a, placeJumps(b, 1)),
    };
  },
  // Bare subtraction sum on a number line.
  function subPlain(t) {
    const [a, b] = regroupSubPair(t);
    return {
      text: `Find the value of ${fmt(a)} − ${fmt(b)}.`,
      answers: intAnswers(a - b), value: a - b,
      hint: `Start at ${fmt(a)} and jump BACK ${fmt(b)} in place-value steps. Draw each jump before you write the answer.`,
      visual: V.numberLine(a, placeJumps(b, -1)),
    };
  },
  // Library books — total.
  function libraryTotal(t) {
    const [a, b] = regroupAddPair(t);
    const [l1, l2] = pick([['English', 'Chinese'], ['Malay', 'Tamil'], ['fiction', 'non-fiction'], ['comic', 'picture']]);
    return {
      text: `A school library has ${fmt(a)} ${l1} books and ${fmt(b)} ${l2} books. How many books are there altogether?`,
      answers: intAnswers(a + b, 'books'), value: a + b, unit: 'books',
      hint: 'Draw one long bar cut into two parts. Both parts are known — the whole is the "?".',
      visual: V.partWhole([{ label: l1 + ' books', value: a }, { label: l2 + ' books', value: b }], 'books altogether', '', true),
    };
  },
  // Visitors — find the missing part.
  function visitorsPart(t) {
    const [a, b] = regroupSubPair(t);
    const ev = pick(EVENTS);
    const [g1, g2] = pick([['children', 'adults'], ['boys', 'girls'], ['pupils', 'teachers and parents']]);
    return {
      text: `There were ${fmt(a)} people at ${ev}. ${fmt(b)} of them were ${g1}. The rest were ${g2}. How many ${g2} were there?`,
      answers: intAnswers(a - b), value: a - b,
      hint: `Draw a bar for all ${fmt(a)} people. Cut off the ${g1} part. The part left over is the "?".`,
      visual: V.partWhole([{ label: g1, value: b }, { label: g2, value: a - b, hidden: true }], 'people', ''),
    };
  },
  // Missing addend.
  function missingAddend(t) {
    const [b, a] = regroupAddPair(t);
    const total = a + b;
    return {
      text: `What number goes in the box?  □ + ${fmt(a)} = ${fmt(total)}`,
      answers: intAnswers(b), value: b,
      hint: `Draw a bar for ${fmt(total)}. One part is ${fmt(a)}. The box is the other part — so take away!`,
      visual: V.partWhole([{ label: 'box', value: b, hidden: true }, { label: fmt(a), value: a }], fmt(total), ''),
    };
  },
  // Missing subtrahend.
  function missingSubtrahend(t) {
    const [a, b] = regroupSubPair(t);
    return {
      text: `What number goes in the box?  ${fmt(a)} − □ = ${fmt(a - b)}`,
      answers: intAnswers(b), value: b,
      hint: `The whole is ${fmt(a)}. One part, ${fmt(a - b)}, is left behind. Draw the bar — the box is the part that was taken away.`,
      visual: V.partWhole([{ label: 'left', value: a - b }, { label: 'box', value: b, hidden: true }], fmt(a), ''),
    };
  },
  // Points game — adding scores.
  function gameScore(t) {
    const [a, b] = regroupAddPair(t);
    const p = person();
    return {
      text: `${p.name} scored ${fmt(a)} points in the first round of a game and ${fmt(b)} points in the second round. What was ${p.his} total score?`,
      answers: intAnswers(a + b, 'points'), value: a + b, unit: 'points',
      hint: 'Draw a number line. Start at the first score and jump on the second score in thousands, hundreds, tens and ones.',
      visual: V.numberLine(a, placeJumps(b, 1)),
    };
  },
  // Savings — spend then left.
  function stampsLeft(t) {
    const [a, b] = regroupSubPair(t);
    const p = person();
    const item = pick(['stamps', 'beads', 'stickers', 'paper cranes', 'rubber bands']);
    return {
      text: `${p.name} had ${fmt(a)} ${item}. ${cap(p.he)} gave away ${fmt(b)} of them. How many ${item} did ${p.he} have left?`,
      answers: intAnswers(a - b, item), value: a - b, unit: item,
      hint: `Draw a bar for the ${fmt(a)} ${item} ${p.he} started with. Shade the part given away — the rest is "?".`,
      visual: V.partWhole([{ label: 'given away', value: b }, { label: 'left', value: a - b, hidden: true }], item + ' at first', ''),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 2. MULTIPLICATION & DIVISION (6, 7, 8, 9 times tables)
// ═════════════════════════════════════════════════════════════════════════
function tableFact(t) {
  const table = pick([6, 7, 8, 9]);
  const n = tiers(t, R(2, 10), R(3, 12), R(6, 12));
  return { table, n };
}

const mulDivTemplates = [
  // Equal groups — multiply.
  function bagsMultiply(t) {
    const { table, n } = tableFact(t);
    const thing = pick(COUNTABLES), box = pick(CONTAINERS);
    const p = person();
    return {
      text: `${p.name} has ${n} ${plural(n, box.one, box.many)} of ${thing.many}. There are ${table} ${thing.many} in each ${box.one}. How many ${thing.many} does ${p.he} have altogether?`,
      answers: intAnswers(n * table, thing.many), value: n * table, unit: thing.many,
      hint: `Draw ${n} groups with ${table} in each group. Equal groups → multiply.`,
      visual: V.groups(n, table, 'multiply', thing.emoji),
    };
  },
  // Array — rows of chairs.
  function chairsArray(t) {
    const { table, n } = tableFact(t);
    const what = pick([['chairs', 'the school hall'], ['plants', 'the community garden'], ['tables', 'the hawker centre'], ['lanterns', 'the Mid-Autumn festival walk']]);
    return {
      text: `The ${what[0]} in ${what[1]} are arranged in ${n} rows. There are ${table} ${what[0]} in each row. How many ${what[0]} are there?`,
      answers: intAnswers(n * table, what[0]), value: n * table, unit: what[0],
      hint: `Draw an array: ${n} rows, ${table} in each row. Count one row, then count by ${table}s.`,
      visual: V.array(n, table),
    };
  },
  // Sharing — divide.
  function shareDivide(t) {
    const { table, n } = tableFact(t);
    const total = table * n;
    const thing = pick(COUNTABLES);
    const p = person();
    return {
      text: `${p.name} shared ${total} ${thing.many} equally among ${table} friends. How many ${thing.many} did each friend get?`,
      answers: intAnswers(n, thing.many), value: n, unit: thing.many,
      hint: `Draw ${table} circles for the friends. Deal the ${thing.many} out one by one until all ${total} are gone.`,
      visual: V.groups(table, n, 'share', thing.emoji, total),
    };
  },
  // Grouping — how many groups.
  function groupingDivide(t) {
    const { table, n } = tableFact(t);
    const total = table * n;
    const thing = pick(COUNTABLES), box = pick(CONTAINERS);
    return {
      text: `A baker packs ${total} ${thing.many} into ${box.many} of ${table}. How many ${box.many} does the baker need?`,
      answers: intAnswers(n, box.many), value: n, unit: box.many,
      hint: `Circle groups of ${table} until all ${total} are used. Count the circles.`,
      visual: V.groups(n, table, 'divide', thing.emoji, total),
    };
  },
  // Bare multiplication fact (or 2/3-digit × 1-digit for stretch).
  function plainMultiply(t) {
    if (t === 2) {
      const a = R(13, 99), b = pick([6, 7, 8, 9]);
      return {
        text: `Find the value of ${a} × ${b}.`,
        answers: intAnswers(a * b), value: a * b,
        hint: `Think of ${b} jumps of ${a} on a number line. Or split ${a} into tens and ones: ${Math.floor(a / 10) * 10} × ${b} and ${a % 10} × ${b}.`,
        visual: V.numberLine(0, Array(b).fill(a)),
      };
    }
    const { table, n } = tableFact(t);
    return {
      text: `What is ${n} × ${table}?`,
      answers: intAnswers(n * table), value: n * table,
      hint: `Draw ${n} rows of ${table} dots, or skip-count by ${table} ${n} times.`,
      visual: V.array(n, table),
    };
  },
  // Missing factor.
  function missingFactor(t) {
    const { table, n } = tableFact(t);
    return {
      text: `What number goes in the box?  ${table} × □ = ${table * n}`,
      answers: intAnswers(n), value: n,
      hint: `How many jumps of ${table} reach ${table * n}? Draw the jumps on a number line and count them.`,
      visual: V.numberLine(0, Array(n).fill(table)),
    };
  },
  // Remainder — leftovers.
  function leftovers(t) {
    const table = pick([6, 7, 8, 9]);
    const q = tiers(t, R(2, 6), R(3, 9), R(5, 11));
    const r = R(1, table - 1);
    const total = table * q + r;
    const thing = pick(COUNTABLES);
    const p = person();
    const ask = pick(['left', 'groups']);
    if (ask === 'left') {
      return {
        text: `${p.name} puts ${total} ${thing.many} into bags of ${table}. How many ${thing.many} are left over?`,
        answers: intAnswers(r, thing.many), value: r, unit: thing.many,
        hint: `Circle groups of ${table}. The ones that cannot make a full group are the leftovers.`,
        visual: V.groups(q, table, 'divide', thing.emoji, total),
      };
    }
    return {
      text: `${p.name} puts ${total} ${thing.many} into bags of ${table}. How many FULL bags can ${p.he} make?`,
      answers: intAnswers(q, 'bags'), value: q, unit: 'bags',
      hint: `Circle groups of ${table}. Only count the groups that are full.`,
      visual: V.groups(q, table, 'divide', thing.emoji, total),
    };
  },
  // Stretch: 3-digit ÷ 1-digit (exact) word problem.
  function bigDivide(t) {
    const d = pick([6, 7, 8, 9]);
    const q = tiers(t, R(4, 10), R(11, 30), R(25, 110));
    const total = d * q;
    const ev = pick(EVENTS);
    return {
      text: `${fmt(total)} pupils at ${ev} are put into ${d} equal teams. How many pupils are in each team?`,
      answers: intAnswers(q, 'pupils'), value: q, unit: 'pupils',
      hint: `Draw a bar for ${fmt(total)} and cut it into ${d} equal parts. One part is the "?".`,
      visual: V.partWhole(Array.from({ length: d }, (_, i) => ({ label: 'team ' + (i + 1), value: q, hidden: i === 0 })), 'pupils', ''),
    };
  },
  // Cost of several items in whole dollars.
  function costTimes(t) {
    const { table, n } = tableFact(t);
    const item = pick(['a ticket to the Zoo', 'a mooncake', 'a T-shirt', 'a plushie', 'a jigsaw puzzle']);
    const p = person();
    return {
      text: `${item.charAt(0).toUpperCase() + item.slice(1)} costs $${table}. ${p.name} buys ${n} of them. How much does ${p.he} pay?`,
      answers: dollarAnswers(table * n * 100), value: table * n, unit: '$',
      hint: `Draw ${n} equal bars of $${table} side by side. ${n} groups of ${table} → multiply.`,
      visual: V.groups(n, table, 'multiply', '💲'),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 3. PART-WHOLE WORD PROBLEMS (bar model)
// ═════════════════════════════════════════════════════════════════════════
function partWholeNumbers(t) {
  return tiers(t,
    { a: R(120, 480), b: R(105, 450) },
    { a: R(650, 4200), b: R(380, 3900) },
    { a: R(1250, 4800), b: R(980, 3800) });
}

const partWholeTemplates = [
  function hawkerPlates(t) {
    const { a, b } = partWholeNumbers(t);
    const [x, y] = pick([['chicken rice', 'nasi lemak'], ['char kway teow', 'mee goreng'], ['roti prata', 'thosai']]);
    return {
      text: `A hawker sold ${fmt(a)} plates of ${x} and ${fmt(b)} plates of ${y} in a month. How many plates did the hawker sell altogether?`,
      answers: intAnswers(a + b, 'plates'), value: a + b, unit: 'plates',
      hint: 'Draw one bar with two parts — one for each dish. The whole bar is the "?".',
      visual: V.partWhole([{ label: x, value: a }, { label: y, value: b }], 'plates altogether', '', true),
    };
  },
  function boysGirls(t) {
    const { a, b } = partWholeNumbers(t);
    const total = a + b;
    const school = pick(['Rosyth Primary', 'Nan Hua Primary', 'Tampines Primary', 'Ang Mo Kio Primary', 'Jurong West Primary', 'Rulang Primary']);
    return {
      text: `There are ${fmt(total)} pupils in ${school} School. ${fmt(a)} of them are boys. How many girls are there?`,
      answers: intAnswers(b, 'girls'), value: b, unit: 'girls',
      hint: `Draw a bar for all ${fmt(total)} pupils. Mark the boys' part. The girls' part is the "?".`,
      visual: V.partWhole([{ label: 'boys', value: a }, { label: 'girls', value: b, hidden: true }], 'pupils', ''),
    };
  },
  function threeParts(t) {
    const a = tiers(t, R(100, 300), R(400, 2200), R(900, 3000));
    const b = tiers(t, R(100, 300), R(300, 2200), R(800, 3000));
    const c = tiers(t, R(100, 300), R(300, 2200), R(700, 3000));
    const total = a + b + c;
    const ask = t === 0 ? 'total' : pick(['total', 'part']);
    const p = person();
    const days = ['Monday', 'Tuesday', 'Wednesday'];
    if (ask === 'total') {
      return {
        text: `${p.name}'s class folded paper stars for charity. They folded ${fmt(a)} on Monday, ${fmt(b)} on Tuesday and ${fmt(c)} on Wednesday. How many stars did they fold in the 3 days?`,
        answers: intAnswers(total, 'stars'), value: total, unit: 'stars',
        hint: 'Draw one bar with three parts — one for each day. Add the parts to find the whole.',
        visual: V.partWhole(days.map((d, i) => ({ label: d, value: [a, b, c][i] })), 'stars', '', true),
      };
    }
    return {
      text: `${p.name}'s class folded ${fmt(total)} paper stars in 3 days. They folded ${fmt(a)} on Monday and ${fmt(b)} on Tuesday. How many did they fold on Wednesday?`,
      answers: intAnswers(c, 'stars'), value: c, unit: 'stars',
      hint: `Draw one bar for ${fmt(total)} stars, cut into three parts. Two parts are known — find the third.`,
      visual: V.partWhole([{ label: 'Monday', value: a }, { label: 'Tuesday', value: b }, { label: 'Wednesday', value: c, hidden: true }], 'stars', ''),
    };
  },
  function sold(t) {
    const { a, b } = partWholeNumbers(t);
    const total = a + b;
    const item = pick(['durians', 'mangoes', 'eggs', 'buns', 'pineapple tarts']);
    return {
      text: `A shop had ${fmt(total)} ${item}. It sold ${fmt(a)} ${item} in the morning. How many ${item} were not sold in the morning?`,
      answers: intAnswers(b, item), value: b, unit: item,
      hint: `Draw a bar for all ${fmt(total)} ${item}. Mark the part sold. The rest of the bar is "?".`,
      visual: V.partWhole([{ label: 'sold', value: a }, { label: 'not sold', value: b, hidden: true }], item, ''),
    };
  },
  function boughtMore(t) {
    const { a, b } = partWholeNumbers(t);
    const p = person();
    const thing = pick(['beads', 'stickers', 'stamps', 'marbles']);
    return {
      text: `${p.name} had some ${thing}. After ${p.he} bought ${fmt(b)} more ${thing}, ${p.he} had ${fmt(a + b)} ${thing}. How many ${thing} did ${p.he} have at first?`,
      answers: intAnswers(a, thing), value: a, unit: thing,
      hint: `Draw a bar for the ${fmt(a + b)} ${thing} at the end. Mark the ${fmt(b)} that were bought. What is left is how many ${p.he} had at first.`,
      visual: V.partWhole([{ label: 'at first', value: a, hidden: true }, { label: 'bought', value: b }], thing + ' in the end', ''),
    };
  },
  function mrtPassengers(t) {
    const { a, b } = partWholeNumbers(t);
    const total = a + b;
    const station = pick(['Jurong East', 'Tampines', 'Woodlands', 'Bishan', 'Serangoon', 'Raffles Place']);
    return {
      text: `${fmt(total)} people passed through ${station} MRT station in an hour. ${fmt(b)} of them were going home. How many were not going home?`,
      answers: intAnswers(a, 'people'), value: a, unit: 'people',
      hint: `Draw one bar for ${fmt(total)} people. Cut off the ${fmt(b)}. The other part is "?".`,
      visual: V.partWhole([{ label: 'not going home', value: a, hidden: true }, { label: 'going home', value: b }], 'people', ''),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 4. COMPARISON WORD PROBLEMS (bar model, "more than" / "fewer than")
// ═════════════════════════════════════════════════════════════════════════
function compareNumbers(t) {
  return tiers(t,
    { small: R(120, 450), diff: R(25, 280) },
    { small: R(450, 3800), diff: R(150, 2400) },
    { small: R(1200, 4400), diff: R(380, 3100) });
}

const comparisonTemplates = [
  function moreThanFindBig(t) {
    const { small, diff } = compareNumbers(t);
    const [p, q] = people(2);
    const thing = pick(COUNTABLES);
    return {
      text: `${q.name} has ${fmt(small)} ${thing.many}. ${p.name} has ${fmt(diff)} more ${thing.many} than ${q.name}. How many ${thing.many} does ${p.name} have?`,
      answers: intAnswers(small + diff, thing.many), value: small + diff, unit: thing.many,
      hint: `Draw two bars, one above the other. ${p.name}'s bar is the same as ${q.name}'s PLUS an extra ${fmt(diff)}.`,
      visual: V.compare([{ label: p.name, value: small + diff, hidden: true }, { label: q.name, value: small }]),
    };
  },
  function fewerThanFindSmall(t) {
    const { small, diff } = compareNumbers(t);
    const big = small + diff;
    const [p, q] = people(2);
    const thing = pick(['stamps', 'beads', 'points', 'paper cranes']);
    return {
      text: `${p.name} collected ${fmt(big)} ${thing}. ${q.name} collected ${fmt(diff)} fewer ${thing} than ${p.name}. How many ${thing} did ${q.name} collect?`,
      answers: intAnswers(small, thing), value: small, unit: thing,
      hint: `Draw ${p.name}'s long bar. Draw ${q.name}'s bar shorter by ${fmt(diff)}. The shorter bar is "?".`,
      visual: V.compare([{ label: p.name, value: big }, { label: q.name, value: small, hidden: true }]),
    };
  },
  function howManyMore(t) {
    const { small, diff } = compareNumbers(t);
    const big = small + diff;
    const [p, q] = people(2);
    const what = pick(['steps', 'points', 'words', 'skipping jumps']);
    const verb = pick(['more', 'fewer']);
    const text = verb === 'more'
      ? `${p.name} made ${fmt(big)} ${what} and ${q.name} made ${fmt(small)} ${what}. How many more ${what} did ${p.name} make than ${q.name}?`
      : `${p.name} made ${fmt(big)} ${what} and ${q.name} made ${fmt(small)} ${what}. How many fewer ${what} did ${q.name} make than ${p.name}?`;
    return {
      text,
      answers: intAnswers(diff, what), value: diff, unit: what,
      hint: 'Draw both bars starting at the same line. The extra piece sticking out of the longer bar is the difference.',
      visual: V.compare([{ label: p.name, value: big }, { label: q.name, value: small }]),
    };
  },
  function compareTotal(t) {
    const { small, diff } = compareNumbers(t);
    const big = small + diff;
    const [p, q] = people(2);
    const thing = pick(['stickers', 'cards', 'marbles', 'storybooks']);
    return {
      text: `${p.name} has ${fmt(small)} ${thing}. ${q.name} has ${fmt(diff)} more ${thing} than ${p.name}. How many ${thing} do they have altogether?`,
      answers: intAnswers(small + big, thing), value: small + big, unit: thing,
      hint: `First draw the two bars and find ${q.name}'s amount. Then put both bars together for the total. (Two steps!)`,
      visual: V.compare([{ label: p.name, value: small }, { label: q.name, value: big, hidden: true }]),
    };
  },
  function heavierShop(t) {
    const { small, diff } = compareNumbers(t);
    const big = small + diff;
    const [s1, s2] = shuffle(['Shop A', 'Shop B', 'the Tampines stall', 'the Bedok stall']).slice(0, 2);
    const item = pick(['rice dumplings', 'kaya buns', 'curry puffs', 'mooncakes']);
    return {
      text: `${s1} sold ${fmt(big)} ${item} during ${pick(EVENTS)}. ${s1} sold ${fmt(diff)} more ${item} than ${s2}. How many ${item} did ${s2} sell?`,
      answers: intAnswers(small, item), value: small, unit: item,
      hint: `Draw ${s1}'s bar. ${s2}'s bar is shorter — ${fmt(diff)} shorter. Is "more than" telling you to add or take away here?`,
      visual: V.compare([{ label: s1, value: big }, { label: s2, value: small, hidden: true }]),
    };
  },
  function threeChildren(t) {
    const { small, diff } = compareNumbers(t);
    const d2 = tiers(t, R(10, 90), R(60, 600), R(150, 900));
    const [a, b, c] = people(3);
    const mid = small + diff;
    const top = mid + d2;
    const stuff = pick(['points', 'steps', 'coins in the tabung', 'beads']);
    if (t === 0) {
      return {
        text: `${a.name} has ${fmt(small)} ${stuff}. ${b.name} has ${fmt(diff)} more than ${a.name}. How many ${stuff} does ${b.name} have?`,
        answers: intAnswers(mid, stuff), value: mid,
        hint: `Draw ${a.name}'s bar, then ${b.name}'s bar with an extra ${fmt(diff)}.`,
        visual: V.compare([{ label: a.name, value: small }, { label: b.name, value: mid, hidden: true }]),
      };
    }
    return {
      text: `${a.name} has ${fmt(small)} ${stuff}. ${b.name} has ${fmt(diff)} more than ${a.name}. ${c.name} has ${fmt(d2)} more than ${b.name}. How many ${stuff} does ${c.name} have?`,
      answers: intAnswers(top, stuff), value: top,
      hint: `Draw three bars. Each one is longer than the one before. Work out ${b.name}'s bar first, then ${c.name}'s.`,
      visual: V.compare([{ label: a.name, value: small }, { label: b.name, value: mid }, { label: c.name, value: top, hidden: true }]),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 5. MULTI-STEP WORD PROBLEMS
// ═════════════════════════════════════════════════════════════════════════
const multiStepTemplates = [
  // Give away to two friends.
  function giveTwo(t) {
    const b = tiers(t, R(20, 150), R(150, 1200), R(400, 2000));
    const c = tiers(t, R(20, 150), R(150, 1200), R(400, 2000));
    const left = tiers(t, R(20, 200), R(100, 1500), R(300, 3000));
    const total = b + c + left;
    const [p, q, r] = people(3);
    const thing = pick(['stickers', 'stamps', 'marbles', 'beads']);
    return {
      text: `${p.name} had ${fmt(total)} ${thing}. ${cap(p.he)} gave ${fmt(b)} to ${q.name} and ${fmt(c)} to ${r.name}. How many ${thing} did ${p.name} have left?`,
      answers: intAnswers(left, thing), value: left, unit: thing,
      hint: `Draw a bar for ${fmt(total)} with three parts: ${q.name}'s, ${r.name}'s, and what is left ("?").`,
      visual: V.partWhole([{ label: q.name, value: b }, { label: r.name, value: c }, { label: 'left', value: left, hidden: true }], thing + ' at first', ''),
    };
  },
  // Buy items, pay with a note, change in whole dollars.
  function buyAndChange(t) {
    const n = tiers(t, R(2, 4), R(3, 6), R(4, 9));
    const price = tiers(t, R(2, 9), R(3, 9), R(6, 12));
    const cost = n * price;
    const note = [10, 50, 100].find(x => x > cost);
    if (!note) return null;
    const p = person();
    const item = pick(['notebooks', 'tickets to the Science Centre', 'kites', 'bottles of bandung', 'tubs of muruku']);
    return {
      text: `${p.name} bought ${n} ${item} at $${price} each. ${cap(p.he)} paid with a $${note} note. How much change did ${p.he} get?`,
      answers: dollarAnswers((note - cost) * 100), value: note - cost, unit: '$',
      hint: `Step 1: draw ${n} equal bars of $${price} to find the cost. Step 2: draw a $${note} bar and take the cost away.`,
      visual: V.partWhole([{ label: `${n} ${item}`, value: cost }, { label: 'change', value: note - cost, hidden: true }], `$${note} note`, '$'),
    };
  },
  // Boxes then some removed.
  function boxesMinus(t) {
    const per = pick([6, 7, 8, 9]);
    const boxes = tiers(t, R(3, 6), R(4, 9), R(6, 12));
    const total = per * boxes;
    const gone = R(Math.max(1, Math.floor(total / 5)), total - 3);
    const thing = pick(COUNTABLES), box = pick(CONTAINERS);
    const p = person();
    return {
      text: `${p.name} bought ${boxes} ${box.many} of ${thing.many}. Each ${box.one} had ${per} ${thing.many}. ${cap(p.he)} gave ${gone} ${thing.many} to ${p.his} classmates. How many ${thing.many} were left?`,
      answers: intAnswers(total - gone, thing.many), value: total - gone, unit: thing.many,
      hint: `Step 1: ${boxes} groups of ${per} — how many altogether? Step 2: draw a bar and take away the ${gone} given away.`,
      visual: V.groups(boxes, per, 'multiply', thing.emoji),
    };
  },
  // Times as many — total (units).
  function timesAsMany(t) {
    const k = tiers(t, R(2, 3), R(2, 5), R(3, 6));
    const unit = tiers(t, R(12, 90), R(45, 600), R(120, 1200));
    const [p, q] = people(2);
    const thing = pick(['stamps', 'marbles', 'stickers', 'beads']);
    const ask = t === 2 ? pick(['total', 'fromTotal']) : 'total';
    if (ask === 'fromTotal') {
      const total = unit * (k + 1);
      return {
        text: `${p.name} has ${k} times as many ${thing} as ${q.name}. They have ${fmt(total)} ${thing} altogether. How many ${thing} does ${q.name} have?`,
        answers: intAnswers(unit, thing), value: unit, unit: thing,
        hint: `Draw ${q.name}'s bar as 1 unit and ${p.name}'s as ${k} units. That makes ${k + 1} units altogether — share the total.`,
        visual: V.compare([{ label: p.name, value: unit * k }, { label: q.name, value: unit, hidden: true }]),
      };
    }
    return {
      text: `${q.name} has ${fmt(unit)} ${thing}. ${p.name} has ${k} times as many ${thing} as ${q.name}. How many ${thing} do they have altogether?`,
      answers: intAnswers(unit * (k + 1), thing), value: unit * (k + 1), unit: thing,
      hint: `Draw ${q.name}'s bar as 1 unit. ${p.name}'s bar is ${k} of those units. Count all the units.`,
      visual: V.compare([{ label: p.name, value: unit * k, hidden: true }, { label: q.name, value: unit }]),
    };
  },
  // Collected over days then shared.
  function collectShare(t) {
    const kids = pick([6, 7, 8, 9]);
    const each = tiers(t, R(2, 6), R(4, 12), R(12, 60));
    const total = kids * each;
    const a = R(Math.floor(total / 4), Math.floor((total * 3) / 4));
    const b = total - a;
    if (a <= 0 || b <= 0) return null;
    const thing = pick(['cans for recycling', 'old newspapers', 'plastic bottles', 'storybooks for donation']);
    return {
      text: `A class collected ${fmt(a)} ${thing} on Monday and ${fmt(b)} on Tuesday. They put all of them equally into ${kids} boxes. How many went into each box?`,
      answers: intAnswers(each), value: each,
      hint: `Step 1: add the two days. Step 2: cut the total bar into ${kids} equal parts.`,
      visual: V.partWhole(Array.from({ length: kids }, (_, i) => ({ label: 'box ' + (i + 1), value: each, hidden: i === 0 })), 'collected', ''),
    };
  },
  // Spending in dollars and cents, two items then left.
  function spendTwo(t) {
    const a = tiers(t, R(1, 9) * 50, R(110, 1500), R(345, 2875));
    const b = tiers(t, R(1, 9) * 50, R(110, 1500), R(345, 2875));
    const startDollars = [10, 20, 50, 100].find(x => x * 100 > a + b + 50);
    if (!startDollars) return null;
    const start = startDollars * 100;
    const left = start - a - b;
    const p = person();
    const [x, y] = shuffle(SHOP_ITEMS).slice(0, 2);
    return {
      text: `${p.name} had $${startDollars}. ${cap(p.he)} bought a ${x.name} for ${centsText(a)} and a ${y.name} for ${centsText(b)}. How much money did ${p.he} have left?`,
      answers: dollarAnswers(left), value: left, unit: '$',
      hint: `Draw a bar for $${startDollars} with three parts: the ${x.name}, the ${y.name}, and the money left ("?").`,
      visual: V.money([a, b, left], [x.name, y.name, 'left?']),
    };
  },
  // Rows of seats, some taken.
  function seatsLeft(t) {
    const rows = tiers(t, R(3, 6), R(5, 10), R(8, 12));
    const per = pick([6, 7, 8, 9]);
    const seats = rows * per;
    const taken = R(Math.floor(seats / 3), seats - 2);
    const venue = pick(['the school hall', 'the community centre', 'the Esplanade studio', 'the void deck concert']);
    return {
      text: `In ${venue}, there are ${rows} rows of ${per} seats. ${taken} people are sitting down. How many seats are empty?`,
      answers: intAnswers(seats - taken, 'seats'), value: seats - taken, unit: 'seats',
      hint: `Step 1: draw ${rows} rows of ${per} to find all the seats. Step 2: take away the ${taken} that are taken.`,
      visual: V.array(rows, per),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 6. PLACE VALUE (numbers to 10 000)
// ═════════════════════════════════════════════════════════════════════════
function pvNumber(t) {
  // 4-digit numbers, with zeros sprinkled in for stretch.
  if (t === 0) return R(100, 999);
  const d = [R(1, 9), R(0, 9), R(0, 9), R(0, 9)];
  if (t === 2 && Math.random() < 0.6) d[R(1, 3)] = 0;
  return Number(d.join(''));
}

const PLACE_NAMES = ['ones', 'tens', 'hundreds', 'thousands'];

const placeValueTemplates = [
  function valueOfDigit(t) {
    const n = pvNumber(t);
    const ds = digitsOf(n);
    const positions = ds.map((d, i) => ({ d, place: ds.length - 1 - i })).filter(x => x.d !== 0);
    const choice = pick(positions);
    const value = choice.d * Math.pow(10, choice.place);
    return {
      text: `What is the value of the digit ${choice.d} in ${fmt(n)}?`,
      answers: intAnswers(value), value,
      hint: `Put ${fmt(n)} into a place-value chart. Which column is the ${choice.d} in? Write that many ${PLACE_NAMES[choice.place]}.`,
      visual: V.placeValue(n),
    };
  },
  function digitInPlace(t) {
    const n = pvNumber(t);
    const ds = digitsOf(n);
    const place = R(0, ds.length - 1);
    const digit = ds[ds.length - 1 - place];
    return {
      text: `Which digit is in the ${PLACE_NAMES[place]} place in ${fmt(n)}?`,
      answers: intAnswers(digit), value: digit, allowZero: true,
      hint: `Draw a place-value chart with columns Th, H, T, O. Write each digit of ${fmt(n)} in its column.`,
      visual: V.placeValue(n),
    };
  },
  function expanded(t) {
    const n = pvNumber(t);
    const parts = placeJumps(n, 1);
    const shown = t === 2 ? shuffle(parts) : parts;
    return {
      text: `What number is ${shown.map(fmt).join(' + ')}?`,
      answers: intAnswers(n), value: n,
      hint: 'Put each part into its column in a place-value chart — thousands, hundreds, tens, ones. Empty columns get a 0.',
      visual: V.placeValue(n),
    };
  },
  function moreLess(t) {
    const step = tiers(t, pick([10, 100]), pick([10, 100, 1000]), pick([100, 1000]));
    const dir = pick(['more', 'less']);
    let n = pvNumber(t);
    if (dir === 'less' && n - step < 0) n += step;
    if (dir === 'more' && n + step > 9999) n -= step;
    const ans = dir === 'more' ? n + step : n - step;
    return {
      text: `What number is ${fmt(step)} ${dir} than ${fmt(n)}?`,
      answers: intAnswers(ans), value: ans,
      hint: `Make ${fmt(n)} on the place-value chart. Change only the ${PLACE_NAMES[String(step).length - 1]} column — but watch out for regrouping!`,
      visual: V.numberLine(n, [dir === 'more' ? step : -step]),
    };
  },
  function largestSmallest(t) {
    let ds;
    do { ds = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, t === 0 ? 3 : 4); } while (t === 2 ? !ds.includes(0) && Math.random() < 0.7 : false);
    const which = pick(['largest', 'smallest']);
    const sorted = ds.slice().sort((a, b) => b - a);
    let ans;
    if (which === 'largest') ans = Number(sorted.join(''));
    else {
      const asc = ds.slice().sort((a, b) => a - b);
      if (asc[0] === 0) { const firstNonZero = asc.findIndex(d => d > 0); const lead = asc.splice(firstNonZero, 1)[0]; asc.unshift(lead); }
      ans = Number(asc.join(''));
    }
    const len = ds.length;
    return {
      text: `Use each of the digits ${ds.join(', ')} once to make the ${which} ${len}-digit number.`,
      answers: intAnswers(ans), value: ans,
      hint: which === 'largest'
        ? 'Draw empty place-value boxes. Put the biggest digit in the biggest place first.'
        : 'Draw empty place-value boxes. Put the smallest digit you are ALLOWED to in the biggest place — a number cannot start with 0!',
      visual: V.placeValue(ans),
    };
  },
  function howManyHundreds(t) {
    const unitPlace = tiers(t, 1, pick([1, 2]), pick([1, 2]));
    const unitVal = Math.pow(10, unitPlace);
    const n = tiers(t, R(2, 9) * 10, R(12, 99) * unitVal, R(10, 99) * unitVal);
    const ans = n / unitVal;
    return {
      text: `${fmt(n)} = □ ${PLACE_NAMES[unitPlace]}. What number goes in the box?`,
      answers: intAnswers(ans), value: ans,
      hint: `Show ${fmt(n)} on the place-value chart. Change every bigger place into ${PLACE_NAMES[unitPlace]} (1 thousand = 10 hundreds, 1 hundred = 10 tens).`,
      visual: V.placeValue(n),
    };
  },
  function wordForm(t) {
    const n = pvNumber(t);
    const words = numberToWords(n);
    return {
      text: `Write "${words}" in numerals.`,
      answers: intAnswers(n), value: n,
      hint: 'Listen for each place: "thousand", "hundred", then the tens and ones. Write each digit in a place-value chart, with 0 for any empty place.',
      visual: V.placeValue(n),
    };
  },
];

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) {
    const rest = n % 100;
    return ONES[Math.floor(n / 100)] + ' hundred' + (rest ? ' and ' + numberToWords(rest) : '');
  }
  const th = Math.floor(n / 1000), rest = n % 1000;
  if (!rest) return ONES[th] + ' thousand';
  if (rest < 100) return ONES[th] + ' thousand and ' + numberToWords(rest);
  return ONES[th] + ' thousand, ' + numberToWords(rest);
}

// ═════════════════════════════════════════════════════════════════════════
// 7. NUMBER PATTERNS
// ═════════════════════════════════════════════════════════════════════════
function patternSpec(t) {
  const step = tiers(t, pick([2, 5, 10, 100]), pick([6, 7, 8, 9, 50, 100, 1000]), pick([6, 7, 8, 9, 25, 250, 500, 1000, 110, 1010]));
  const dir = t === 0 ? pick([1, 1, -1]) : pick([1, -1]);
  const len = 5;
  const span = step * (len + 1);
  const startMin = dir > 0 ? tiers(t, 0, 10, 100) : span + 5;
  const startMax = Math.max(startMin, Math.min(9999 - span, tiers(t, 500, 5000, 8000)));
  const start = R(startMin, startMax);
  const seq = Array.from({ length: len + 1 }, (_, i) => start + dir * step * i);
  return { step, dir, seq };
}

const patternTemplates = [
  function nextTerm(t) {
    const { step, dir, seq } = patternSpec(t);
    const shown = seq.slice(0, 4);
    const ans = seq[4];
    return {
      text: `What is the next number in the pattern?  ${shown.map(fmt).join(', ')}, ___`,
      answers: intAnswers(ans), value: ans,
      hint: 'Draw the jumps between the numbers on a number line. Is every jump the same size? Which way is it going?',
      visual: V.numberLine(shown[0], Array(3).fill(dir * step)),
    };
  },
  function missingMiddle(t) {
    const { step, dir, seq } = patternSpec(t);
    const gap = R(1, 3);
    const ans = seq[gap];
    const shown = seq.slice(0, 5).map((x, i) => (i === gap ? '___' : fmt(x)));
    return {
      text: `Find the missing number in the pattern.  ${shown.join(', ')}`,
      answers: intAnswers(ans), value: ans,
      hint: 'Find the jump between two numbers that sit next to each other. Draw the same jump into the gap.',
      visual: V.numberLine(seq[0], Array(4).fill(dir * step)),
    };
  },
  function findRule(t) {
    const { step, dir, seq } = patternSpec(t);
    return {
      text: `Look at the pattern: ${seq.slice(0, 5).map(fmt).join(', ')}. By how much does it ${dir > 0 ? 'increase' : 'decrease'} each time?`,
      answers: intAnswers(step), value: step,
      hint: 'Draw the numbers on a number line and look at the size of ONE jump.',
      visual: V.numberLine(seq[0], Array(4).fill(dir * step)),
    };
  },
  function nthTerm(t) {
    const { step, dir, seq } = patternSpec(t);
    const extra = tiers(t, 1, 2, 3);
    const nth = 4 + extra;
    const ans = seq[0] + dir * step * (nth - 1);
    if (ans < 0 || ans > 9999) return null;
    const ord = { 5: '5th', 6: '6th', 7: '7th' }[nth];
    return {
      text: `The pattern starts ${seq.slice(0, 4).map(fmt).join(', ')}, … What is the ${ord} number in the pattern?`,
      answers: intAnswers(ans), value: ans,
      hint: `Draw the first number and keep making the same jump. Count your jumps — you need ${nth - 1} jumps from the 1st number.`,
      visual: V.numberLine(seq[0], Array(nth - 1).fill(dir * step)),
    };
  },
  function savingsPattern(t) {
    const p = person();
    const step = tiers(t, R(2, 5), R(3, 9), R(6, 15));
    const start = tiers(t, R(1, 10), R(5, 30), R(10, 50));
    const weeks = tiers(t, 4, 5, 6);
    const ans = start + step * (weeks - 1);
    const days = ['Week 1', 'Week 2', 'Week 3'];
    return {
      text: `${p.name} saves money in ${p.his} piggy bank. ${cap(p.he)} has $${start} in Week 1, $${start + step} in Week 2 and $${start + 2 * step} in Week 3. If the pattern continues, how much will ${p.he} have in Week ${weeks}?`,
      answers: dollarAnswers(ans * 100), value: ans, unit: '$',
      hint: `${days.join(', ')} … draw each week as a jump on a number line. Every jump is $${step}.`,
      visual: V.numberLine(start, Array(weeks - 1).fill(step)),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 8. FRACTIONS — equivalent, compare, add/subtract like (and related) denominators
// ═════════════════════════════════════════════════════════════════════════
function properFraction(dens) {
  const d = pick(dens);
  const n = R(1, d - 1);
  return { n, d };
}

const fractionTemplates = [
  // Equivalent: 1/2 = □/8
  function equivalentMissing(t) {
    const base = tiers(t, pick([2, 3, 4]), pick([2, 3, 4, 5, 6]), pick([3, 4, 5, 6]));
    const k = tiers(t, 2, R(2, 3), R(2, Math.floor(12 / base)));
    if (base * k > 12 || k < 2) return null;
    const n = R(1, base - 1);
    const ask = pick(['num', 'den']);
    if (ask === 'num') {
      return {
        text: `Fill in the box:  ${n}/${base} = □/${base * k}`,
        answers: intAnswers(n * k), value: n * k,
        hint: `Draw a bar cut into ${base} parts and shade ${n}. Under it draw the same bar cut into ${base * k} parts. How many small parts are shaded?`,
        visual: V.fraction(base, n, base * k),
      };
    }
    return {
      text: `Fill in the box:  ${n}/${base} = ${n * k}/□`,
      answers: intAnswers(base * k), value: base * k,
      hint: `Each of the ${base} parts was cut into ${k} smaller parts. Draw it — how many small parts make the whole bar?`,
      visual: V.fraction(base, n, base * k),
    };
  },
  // Compare two fractions.
  function compareFractions(t) {
    let a, b;
    for (let i = 0; i < 40; i++) {
      if (t === 0) {
        // Same denominator.
        const d = pick([4, 5, 6, 8, 10]);
        const x = R(1, d - 1), y = R(1, d - 1);
        if (x === y) continue;
        a = { n: x, d }; b = { n: y, d };
      } else if (t === 1) {
        // Same numerator (unit fractions or same n).
        const n = R(1, 3);
        const d1 = R(n + 1, 12), d2 = R(n + 1, 12);
        if (d1 === d2) continue;
        a = { n, d: d1 }; b = { n, d: d2 };
      } else {
        // Related denominators.
        const d = pick([2, 3, 4, 5, 6]);
        const k = pick([2, 3]);
        if (d * k > 12) continue;
        a = { n: R(1, d - 1), d }; b = { n: R(1, d * k - 1), d: d * k };
        if (a.n * k === b.n) continue;
      }
      break;
    }
    if (!a || !b || a.n * b.d === b.n * a.d) return null;
    const which = pick(['greater', 'smaller']);
    const aBig = a.n * b.d > b.n * a.d;
    const ans = (which === 'greater') === aBig ? a : b;
    return {
      text: `Which is ${which}: ${a.n}/${a.d} or ${b.n}/${b.d}?`,
      answers: [`${ans.n}/${ans.d}`],
      value: ans.n,
      hint: `Draw two bars the same length. Cut one into ${a.d} parts and shade ${a.n}; cut the other into ${b.d} parts and shade ${b.n}. Which shading is longer?`,
      visual: V.fraction(a.d, null, b.d),
    };
  },
  // Add like fractions within a whole.
  function addLike(t) {
    const d = tiers(t, pick([4, 5, 6, 8]), pick([5, 6, 7, 8, 9, 10]), pick([8, 9, 10, 12]));
    const a = R(1, d - 2);
    const b = R(1, d - a);
    const p = person();
    const food = pick(['pizza', 'kueh lapis', 'pandan cake', 'watermelon', 'roti john']);
    const plain = t === 0 || Math.random() < 0.4;
    const sum = a + b;
    return {
      text: plain
        ? `Find the value of ${a}/${d} + ${b}/${d}. Give your answer as a fraction.`
        : `${p.name} ate ${a}/${d} of a ${food}. ${cap(p.his)} sister ate ${b}/${d} of the same ${food}. What fraction of the ${food} did they eat altogether?`,
      answers: fractionAnswers(sum, d), value: sum,
      hint: `Draw a bar cut into ${d} equal parts. Shade ${a} parts, then ${b} more. Count the shaded parts — the bottom number stays ${d}.`,
      visual: V.fraction(d, a),
    };
  },
  // Subtract like fractions / from 1 whole.
  function subtractLike(t) {
    const d = tiers(t, pick([4, 5, 6, 8]), pick([5, 6, 7, 8, 9, 10]), pick([8, 9, 10, 12]));
    const fromWhole = t > 0 && Math.random() < 0.5;
    const a = fromWhole ? d : R(2, d - 1);
    const b = R(1, a - 1);
    const p = person();
    const thing = pick(['bottle of juice', 'ribbon', 'cake', 'packet of rice']);
    const text = fromWhole
      ? `${p.name} had a whole ${thing}. ${cap(p.he)} used ${b}/${d} of it. What fraction of the ${thing} was left?`
      : `Find the value of ${a}/${d} − ${b}/${d}. Give your answer as a fraction.`;
    return {
      text,
      answers: fractionAnswers(a - b, d), value: a - b,
      hint: fromWhole
        ? `1 whole = ${d}/${d}. Draw a bar of ${d} parts, cross out ${b} of them, and count what is left.`
        : `Draw a bar of ${d} parts. Shade ${a}, then cross out ${b} of the shaded parts.`,
      visual: V.fraction(d, a),
    };
  },
  // Related denominators (stretch) e.g. 1/2 + 3/8.
  function addRelated(t) {
    const pairs = tiers(t, [[2, 4], [3, 6], [2, 6]], [[2, 4], [2, 8], [3, 6], [4, 8], [5, 10]], [[2, 8], [3, 9], [4, 12], [3, 12], [5, 10], [6, 12], [2, 10]]);
    const [small, big] = pick(pairs);
    const k = big / small;
    const a = R(1, small - 1);
    const maxB = big - a * k;
    if (maxB < 1) return null;
    const b = R(1, maxB);
    const op = pick(['+', '−']);
    if (op === '+') {
      const sum = a * k + b;
      return {
        text: `Find the value of ${a}/${small} + ${b}/${big}.`,
        answers: fractionAnswers(sum, big), value: sum,
        hint: `Draw a ${small}-part bar and a ${big}-part bar the same length. Change ${a}/${small} into ${big}ths first, then add.`,
        visual: V.fraction(small, a, big),
      };
    }
    const top = a * k;
    if (top - b <= 0) return null;
    return {
      text: `Find the value of ${a}/${small} − ${b}/${big}.`,
      answers: fractionAnswers(top - b, big), value: top - b,
      hint: `Draw both bars the same length. ${a}/${small} is the same as ${top}/${big}. Now take away ${b}/${big}.`,
      visual: V.fraction(small, a, big),
    };
  },
  // Simplest form.
  function simplest(t) {
    const base = properFraction(tiers(t, [2, 3, 4], [3, 4, 5, 6], [3, 4, 5, 6]));
    if (gcd(base.n, base.d) !== 1) return null;
    const k = R(2, Math.max(2, Math.floor(12 / base.d)));
    if (base.d * k > 12) return null;
    const n = base.n * k, d = base.d * k;
    return {
      text: `Express ${n}/${d} in its simplest form.`,
      answers: fractionAnswers(n, d, true), value: base.n,
      hint: `Shade ${n} parts of a ${d}-part bar. Then draw a bar with fewer, bigger parts underneath — what is the smallest number of parts that still lines up?`,
      visual: V.fraction(d, n, base.d),
    };
  },
  // Fraction of a shape — reading the shaded part.
  function shadedPart(t) {
    const d = tiers(t, pick([3, 4, 5, 6]), pick([6, 7, 8, 9, 10]), pick([8, 9, 10, 11, 12]));
    const n = R(1, d - 1);
    const ask = pick(['shaded', 'unshaded']);
    const val = ask === 'shaded' ? n : d - n;
    return {
      text: `A bar is cut into ${d} equal parts. ${n} of the parts are shaded. What fraction of the bar is ${ask === 'shaded' ? 'shaded' : 'NOT shaded'}?`,
      answers: fractionAnswers(val, d), value: val,
      hint: `Tap the parts to shade ${n} of the ${d}. The bottom number is how many parts in the whole bar.`,
      visual: V.fraction(d, n),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 9. MONEY ($ and ¢)
// ═════════════════════════════════════════════════════════════════════════
function priceOf(item, t) {
  const [lo, hi] = item.price[t];
  // Prices end in 0 or 5 cents, like real shop prices.
  return Math.max(5, Math.round(R(lo, hi) / 5) * 5);
}

const moneyTemplates = [
  function addTwoPrices(t) {
    const [x, y] = shuffle(SHOP_ITEMS).slice(0, 2);
    const a = priceOf(x, t), b = priceOf(y, t);
    const p = person();
    const shop = pick(SHOPS);
    return {
      text: `At ${shop}, ${p.name} buys a ${x.name} for ${centsText(a)} and a ${y.name} for ${centsText(b)}. How much does ${p.he} spend altogether?`,
      answers: dollarAnswers(a + b), value: a + b, unit: '$',
      hint: 'Tap each pile of coins and notes. Add the dollars, add the cents — 100¢ makes another $1!',
      visual: V.money([a, b], [x.name, y.name]),
    };
  },
  function change(t) {
    const x = pick(SHOP_ITEMS);
    const n = tiers(t, 1, R(1, 2), R(2, 4));
    const each = priceOf(x, t);
    const cost = each * n;
    const note = [200, 500, 1000, 2000, 5000, 10000].find(v => v > cost);
    if (!note) return null;
    const p = person();
    return {
      text: n === 1
        ? `${p.name} buys a ${x.name} that costs ${centsText(cost)}. ${cap(p.he)} pays with a $${note / 100} note. How much change does ${p.he} get?`
        : `${p.name} buys ${n} ${x.many} at ${centsText(each)} each. ${cap(p.he)} pays with a $${note / 100} note. How much change does ${p.he} get?`,
      answers: dollarAnswers(note - cost), value: note - cost, unit: '$',
      hint: `Draw a bar for the $${note / 100} note. One part is what was spent; the other part is the change. Count up from the cost to $${note / 100}.`,
      visual: V.money([note, cost], [`$${note / 100} note`, 'cost']),
    };
  },
  function dollarsToCents(t) {
    const c = tiers(t, R(1, 9) * 100 + R(1, 9) * 10, R(1, 20) * 100 + R(1, 99), R(10, 95) * 100 + R(0, 9) * 5 + pick([0, 5, 50]));
    const fix = Math.max(5, c);
    return {
      text: `${centsText(fix)} = □ ¢. What number goes in the box?`,
      answers: centAnswers(fix), value: fix, unit: '¢',
      hint: '$1 = 100¢. Draw the dollar coins/notes as groups of 100¢, then add the cents.',
      visual: V.money([fix], [centsText(fix)]),
    };
  },
  function centsToDollars(t) {
    const c = tiers(t, R(101, 999), R(1005, 4995), R(5005, 9995));
    const cc = Math.round(c / 5) * 5;
    return {
      text: `Write ${fmt(cc)}¢ in dollars and cents.`,
      answers: dollarAnswers(cc), value: cc, unit: '$',
      hint: 'Every 100¢ makes $1. Circle groups of 100¢ to find the dollars — what is left over is the cents.',
      visual: V.money([cc], [`${fmt(cc)}¢`]),
    };
  },
  function whoHasMore(t) {
    const [p, q] = people(2);
    const a = tiers(t, R(110, 990), R(1000, 4500), R(2000, 8000));
    const diff = tiers(t, R(15, 300), R(55, 1800), R(125, 1500));
    const ar = Math.round(a / 5) * 5, dr = Math.round(diff / 5) * 5;
    if (dr <= 0) return null;
    const b = ar + dr;
    return {
      text: `${p.name} has ${centsText(ar)} in ${p.his} wallet. ${q.name} has ${centsText(b)}. How much more money does ${q.name} have than ${p.name}?`,
      answers: dollarAnswers(dr), value: dr, unit: '$',
      hint: 'Draw two bars for the two wallets, lined up on the left. The extra piece on the longer bar is "how much more".',
      visual: V.money([ar, b], [p.name, q.name]),
    };
  },
  function saveUp(t) {
    const p = person();
    const goal = tiers(t, R(5, 20) * 100, R(20, 60) * 100 + pick([0, 50]), R(40, 95) * 100 + R(1, 19) * 5);
    const has = tiers(t, R(1, 4) * 100 + pick([0, 50]), R(5, 19) * 100 + R(1, 19) * 5, R(10, 39) * 100 + R(1, 19) * 5);
    if (has >= goal) return null;
    const toy = pick(['a remote-control car', 'a Lego set', 'a new school bag', 'a pair of roller skates', 'a storybook set']);
    return {
      text: `${p.name} wants to buy ${toy} that costs ${moneyText(goal)}. ${cap(p.he)} has saved ${moneyText(has)}. How much more money does ${p.he} need?`,
      answers: dollarAnswers(goal - has), value: goal - has, unit: '$',
      hint: `Draw a bar for ${moneyText(goal)}. Shade the part saved. The empty part is how much more is needed.`,
      visual: V.money([goal, has], ['costs', 'saved']),
    };
  },
  function angPao(t) {
    const p = person();
    const notes = tiers(t, [2, 5, 10], [2, 5, 10, 50], [2, 5, 10, 50, 100]);
    const count = tiers(t, 3, R(3, 4), R(4, 6));
    const gifts = Array.from({ length: count }, () => pick(notes));
    const total = gifts.reduce((a, b) => a + b, 0);
    const fest = pick(['Chinese New Year', 'Hari Raya', 'Deepavali']);
    const packet = fest === 'Chinese New Year' ? 'red packets' : fest === 'Hari Raya' ? 'green packets' : 'gift envelopes';
    return {
      text: `During ${fest}, ${p.name} received ${count} ${packet} with $${gifts.join(', $')} inside. How much money did ${p.he} receive altogether?`,
      answers: dollarAnswers(total * 100), value: total, unit: '$',
      hint: 'Draw one bar with a part for each packet. Add the biggest amounts first.',
      visual: V.partWhole(gifts.map((g, i) => ({ label: 'packet ' + (i + 1), value: g })), 'altogether', '$', true),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 10. TIME — 24-hour clock, elapsed time, h and min
// ═════════════════════════════════════════════════════════════════════════
function randomTime(t, minH, maxH) {
  const h = R(minH, maxH);
  const m = tiers(t, pick([0, 15, 30, 45]), R(0, 11) * 5, R(0, 59));
  return { h, m };
}

const timeTemplates = [
  function to24(t) {
    const { h, m } = randomTime(t, t === 0 ? 13 : 0, 23);
    return {
      text: `Write ${twelveHour(h, m)} using the 24-hour clock.`,
      answers: twentyFourAnswers(h, m), value: h * 60 + m, allowZero: true,
      hint: `Is it before or after noon? For p.m. times (except 12 p.m.), add 12 to the hour. Move the clock round to check.`,
      visual: V.clock(h, m, 60),
    };
  },
  function from24(t) {
    const { h, m } = randomTime(t, t === 0 ? 13 : 0, 23);
    return {
      text: `What is ${twentyFour(h, m)} in 12-hour time? (Remember a.m. or p.m.!)`,
      answers: clockAnswers(h, m), value: h * 60 + m, allowZero: true,
      hint: 'If the hour is more than 12, take away 12 and it is p.m. 00:xx is just after midnight (12 a.m.).',
      visual: V.clock(h, m, 60),
    };
  },
  function endTime(t) {
    const { h, m } = randomTime(t, 7, 16);
    const dur = tiers(t, pick([15, 30, 45, 60, 90]), R(2, 20) * 5, R(25, 200));
    const end = h * 60 + m + dur;
    if (end >= 24 * 60) return null;
    const eh = Math.floor(end / 60), em = end % 60;
    const ctx = pick([
      ['A movie at the cinema starts', 'lasts'],
      ['Swimming lessons at the CC start', 'last'],
      ['The bus ride from Woodlands to the Zoo starts', 'takes'],
      ['A CCA practice starts', 'lasts'],
      ['The NDP rehearsal starts', 'lasts'],
    ]);
    const askIn24 = t === 2 && Math.random() < 0.5;
    return {
      text: `${ctx[0]} at ${twelveHour(h, m)} and ${ctx[1]} ${durationText(dur)}. What time does it end?${askIn24 ? ' Give your answer in 24-hour time.' : ''}`,
      answers: askIn24 ? twentyFourAnswers(eh, em) : uniq([...clockAnswers(eh, em), ...twentyFourAnswers(eh, em)]),
      value: end,
      hint: `Draw a time line. Jump the hours first, then the minutes. Slide the clock forward ${durationText(dur)} to check.`,
      visual: V.clock(h, m, dur),
    };
  },
  function durationBetween(t) {
    const { h, m } = randomTime(t, 8, 15);
    const dur = tiers(t, pick([15, 30, 45, 60, 90, 120]), R(3, 24) * 5, R(35, 220));
    const end = h * 60 + m + dur;
    if (end >= 24 * 60) return null;
    const eh = Math.floor(end / 60), em = end % 60;
    const p = person();
    const place = pick(PLACES);
    const inMinutes = t === 0 || dur < 60 || Math.random() < 0.3;
    return {
      text: `${p.name} arrived at ${place} at ${twelveHour(h, m)} and left at ${twelveHour(eh, em)}. How long was ${p.he} there?${inMinutes ? ' Give your answer in minutes.' : ' Give your answer in hours and minutes.'}`,
      answers: inMinutes ? intAnswers(dur, 'min') : uniq([...durationAnswers(dur), String(dur) + ' min']),
      value: dur,
      hint: `Draw a time line from ${twelveHour(h, m)}. Jump to the next o'clock first, then on to ${twelveHour(eh, em)}. Add up the jumps.`,
      visual: V.clock(h, m, dur),
    };
  },
  function hoursToMinutes(t) {
    const hh = tiers(t, R(1, 3), R(1, 5), R(2, 9));
    const mm = tiers(t, pick([0, 15, 30, 45]), R(1, 59), R(1, 59));
    const total = hh * 60 + mm;
    const reverse = t > 0 && Math.random() < 0.5;
    if (reverse && mm > 0) {
      return {
        text: `${total} minutes = □ h □ min. Write the answer in hours and minutes.`,
        answers: durationAnswers(total), value: total,
        hint: 'Every 60 minutes makes 1 hour. Draw groups of 60 and count what is left over.',
        visual: V.clock(12, 0, total),
      };
    }
    return {
      text: `${durationText(total)} = □ minutes. What number goes in the box?`,
      answers: intAnswers(total, 'min'), value: total, unit: 'min',
      hint: `1 h = 60 min. Draw ${hh} jumps of 60 on a number line, then add ${mm} more.`,
      visual: V.numberLine(0, mm ? [...Array(hh).fill(60), mm] : Array(hh).fill(60)),
    };
  },
  function startTime(t) {
    const end = randomTime(t, 10, 18);
    const dur = tiers(t, pick([30, 60, 90]), R(3, 20) * 5, R(25, 180));
    const start = end.h * 60 + end.m - dur;
    if (start < 0) return null;
    const sh = Math.floor(start / 60), sm = start % 60;
    const p = person();
    const act = pick(['baked cookies', 'did ' + p.his + ' homework', 'practised the piano', 'played at the playground', 'read at the library']);
    return {
      text: `${p.name} ${act} for ${durationText(dur)}. ${cap(p.he)} finished at ${twelveHour(end.h, end.m)}. What time did ${p.he} start?`,
      answers: uniq([...clockAnswers(sh, sm), ...twentyFourAnswers(sh, sm)]), value: start,
      hint: `Draw a time line that ends at ${twelveHour(end.h, end.m)}. Jump BACK ${durationText(dur)} — hours first, then minutes.`,
      visual: V.clock(sh, sm, dur),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 11. LENGTH (km, m, cm)
// ═════════════════════════════════════════════════════════════════════════
const lengthTemplates = [
  function mCmToCm(t) {
    const m = tiers(t, R(1, 5), R(2, 9), R(3, 20));
    const cm = tiers(t, pick([10, 20, 25, 50, 75]), R(1, 99), R(1, 9));
    const total = m * 100 + cm;
    return {
      text: `${m} m ${cm} cm = □ cm. What number goes in the box?`,
      answers: intAnswers(total, 'cm'), value: total, unit: 'cm',
      hint: `1 m = 100 cm. Draw ${m} metre sticks of 100 cm, then add on the ${cm} cm.`,
      visual: V.measure('length', [m * 100, cm], 'cm', ['metres', 'cm']),
    };
  },
  function cmToMCm(t) {
    const total = tiers(t, R(1, 5) * 100 + R(1, 9) * 10, R(105, 999), R(1001, 2999));
    const m = Math.floor(total / 100), cm = total % 100;
    if (!cm) return null;
    return {
      text: `${fmt(total)} cm = □ m □ cm. Write your answer in metres and centimetres.`,
      answers: uniq([`${m} m ${cm} cm`, `${m}m ${cm}cm`, `${m}m${cm}cm`, `${m} m and ${cm} cm`]), value: total, unit: '',
      hint: 'Every 100 cm makes 1 m. Lay down metre sticks along the length and see what is left.',
      visual: V.measure('length', [total], 'cm'),
    };
  },
  function kmToM(t) {
    const km = tiers(t, R(1, 3), R(1, 6), R(2, 9));
    const m = tiers(t, pick([0, 500]), R(1, 19) * 50, R(5, 999));
    const total = km * 1000 + m;
    const p = person();
    return {
      text: `${p.name} cycled ${km} km ${m ? m + ' m ' : ''}along the Park Connector. How many metres did ${p.he} cycle?`,
      answers: intAnswers(total, 'm'), value: total, unit: 'm',
      hint: `1 km = 1 000 m. Draw ${km} jumps of 1 000 on a number line${m ? `, then one more jump of ${m}` : ''}.`,
      visual: V.numberLine(0, m ? [...Array(km).fill(1000), m] : Array(km).fill(1000)),
    };
  },
  function ribbonLeft(t) {
    const whole = tiers(t, R(2, 5) * 100, R(3, 9) * 100, R(5, 12) * 100 + R(1, 9) * 10);
    const used = tiers(t, R(2, 9) * 10, R(110, whole - 50), R(150, whole - 60));
    if (used <= 0 || used >= whole) return null;
    const left = whole - used;
    const p = person();
    const thing = pick(['ribbon', 'piece of string', 'roll of washi tape', 'rope']);
    return {
      text: `${p.name} had a ${thing} ${whole % 100 === 0 ? (whole / 100) + ' m' : Math.floor(whole / 100) + ' m ' + (whole % 100) + ' cm'} long. ${cap(p.he)} cut off ${used >= 100 ? Math.floor(used / 100) + ' m ' + (used % 100 ? (used % 100) + ' cm' : '') : used + ' cm'}. How long is the ${thing} left? Give your answer in centimetres.`.replace(/ +\./g, '.').replace(/  +/g, ' '),
      answers: intAnswers(left, 'cm'), value: left, unit: 'cm',
      hint: 'Change everything into cm first. Then draw a bar for the whole ribbon, cut off the used part, and find the rest.',
      visual: V.partWhole([{ label: 'cut off', value: used }, { label: 'left', value: left, hidden: true }], thing, 'cm'),
    };
  },
  function totalHeight(t) {
    const a = tiers(t, R(20, 60), R(85, 160), R(120, 180));
    const b = tiers(t, R(20, 60), R(40, 99), R(85, 145));
    const p = person();
    const thing = pick([['a box'], ['a stool'], ['a chair'], ['a step']]);
    const total = a + b;
    const ask = t === 2 ? 'mcm' : 'cm';
    return {
      text: `${p.name} is ${a} cm tall. ${cap(p.he)} stands on ${thing[0]} that is ${b} cm tall. How high is the top of ${p.his} head from the floor?${ask === 'mcm' ? ' Give your answer in m and cm.' : ' Give your answer in cm.'}`,
      answers: ask === 'mcm' && total >= 100 && total % 100
        ? uniq([`${Math.floor(total / 100)} m ${total % 100} cm`, `${Math.floor(total / 100)}m ${total % 100}cm`, `${Math.floor(total / 100)}m${total % 100}cm`, `${total} cm`])
        : intAnswers(total, 'cm'),
      value: total, unit: ask === 'mcm' ? '' : 'cm',
      hint: 'Draw a tall bar with two parts stacked: the box at the bottom, the child on top. Add the parts.',
      visual: V.measure('length', [b, a], 'cm', [thing[0].replace('a ', ''), p.name]),
    };
  },
  function compareLengths(t) {
    const [p, q] = people(2);
    const a = tiers(t, R(100, 400), R(150, 900), R(1200, 4500));
    const diff = tiers(t, R(10, 90), R(25, 300), R(150, 1500));
    const unit = t === 2 ? 'm' : 'cm';
    const what = t === 2 ? 'ran' : 'threw a beanbag';
    return {
      text: `${p.name} ${what} ${fmt(a + diff)} ${unit} and ${q.name} ${what} ${fmt(a)} ${unit} on Sports Day. How much farther did ${p.name} go than ${q.name}?`,
      answers: intAnswers(diff, unit), value: diff, unit,
      hint: 'Draw two bars from the same starting line. The bit sticking out is how much farther.',
      visual: V.compare([{ label: p.name, value: a + diff }, { label: q.name, value: a }], unit),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 12. MASS & VOLUME (kg, g, ℓ, ml)
// ═════════════════════════════════════════════════════════════════════════
const massVolumeTemplates = [
  function kgGToG(t) {
    const kg = tiers(t, R(1, 4), R(1, 9), R(2, 9));
    const g = tiers(t, pick([100, 200, 250, 500, 750]), R(1, 19) * 50, R(5, 995));
    const total = kg * 1000 + g;
    const what = pick(['bag of rice', 'watermelon', 'durian', 'bag of flour', 'box of books']);
    return {
      text: `A ${what} has a mass of ${kg} kg ${g} g. What is its mass in grams?`,
      answers: intAnswers(total, 'g'), value: total, unit: 'g',
      hint: `1 kg = 1 000 g. Put ${kg} one-kilogram weights on the scale, then add ${g} g more.`,
      visual: V.measure('mass', [kg * 1000, g], 'g', ['kilograms', 'grams']),
    };
  },
  function lMlToMl(t) {
    const l = tiers(t, R(1, 3), R(1, 6), R(2, 9));
    const ml = tiers(t, pick([100, 250, 500, 750]), R(1, 19) * 50, R(5, 995));
    const total = l * 1000 + ml;
    const what = pick(['pail of water', 'jug of bandung', 'pot of soup', 'fish tank', 'bottle of soya bean milk']);
    return {
      text: `A ${what} holds ${l} ℓ ${ml} ml. How many millilitres is that?`,
      answers: intAnswers(total, 'ml'), value: total, unit: 'ml',
      hint: `1 ℓ = 1 000 ml. Pour in ${l} litre${l > 1 ? 's' : ''} and then ${ml} ml more — read the beaker.`,
      visual: V.measure('volume', [l * 1000, ml], 'ml', ['litres', 'ml']),
    };
  },
  function totalMass(t) {
    const a = tiers(t, R(1, 9) * 50, R(150, 1850), R(1250, 4800));
    const b = tiers(t, R(1, 9) * 50, R(120, 1600), R(980, 3900));
    const [x, y] = shuffle(['a pineapple', 'a papaya', 'a bag of potatoes', 'a bag of onions', 'a packet of sugar', 'a pumpkin']).slice(0, 2);
    const p = person();
    return {
      text: `${p.name} put ${x} with a mass of ${fmt(a)} g and ${y} with a mass of ${fmt(b)} g on a scale. What was the total mass in grams?`,
      answers: intAnswers(a + b, 'g'), value: a + b, unit: 'g',
      hint: 'Put both things on the scale one at a time and read the pointer. Or draw a two-part bar and add.',
      visual: V.measure('mass', [a, b], 'g', [x.replace(/^a /, ''), y.replace(/^a /, '')]),
    };
  },
  function pourOut(t) {
    const whole = tiers(t, R(2, 9) * 100, R(1, 4) * 1000 + R(0, 9) * 100, R(2, 5) * 1000 + R(1, 99) * 5);
    const used = tiers(t, R(1, whole / 100 - 1) * 100, R(150, whole - 100), R(450, whole - 150));
    if (used <= 0 || used >= whole) return null;
    const p = person();
    const drink = pick(['orange juice', 'milk', 'teh bing', 'barley water', 'Milo']);
    return {
      text: `A jug had ${fmt(whole)} ml of ${drink}. ${p.name} poured out ${fmt(used)} ml into cups. How much ${drink} was left in the jug?`,
      answers: intAnswers(whole - used, 'ml'), value: whole - used, unit: 'ml',
      hint: `Draw a bar for the ${fmt(whole)} ml in the jug. Cut off the part poured out — the rest is "?".`,
      visual: V.partWhole([{ label: 'poured out', value: used }, { label: 'left', value: whole - used, hidden: true }], drink, 'ml'),
    };
  },
  function equalBottles(t) {
    const per = tiers(t, pick([100, 200, 250, 500]), pick([150, 250, 300, 350, 400]), pick([125, 175, 225, 330, 375]));
    const n = tiers(t, R(2, 5), R(3, 8), R(4, 9));
    const total = per * n;
    const ask = pick(['total', 'each']);
    const thing = pick(['bottles', 'cups', 'packets', 'cartons']);
    if (ask === 'each') {
      return {
        text: `${fmt(total)} ml of water is poured equally into ${n} ${thing}. How much water is in each of the ${thing}?`,
        answers: intAnswers(per, 'ml'), value: per, unit: 'ml',
        hint: `Draw a bar for ${fmt(total)} ml and cut it into ${n} equal parts.`,
        visual: V.partWhole(Array.from({ length: n }, (_, i) => ({ label: String(i + 1), value: per, hidden: i === 0 })), 'ml of water', 'ml'),
      };
    }
    return {
      text: `Each of ${n} ${thing} holds ${per} ml of soya bean milk. How much soya bean milk is there altogether? Give your answer in ml.`,
      answers: intAnswers(total, 'ml'), value: total, unit: 'ml',
      hint: `Pour ${per} ml into the beaker ${n} times. Or draw ${n} equal bars and multiply.`,
      visual: V.measure('volume', Array(Math.min(n, 4)).fill(per), 'ml'),
    };
  },
  function heavierBy(t) {
    const [p, q] = people(2);
    const a = tiers(t, R(20, 35), R(22, 40), R(25, 45));
    const diff = tiers(t, R(1, 9), R(2, 12), R(3, 15));
    const kgOrG = t === 2 ? 'g' : 'kg';
    const bigA = kgOrG === 'g' ? a * 1000 + R(1, 9) * 100 : a + diff;
    const smallB = kgOrG === 'g' ? bigA - (diff * 1000 + R(1, 9) * 50) : a;
    const d = bigA - smallB;
    if (d <= 0 || smallB <= 0) return null;
    return {
      text: `${p.name} has a mass of ${fmt(bigA)} ${kgOrG}. ${q.name} has a mass of ${fmt(smallB)} ${kgOrG}. How much heavier is ${p.name} than ${q.name}?${kgOrG === 'g' ? ' Give your answer in grams.' : ''}`,
      answers: intAnswers(d, kgOrG), value: d, unit: kgOrG,
      hint: 'Draw two bars. The longer bar is the heavier child — the extra part is the answer.',
      visual: V.compare([{ label: p.name, value: bigA }, { label: q.name, value: smallB }], kgOrG),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 13. AREA & PERIMETER (rectangles and squares, square units)
// ═════════════════════════════════════════════════════════════════════════
function rectDims(t) {
  const w = tiers(t, R(2, 6), R(3, 10), R(5, 14));
  const h = tiers(t, R(2, 5), R(2, 8), R(3, 10));
  return { w, h };
}

const areaPerimeterTemplates = [
  function areaRect(t) {
    const { w, h } = rectDims(t);
    const unit = pick(['cm', 'm']);
    const thing = unit === 'm' ? pick(['classroom floor', 'garden plot', 'badminton mat', 'carpet']) : pick(['card', 'photo', 'sticker sheet', 'tile']);
    return {
      text: `A rectangular ${thing} is ${w} ${unit} long and ${h} ${unit} wide. What is its area?`,
      answers: intAnswers(w * h, unit + '²'), value: w * h, unit: unit + '²',
      hint: `Draw it on square grid paper: ${w} squares along, ${h} squares up. Count the squares inside — or count ${h} rows of ${w}.`,
      visual: V.area(w, h, unit),
    };
  },
  function perimeterRect(t) {
    const { w, h } = rectDims(t);
    const unit = pick(['cm', 'm']);
    const thing = unit === 'm' ? pick(['fish pond', 'football field model', 'vegetable patch', 'playground']) : pick(['photo frame', 'notebook', 'name card', 'red packet']);
    return {
      text: `A rectangular ${thing} is ${w} ${unit} long and ${h} ${unit} wide. What is its perimeter?`,
      answers: intAnswers(2 * (w + h), unit), value: 2 * (w + h), unit,
      hint: 'Perimeter is the distance all the way round. Walk your finger around the edge and add all FOUR sides.',
      visual: V.area(w, h, unit),
    };
  },
  function square(t) {
    const s = tiers(t, R(2, 6), R(3, 9), R(5, 10));
    const ask = pick(['area', 'perimeter']);
    return {
      text: `A square has sides of ${s} cm. What is its ${ask}?`,
      answers: ask === 'area' ? intAnswers(s * s, 'cm²') : intAnswers(4 * s, 'cm'),
      value: ask === 'area' ? s * s : 4 * s, unit: ask === 'area' ? 'cm²' : 'cm',
      hint: ask === 'area'
        ? `Draw ${s} rows of ${s} squares and count them.`
        : `A square has 4 equal sides. Draw it and label each side ${s} cm.`,
      visual: V.area(s, s, 'cm'),
    };
  },
  function missingSideFromPerimeter(t) {
    const { w, h } = rectDims(Math.max(1, t));
    const p = 2 * (w + h);
    return {
      text: `A rectangle has a perimeter of ${p} cm. Its length is ${w} cm. What is its width?`,
      answers: intAnswers(h, 'cm'), value: h, unit: 'cm',
      hint: `Draw the rectangle and label both lengths ${w} cm. Take them away from ${p} cm — what is left is shared by the two widths.`,
      visual: V.area(w, h, 'cm'),
    };
  },
  function missingSideFromArea(t) {
    const { w, h } = rectDims(Math.max(1, t));
    return {
      text: `A rectangle has an area of ${w * h} cm². One side is ${w} cm long. How long is the other side?`,
      answers: intAnswers(h, 'cm'), value: h, unit: 'cm',
      hint: `Draw rows of ${w} squares. How many rows make ${w * h} squares?`,
      visual: V.area(w, h, 'cm'),
    };
  },
  function fenceGarden(t) {
    const { w, h } = rectDims(t);
    const per = tiers(t, 1, pick([2, 3, 5]), pick([4, 6, 7, 8, 9]));
    const peri = 2 * (w + h);
    const p = person();
    if (t === 0) {
      return {
        text: `${p.name}'s grandpa wants to put a fence around a rectangular vegetable garden ${w} m long and ${h} m wide. How many metres of fence does he need?`,
        answers: intAnswers(peri, 'm'), value: peri, unit: 'm',
        hint: 'The fence goes all the way round — that is the perimeter. Add all four sides.',
        visual: V.area(w, h, 'm'),
      };
    }
    return {
      text: `${p.name}'s grandpa puts a fence around a rectangular garden ${w} m long and ${h} m wide. The fence costs $${per} for each metre. How much does the whole fence cost?`,
      answers: dollarAnswers(peri * per * 100), value: peri * per, unit: '$',
      hint: 'Step 1: find the perimeter by walking around the edge. Step 2: each metre costs the same — multiply.',
      visual: V.area(w, h, 'm'),
    };
  },
  function tilesCompare(t) {
    const a = rectDims(t), b = rectDims(t);
    const areaA = a.w * a.h, areaB = b.w * b.h;
    if (areaA === areaB) return null;
    const diff = Math.abs(areaA - areaB);
    const [p, q] = people(2);
    return {
      text: `${p.name} drew a rectangle ${a.w} cm by ${a.h} cm. ${q.name} drew a rectangle ${b.w} cm by ${b.h} cm. What is the difference between their areas?`,
      answers: intAnswers(diff, 'cm²'), value: diff, unit: 'cm²',
      hint: 'Draw both rectangles on grid paper and count the squares inside each. Then find the difference.',
      visual: V.area(a.w, a.h, 'cm'),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 14. ANGLES (right angles, turns)
// ═════════════════════════════════════════════════════════════════════════
const SHAPES_RIGHT_ANGLES = [
  { name: 'a rectangle', n: 4 }, { name: 'a square', n: 4 }, { name: 'a right-angled triangle', n: 1 },
  { name: 'an equilateral triangle', n: 0 }, { name: 'a regular hexagon', n: 0 },
];

const angleTemplates = [
  function rightAnglesInShape(t) {
    const pool = t === 0 ? SHAPES_RIGHT_ANGLES.slice(0, 2) : SHAPES_RIGHT_ANGLES;
    const s = pick(pool);
    const { w, h } = rectDims(0);
    return {
      text: `How many right angles are there inside ${s.name}?`,
      answers: intAnswers(s.n), value: s.n, allowZero: true,
      hint: 'Draw the shape. At each corner, hold up the corner of a piece of paper — does it fit exactly? That is a right angle.',
      visual: s.name.includes('square') ? V.area(Math.min(w, h), Math.min(w, h), 'cm') : V.area(w, h, 'cm'),
    };
  },
  function rightAnglesInShapes(t) {
    const rects = tiers(t, R(1, 3), R(2, 5), R(3, 8));
    const tris = tiers(t, 0, R(1, 3), R(2, 6));
    const total = rects * 4 + tris;
    return {
      text: tris
        ? `A poster has ${rects} rectangles and ${tris} right-angled triangles on it. How many right angles are there inside all the shapes altogether?`
        : `A poster has ${rects} rectangles on it. How many right angles are there inside all the rectangles altogether?`,
      answers: intAnswers(total), value: total,
      hint: `Each rectangle has 4 right angles — draw ${rects} groups of 4.${tris ? ' Each right-angled triangle has 1 more.' : ''}`,
      visual: V.groups(rects, 4, 'multiply', '📐'),
    };
  },
  function clockRightAngles(t) {
    const quarter = tiers(t, R(1, 2), R(1, 3), R(2, 4));
    const startHour = pick([12, 3, 6, 9]);
    const startPos = { 12: '12', 3: '3', 6: '6', 9: '9' }[startHour];
    const endNum = ((startHour % 12) + quarter * 3) % 12 || 12;
    return {
      text: `The minute hand of a clock points at ${startPos}. It turns clockwise until it points at ${endNum}. How many right angles has it turned through?`,
      answers: intAnswers(quarter), value: quarter, unit: 'right angles',
      hint: 'A quarter turn (15 minutes) is one right angle. Slide the clock forward and count the quarter turns.',
      visual: V.clock(12, startHour === 12 ? 0 : startHour * 5, quarter * 15),
    };
  },
  function quarterTurnsMinutes(t) {
    const q = tiers(t, R(1, 2), R(1, 4), R(3, 8));
    return {
      text: `Each quarter turn of the minute hand is a right angle and takes 15 minutes. How many minutes pass when the minute hand turns through ${q} right angles?`,
      answers: intAnswers(q * 15, 'min'), value: q * 15, unit: 'min',
      hint: `Draw ${q} jumps of 15 on a number line, or slide the clock forward one quarter at a time.`,
      visual: V.clock(R(1, 11), 0, q * 15),
    };
  },
  function compareRight(t) {
    const items = [
      { thing: 'the corner of a book', ans: 'equal' },
      { thing: 'the angle between the hands of a clock at 3 o\'clock', ans: 'equal' },
      { thing: 'the angle between the hands of a clock at 1 o\'clock', ans: 'smaller' },
      { thing: 'the angle between the hands of a clock at 5 o\'clock', ans: 'greater' },
      { thing: 'the angle between the hands of a clock at 2 o\'clock', ans: 'smaller' },
      { thing: 'the angle between the hands of a clock at 4 o\'clock', ans: 'greater' },
      { thing: 'the angle between the hands of a clock at 9 o\'clock', ans: 'equal' },
    ];
    const it = pick(t === 0 ? items.slice(0, 3) : items);
    const hourMatch = it.thing.match(/at (\d+) o'clock/);
    const hour = hourMatch ? Number(hourMatch[1]) : 3;
    const syn = { equal: ['equal', 'equal to', 'same', 'the same', 'equal to a right angle'], smaller: ['smaller', 'smaller than', 'less', 'less than', 'smaller than a right angle'], greater: ['greater', 'greater than', 'bigger', 'larger', 'more', 'greater than a right angle'] };
    return {
      text: `Is ${it.thing} smaller than, equal to, or greater than a right angle? (Type smaller, equal or greater.)`,
      answers: syn[it.ans], value: 1,
      hint: 'Make a right-angle checker by folding a piece of paper twice. Hold it against the angle — is the angle inside, exactly on, or outside the fold?',
      visual: V.clock(hour, 0, 60),
    };
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 15. BAR GRAPHS (reading and comparing)
// ═════════════════════════════════════════════════════════════════════════
function graphData(t) {
  const scale = tiers(t, 1, pick([2, 5]), pick([5, 10, 50]));
  const cats = shuffle(tiers(t,
    [['Ali', 'Ben', 'Cai'], ['Red', 'Blue', 'Green'], ['Mon', 'Tue', 'Wed']],
    [['Class 3A', 'Class 3B', 'Class 3C'], ['Chicken rice', 'Laksa', 'Prata'], ['Football', 'Netball', 'Swimming']],
    [['January', 'February', 'March'], ['Stall A', 'Stall B', 'Stall C'], ['Block 101', 'Block 102', 'Block 103']]))[0];
  const vals = cats.map(() => R(2, tiers(t, 10, 12, 18)) * scale);
  return { cats, vals, scale };
}

const barGraphTemplates = [
  function readMost(t) {
    const { cats, vals } = graphData(t);
    if (new Set(vals).size < vals.length) return null;
    const max = Math.max(...vals);
    const topic = pick(['books read', 'votes for the class mascot', 'cans collected for recycling']);
    return {
      text: `The bar graph shows the number of ${topic}: ${cats.map((c, i) => `${c} ${vals[i]}`).join(', ')}. What is the greatest number shown?`,
      answers: intAnswers(max), value: max,
      hint: 'Tap each bar. Which bar is the tallest (longest)? Read its value.',
      visual: V.compare(cats.map((c, i) => ({ label: c, value: vals[i] }))),
    };
  },
  function graphDifference(t) {
    const { cats, vals } = graphData(t);
    const [i, j] = shuffle([0, 1, 2]).slice(0, 2);
    if (vals[i] === vals[j]) return null;
    const hi = vals[i] > vals[j] ? i : j, lo = hi === i ? j : i;
    const topic = pick(['pupils who chose each CCA', 'plates sold', 'stickers collected']);
    return {
      text: `The bar graph shows ${topic}: ${cats.map((c, k) => `${c} ${vals[k]}`).join(', ')}. How many more is ${cats[hi]} than ${cats[lo]}?`,
      answers: intAnswers(vals[hi] - vals[lo]), value: vals[hi] - vals[lo],
      hint: `Line up the two bars. The part of ${cats[hi]}'s bar that sticks out past ${cats[lo]}'s is the difference.`,
      visual: V.compare([{ label: cats[hi], value: vals[hi] }, { label: cats[lo], value: vals[lo] }]),
    };
  },
  function graphTotal(t) {
    const { cats, vals } = graphData(t);
    const total = vals.reduce((a, b) => a + b, 0);
    const topic = pick(['ice-creams sold', 'visitors', 'paper planes made']);
    return {
      text: `The bar graph shows ${topic}: ${cats.map((c, k) => `${c} ${vals[k]}`).join(', ')}. What is the total shown by all three bars?`,
      answers: intAnswers(total), value: total,
      hint: 'Tap each bar to read it. Then draw one long part-whole bar with three parts and add.',
      visual: V.compare(cats.map((c, k) => ({ label: c, value: vals[k] }))),
    };
  },
  function graphScale(t) {
    const scale = tiers(t, 2, pick([5, 10]), pick([25, 50, 100]));
    const squares = R(3, 12);
    const p = person();
    return {
      text: `In ${p.name}'s bar graph, each small square on the scale stands for ${scale} pupils. A bar is ${squares} squares tall. How many pupils does the bar show?`,
      answers: intAnswers(squares * scale, 'pupils'), value: squares * scale, unit: 'pupils',
      hint: `Count up the bar in jumps of ${scale} — draw ${squares} jumps on a number line.`,
      visual: V.numberLine(0, Array(squares).fill(scale)),
    };
  },
  function graphMissing(t) {
    const { cats, vals } = graphData(t);
    const total = vals.reduce((a, b) => a + b, 0);
    const k = R(0, 2);
    const shown = cats.map((c, i) => (i === k ? `${c} ?` : `${c} ${vals[i]}`)).join(', ');
    return {
      text: `A bar graph shows ${total} pupils in all: ${shown}. The bar for ${cats[k]} is missing. How many pupils should the bar for ${cats[k]} show?`,
      answers: intAnswers(vals[k], 'pupils'), value: vals[k], unit: 'pupils',
      hint: `Draw a part-whole bar for all ${total} pupils. Two parts are known — the missing bar is the third part.`,
      visual: V.partWhole(cats.map((c, i) => ({ label: c, value: vals[i], hidden: i === k })), 'pupils', ''),
    };
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────
const TEMPLATES = {
  addSub: addSubTemplates,
  mulDiv: mulDivTemplates,
  partWhole: partWholeTemplates,
  comparison: comparisonTemplates,
  multiStep: multiStepTemplates,
  placeValue: placeValueTemplates,
  patterns: patternTemplates,
  fractions: fractionTemplates,
  money: moneyTemplates,
  time: timeTemplates,
  length: lengthTemplates,
  massVolume: massVolumeTemplates,
  areaPerimeter: areaPerimeterTemplates,
  angles: angleTemplates,
  barGraphs: barGraphTemplates,
};

// A safe question used only if every attempt at a topic fails validation.
function fallbackQuestion(topic) {
  const a = R(2, 9), b = pick([6, 7, 8, 9]);
  return finish(topic || 'mulDiv', {
    text: `What is ${a} × ${b}?`,
    answers: intAnswers(a * b), value: a * b,
    hint: `Draw ${a} rows of ${b} dots and count them.`,
    visual: V.array(a, b),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Public: generateQuestion
// ─────────────────────────────────────────────────────────────────────────
export function generateQuestion(topicId, difficulty) {
  const topic = TEMPLATES[topicId] ? topicId : pick(TOPIC_IDS);
  const diff = DIFFICULTIES.includes(difficulty) ? difficulty : 'core';
  const t = tierOf(diff);
  const list = TEMPLATES[topic];
  for (let attempt = 0; attempt < 40; attempt++) {
    const template = pick(list);
    let q = null;
    try {
      q = template(t);
    } catch (err) {
      q = null;
    }
    if (q && validate(q)) {
      const out = finish(topic, q);
      out.difficulty = diff;
      return out;
    }
  }
  const fb = fallbackQuestion(topic);
  fb.difficulty = diff;
  return fb;
}

// ─────────────────────────────────────────────────────────────────────────
// Parent questions (stored in localStorage via core.js)
// ─────────────────────────────────────────────────────────────────────────
function cleanParent(q) {
  if (!q || typeof q !== 'object') return null;
  const text = typeof q.text === 'string' ? q.text.trim() : '';
  let answers = Array.isArray(q.answers) ? q.answers : (q.answers != null ? String(q.answers).split('|') : []);
  answers = answers.map(a => String(a).trim()).filter(Boolean);
  if (!text && !q.image) return null;
  const out = Object.assign({}, q, {
    id: q.id || uid('q'),
    source: 'parent',
    topic: q.topic || 'parent',
    text,
    answers,
    createdAt: q.createdAt || new Date().toISOString(),
  });
  return out;
}

export function loadParentQuestions() {
  const list = readStore(STORE_KEYS.questions, []);
  if (!Array.isArray(list)) return [];
  return list.map(cleanParent).filter(Boolean);
}

export function saveParentQuestions(list) {
  const clean = (Array.isArray(list) ? list : []).map(cleanParent).filter(Boolean);
  return writeStore(STORE_KEYS.questions, clean);
}

// ─────────────────────────────────────────────────────────────────────────
// Public: nextQuestion — the feed's "give me another card".
// ─────────────────────────────────────────────────────────────────────────
const RECENT_LIMIT = 20;
const recentTexts = [];
const recentParentIds = [];

function remember(q) {
  const key = textKey(q);
  recentTexts.push(key);
  while (recentTexts.length > RECENT_LIMIT) recentTexts.shift();
  if (q.source === 'parent') {
    recentParentIds.push(q.id);
    while (recentParentIds.length > RECENT_LIMIT) recentParentIds.shift();
  }
}

function textKey(q) {
  return String((q && q.text) || (q && q.id) || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function pickParent(parents) {
  const usable = parents.filter(p => p.answers.length);
  if (!usable.length) return null;
  const fresh = usable.filter(p => !recentTexts.includes(textKey(p)) && !recentParentIds.includes(p.id));
  if (fresh.length) return pick(fresh);
  // Everything was seen lately: take the one seen longest ago (never the very last card).
  const last = recentTexts[recentTexts.length - 1];
  let best = null, bestIdx = Infinity;
  for (const p of usable) {
    const idx = recentTexts.lastIndexOf(textKey(p));
    if (textKey(p) === last && usable.length > 1) continue;
    if (idx < bestIdx) { bestIdx = idx; best = p; }
  }
  return best || usable[0];
}

function enabledTopics(settings) {
  const chosen = settings && Array.isArray(settings.topics) ? settings.topics.filter(id => TEMPLATES[id]) : null;
  return chosen && chosen.length ? chosen : TOPIC_IDS.slice();
}

export function nextQuestion(settings) {
  let s = settings;
  if (!s) {
    try { s = getSettings(); } catch (err) { s = {}; }
  }
  const share = Math.max(0, Math.min(1, Number(s.parentShare != null ? s.parentShare : 0.5) || 0));
  let parents = [];
  try { parents = loadParentQuestions(); } catch (err) { parents = []; }

  if (parents.length && share > 0 && Math.random() < share) {
    const p = pickParent(parents);
    if (p && (share >= 1 || textKey(p) !== recentTexts[recentTexts.length - 1])) {
      const out = Object.assign({}, p, { source: 'parent' });
      remember(out);
      return out;
    }
  }

  const topics = enabledTopics(s);
  // Rotate topics a little: prefer one not used in the last couple of cards.
  let best = null;
  for (let i = 0; i < 30; i++) {
    const q = generateQuestion(pick(topics), s.difficulty);
    if (!recentTexts.includes(textKey(q))) { best = q; break; }
    if (!best) best = q;
  }
  remember(best);
  return best;
}
