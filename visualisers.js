// ─────────────────────────────────────────────────────────────────────────
// Picture It — built-in visualisers.
//
// Every generated question carries a `visual: { kind, params }`. The feed
// hands that to renderVisual(), which draws an interactive SVG the child
// plays with before the answer box unlocks. Each visualiser:
//   • draws from its params only — it is never told the answer, so it can
//     only ever show the STRUCTURE of the problem (bars, jumps, groups);
//   • calls ctx.interact() the first time the child touches anything, which
//     is what the feed's "picture it first" gate waits for;
//   • leaves a .vis-readout the print stylesheet keeps, so a printed sheet
//     shows the picture as the child left it.
// ─────────────────────────────────────────────────────────────────────────
import { el, formatNumber } from './core.js?v=1.2.0';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PALETTE = ['#A5D6A7', '#90CAF9', '#FFCC80', '#CE93D8', '#EF9A9A', '#80CBC4', '#FFF59D', '#B0BEC5'];
const INK = '#333';
const MUTED = '#8A8A8A';

// ─────────────────────────────────────────────────────────────────────────
// Small SVG helpers.
// ─────────────────────────────────────────────────────────────────────────
function svg(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
  }
  if (children) for (const child of [].concat(children)) if (child) node.appendChild(child);
  return node;
}

function canvas(width, height, label) {
  return svg('svg', {
    class: 'vis-svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': label || 'Interactive picture',
  });
}

function label(x, y, text, opts) {
  const o = opts || {};
  return svg('text', {
    x, y,
    'text-anchor': o.anchor || 'middle',
    'dominant-baseline': o.baseline || 'middle',
    'font-size': o.size || 15,
    'font-weight': o.weight || 500,
    fill: o.fill || INK,
    text: String(text),
  });
}

function slider(name, min, max, value, step, onInput) {
  const input = el('input', { type: 'range', min, max, step: step || 1, value, 'aria-label': name });
  input.addEventListener('input', () => onInput(Number(input.value)));
  const out = el('span', { class: 'vis-slider-value', text: String(value) });
  input.addEventListener('input', () => { out.textContent = String(input.value); });
  return { node: el('label', null, [name, input, out]), input, out };
}

function button(text, onClick, extra) {
  return el('button', { type: 'button', class: 'btn btn-small btn-quiet' + (extra ? ' ' + extra : ''), text, onclick: onClick });
}

function pulse(node) {
  node.classList.remove('pulse');
  void node.offsetWidth;
  node.classList.add('pulse');
}

function shell(container, title) {
  container.innerHTML = '';
  const wrap = el('div', { class: 'vis' });
  if (title) wrap.appendChild(el('div', { class: 'vis-caption', text: title }));
  container.appendChild(wrap);
  return wrap;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// ─────────────────────────────────────────────────────────────────────────
// 1. BAR MODEL — the Singapore bar. Part-whole or comparison.
//    params: { mode: 'part-whole' | 'compare',
//              parts: [{ label, value, hidden? }],   // part-whole
//              bars:  [{ label, value, hidden? }],   // compare (2 bars)
//              totalLabel?, totalHidden?, unit? }
//    The child taps each piece to reveal what it is worth; a hidden piece
//    shows "?" — that is the thing the question asks for.
// ─────────────────────────────────────────────────────────────────────────
function renderBarModel(container, params, ctx) {
  const p = params || {};
  const unit = p.unit || '';
  const wrap = shell(container, p.mode === 'compare'
    ? 'Tap each bar to see how much it is. The "?" is what you need to find.'
    : 'Tap each part of the bar. The "?" is what you need to find.');
  const W = 640;
  const fmt = v => (unit === '$' ? '$' + formatNumber(v) : formatNumber(v) + (unit ? ' ' + unit : ''));
  const revealed = new Set();
  const readout = el('div', { class: 'vis-readout', text: 'Tap a bar to begin.' });

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    if (p.mode === 'compare') drawCompare(); else drawPartWhole();
  }

  function drawPartWhole() {
    const parts = p.parts || [];
    const total = parts.reduce((s, x) => s + Math.max(0, Number(x.value) || 0), 0) || 1;
    const H = 170;
    const s = canvas(W, H, 'Part-whole bar model');
    const left = 30, width = W - 60, top = 60, barH = 46;
    let x = left;
    parts.forEach((part, i) => {
      const w = Math.max(28, width * (Math.max(0, Number(part.value) || 0) / total));
      const showing = revealed.has(i);
      const g = svg('g', {
        class: 'vis-clickable', tabindex: '0', role: 'button',
        'aria-label': (part.label || 'Part ' + (i + 1)) + (showing && !part.hidden ? ', ' + fmt(part.value) : ''),
      });
      g.appendChild(svg('rect', {
        class: 'vis-block', x, y: top, width: w - 2, height: barH, rx: 6,
        fill: part.hidden ? '#FFFFFF' : PALETTE[i % PALETTE.length],
        stroke: INK, 'stroke-width': 1.5, 'stroke-dasharray': part.hidden ? '6 4' : null,
      }));
      g.appendChild(label(x + w / 2, top + barH / 2,
        part.hidden ? '?' : (showing ? fmt(part.value) : '·  ·  ·'),
        { size: part.hidden ? 22 : 15, weight: 700 }));
      g.appendChild(label(x + w / 2, top + barH + 20, part.label || '', { size: 13, fill: MUTED }));
      const tap = () => { revealed.add(i); ctx.interact(); explain(i); draw(); };
      g.addEventListener('click', tap);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
      s.appendChild(g);
      x += w;
    });
    // The brace over the whole bar, with the total (or "?").
    const right = x - 2;
    s.appendChild(svg('path', {
      d: `M${left} ${top - 10} q0 -12 12 -12 H${(left + right) / 2 - 10} l10 -10 l10 10 H${right - 12} q12 0 12 12`,
      fill: 'none', stroke: INK, 'stroke-width': 1.4,
    }));
    const totalText = p.totalHidden ? '? ' + (p.totalLabel || 'altogether') : (p.totalLabel || 'Total') + ' = ' + fmt(total);
    s.appendChild(label((left + right) / 2, top - 38, totalText, { size: 15, weight: 700 }));
    wrap.insertBefore(s, readout);
  }

  function drawCompare() {
    const bars = (p.bars || []).slice(0, 3);
    const max = Math.max(1, ...bars.map(b => Number(b.value) || 0));
    const H = 70 + bars.length * 70;
    const s = canvas(W, H, 'Comparison bar model');
    const left = 140, width = W - left - 40, barH = 40;
    const smallest = Math.min(...bars.map(b => Number(b.value) || 0));
    bars.forEach((bar, i) => {
      const y = 30 + i * 70;
      const w = Math.max(24, width * ((Number(bar.value) || 0) / max));
      const showing = revealed.has(i);
      s.appendChild(label(left - 12, y + barH / 2, bar.label || 'Bar ' + (i + 1), { anchor: 'end', size: 14, weight: 600 }));
      const g = svg('g', { class: 'vis-clickable', tabindex: '0', role: 'button', 'aria-label': bar.label || 'Bar ' + (i + 1) });
      // Same unit drawn on every bar so the "extra" piece stands out.
      const baseW = width * (smallest / max);
      g.appendChild(svg('rect', {
        class: 'vis-block', x: left, y, width: Math.max(20, baseW - 2), height: barH, rx: 6,
        fill: bar.hidden ? '#FFFFFF' : PALETTE[i % PALETTE.length], stroke: INK, 'stroke-width': 1.5,
        'stroke-dasharray': bar.hidden ? '6 4' : null,
      }));
      if (w > baseW + 4) {
        g.appendChild(svg('rect', {
          class: 'vis-block', x: left + baseW, y, width: w - baseW - 2, height: barH, rx: 6,
          fill: bar.hidden ? '#FFFFFF' : '#FFE0B2', stroke: INK, 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
        }));
        g.appendChild(label(left + baseW + (w - baseW) / 2, y + barH + 14, 'more', { size: 12, fill: MUTED }));
      }
      g.appendChild(label(left + w / 2, y + barH / 2,
        bar.hidden ? '?' : (showing ? fmt(bar.value) : '·  ·  ·'), { size: bar.hidden ? 22 : 15, weight: 700 }));
      const tap = () => { revealed.add(i); ctx.interact(); explain(i); draw(); };
      g.addEventListener('click', tap);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
      s.appendChild(g);
    });
    // A dashed guide where the shortest bar ends — "this is the same amount".
    const guideX = left + width * (smallest / max);
    s.appendChild(svg('line', { x1: guideX, y1: 18, x2: guideX, y2: H - 12, stroke: MUTED, 'stroke-dasharray': '4 4' }));
    wrap.insertBefore(s, readout);
  }

  function explain(i) {
    const list = p.mode === 'compare' ? (p.bars || []) : (p.parts || []);
    const piece = list[i];
    if (!piece) return;
    readout.textContent = piece.hidden
      ? `"${piece.label || 'This part'}" is the unknown — that is what you are finding.`
      : `${piece.label || 'This part'} is ${fmt(piece.value)}.`;
    pulse(readout);
  }

  wrap.appendChild(readout);
  draw();
}

// ─────────────────────────────────────────────────────────────────────────
// 2. NUMBER LINE — jumps forward or back.
//    params: { start, end, step, from, jumps: [n, n, …] }   (n may be negative)
//    A slider plays the jumps one at a time.
// ─────────────────────────────────────────────────────────────────────────
function renderNumberLine(container, params, ctx) {
  const p = params || {};
  const jumps = (p.jumps || []).map(Number).filter(n => Number.isFinite(n) && n !== 0);
  const from = Number(p.from) || 0;
  let lo = Number.isFinite(Number(p.start)) ? Number(p.start) : from;
  let hi = Number.isFinite(Number(p.end)) ? Number(p.end) : from + jumps.reduce((a, b) => a + Math.max(0, b), 0);
  let pos = from;
  for (const j of jumps) { pos += j; lo = Math.min(lo, pos); hi = Math.max(hi, pos); }
  if (hi === lo) hi = lo + 10;
  const step = Number(p.step) || niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const wrap = shell(container, 'Slide to make each jump. Where do you land?');
  const W = 660, H = 190, left = 40, right = W - 40, axisY = 130;
  const scale = v => left + (right - left) * ((v - lo) / (hi - lo));
  const readout = el('div', { class: 'vis-readout', text: `Start at ${formatNumber(from)}.` });
  let shown = 0;

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const s = canvas(W, H, 'Number line');
    s.appendChild(svg('line', { x1: left - 10, y1: axisY, x2: right + 10, y2: axisY, stroke: INK, 'stroke-width': 2 }));
    const ticks = Math.round((hi - lo) / step);
    const every = Math.max(1, Math.ceil(ticks / 12));
    for (let t = 0; t <= ticks; t++) {
      const v = lo + t * step;
      const x = scale(v);
      s.appendChild(svg('line', { x1: x, y1: axisY - 7, x2: x, y2: axisY + 7, stroke: INK, 'stroke-width': 1.5 }));
      if (t % every === 0) s.appendChild(label(x, axisY + 24, formatNumber(v), { size: 12, fill: MUTED }));
    }
    let at = from;
    s.appendChild(svg('circle', { cx: scale(from), cy: axisY, r: 7, fill: '#A5D6A7', stroke: INK, 'stroke-width': 1.5 }));
    for (let i = 0; i < shown; i++) {
      const next = at + jumps[i];
      const x1 = scale(at), x2 = scale(next);
      const mid = (x1 + x2) / 2;
      const lift = Math.min(90, 30 + Math.abs(x2 - x1) * 0.35);
      s.appendChild(svg('path', {
        d: `M${x1} ${axisY - 6} Q${mid} ${axisY - lift} ${x2} ${axisY - 6}`,
        fill: 'none', stroke: jumps[i] > 0 ? '#43A047' : '#E53935', 'stroke-width': 2.4,
        'marker-end': 'url(#nlArrow' + (jumps[i] > 0 ? 'Up' : 'Down') + ')',
      }));
      s.appendChild(label(mid, axisY - lift / 2 - 14, (jumps[i] > 0 ? '+' : '−') + formatNumber(Math.abs(jumps[i])),
        { size: 14, weight: 700, fill: jumps[i] > 0 ? '#2E7D32' : '#C62828' }));
      at = next;
    }
    if (shown) {
      s.appendChild(svg('circle', { cx: scale(at), cy: axisY, r: 8, fill: '#FFCC80', stroke: INK, 'stroke-width': 1.5 }));
      s.appendChild(label(scale(at), axisY + 46, shown === jumps.length ? '?' : formatNumber(at), { size: 16, weight: 700 }));
    }
    const defs = svg('defs');
    for (const [id, colour] of [['nlArrowUp', '#43A047'], ['nlArrowDown', '#E53935']]) {
      defs.appendChild(svg('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
        svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: colour })));
    }
    s.insertBefore(defs, s.firstChild);
    wrap.insertBefore(s, controls);
  }

  const controls = el('div', { class: 'vis-controls' });
  const sl = slider('Jumps made', 0, jumps.length, 0, 1, v => {
    shown = v; ctx.interact(); draw();
    if (!v) readout.textContent = `Start at ${formatNumber(from)}.`;
    else if (v < jumps.length) readout.textContent = `After ${v} jump${v > 1 ? 's' : ''} you are at ${formatNumber(from + jumps.slice(0, v).reduce((a, b) => a + b, 0))}.`;
    else readout.textContent = 'That is the last jump. Read where you landed — that is your answer.';
    pulse(readout);
  });
  controls.appendChild(sl.node);
  wrap.appendChild(controls);
  wrap.appendChild(readout);
  draw();
}

function niceStep(range) {
  const rough = range / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  for (const m of [1, 2, 5, 10]) if (pow * m >= rough) return pow * m;
  return pow * 10;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. PLACE VALUE — thousands, hundreds, tens, ones as blocks.
//    params: { number }   Tap a column to hear what it is worth.
// ─────────────────────────────────────────────────────────────────────────
function renderPlaceValue(container, params, ctx) {
  const n = clamp(Math.floor(Number(params && params.number) || 0), 0, 9999);
  const digits = String(n).padStart(4, '0').split('').map(Number);
  const names = ['Thousands', 'Hundreds', 'Tens', 'Ones'];
  const worth = [1000, 100, 10, 1];
  const colours = ['#CE93D8', '#90CAF9', '#A5D6A7', '#FFCC80'];
  const wrap = shell(container, 'Each column is worth 10 times the one on its right. Tap a column.');
  const W = 660, H = 260;
  const s = canvas(W, H, 'Place value chart for ' + n);
  const colW = W / 4;
  const readout = el('div', { class: 'vis-readout', text: `${formatNumber(n)} = ?` });
  digits.forEach((d, c) => {
    const g = svg('g', { class: 'vis-clickable', tabindex: '0', role: 'button', 'aria-label': names[c] + ': ' + d });
    const x0 = c * colW;
    g.appendChild(svg('rect', { x: x0 + 6, y: 6, width: colW - 12, height: H - 12, rx: 12, fill: '#FAFAFA', stroke: '#E0E0E0' }));
    g.appendChild(label(x0 + colW / 2, 26, names[c], { size: 13, weight: 700, fill: MUTED }));
    g.appendChild(label(x0 + colW / 2, H - 26, d, { size: 26, weight: 700 }));
    // Draw d little shapes: big cube, flat, rod, unit.
    for (let k = 0; k < d; k++) {
      const col = k % 3, row = Math.floor(k / 3);
      const cx = x0 + 30 + col * ((colW - 60) / 2.2);
      const cy = 52 + row * 46;
      const size = [30, 28, 10, 12][c];
      const h = [30, 28, 34, 12][c];
      g.appendChild(svg('rect', { class: 'vis-block', x: cx, y: cy, width: size, height: h, rx: 3, fill: colours[c], stroke: INK, 'stroke-width': 1 }));
      if (c === 0) g.appendChild(svg('path', { d: `M${cx} ${cy} l6 -6 h${size} l-6 6 M${cx + size} ${cy} l6 -6 v${h} l-6 6`, fill: 'none', stroke: INK, 'stroke-width': 1 }));
    }
    const tap = () => {
      ctx.interact();
      readout.textContent = `${d} ${names[c].toLowerCase()} = ${formatNumber(d * worth[c])}`;
      pulse(readout);
    };
    g.addEventListener('click', tap);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    s.appendChild(g);
  });
  wrap.appendChild(s);
  const controls = el('div', { class: 'vis-controls' }, [
    button('Show the expanded form', () => {
      ctx.interact();
      readout.textContent = digits.map((d, c) => formatNumber(d * worth[c])).filter((v, i) => digits[i]).join(' + ') + ' = ' + formatNumber(n);
      pulse(readout);
    }),
  ]);
  wrap.appendChild(controls);
  wrap.appendChild(readout);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. EQUAL GROUPS — the picture behind × and ÷.
//    params: { groups, perGroup, mode: 'multiply' | 'share' | 'group',
//              item?: emoji, total? }
//    'multiply' — sliders build the groups.
//    'share'    — total shared equally into `groups`; tap "Deal" to share.
//    'group'    — total put into groups of `perGroup`; tap "Make a group".
// ─────────────────────────────────────────────────────────────────────────
function renderEqualGroups(container, params, ctx) {
  const p = params || {};
  const item = p.item || '●';
  const mode = p.mode || 'multiply';
  let groups = clamp(Number(p.groups) || 3, 1, 12);
  let per = clamp(Number(p.perGroup) || 4, 1, 12);
  const total = Number(p.total) || groups * per;
  const wrap = shell(container, mode === 'multiply'
    ? 'Use the sliders to make the groups. Count them up.'
    : mode === 'share'
      ? `Share ${formatNumber(total)} equally into ${groups} groups. Keep dealing!`
      : `Put ${formatNumber(total)} into groups of ${per}. How many groups can you make?`);
  const readout = el('div', { class: 'vis-readout', text: ' ' });
  const controls = el('div', { class: 'vis-controls' });
  wrap.appendChild(controls);
  wrap.appendChild(readout);
  let dealt = 0;

  function circles(counts, leftover) {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const cols = Math.min(4, counts.length || 1);
    const rows = Math.ceil((counts.length || 1) / cols);
    const cellW = 160, cellH = 130;
    const W = cols * cellW + 20, H = rows * cellH + (leftover ? 60 : 20);
    const s = canvas(W, H, 'Equal groups');
    counts.forEach((count, i) => {
      const cx = 10 + (i % cols) * cellW + cellW / 2;
      const cy = 10 + Math.floor(i / cols) * cellH + cellH / 2;
      s.appendChild(svg('ellipse', { cx, cy, rx: cellW / 2 - 10, ry: cellH / 2 - 10, fill: '#F1F8E9', stroke: '#A5D6A7', 'stroke-width': 2 }));
      const perRow = Math.ceil(Math.sqrt(Math.max(count, 1)));
      for (let k = 0; k < count; k++) {
        const dx = (k % perRow - (perRow - 1) / 2) * 20;
        const dy = (Math.floor(k / perRow) - (Math.ceil(count / perRow) - 1) / 2) * 20;
        s.appendChild(label(cx + dx, cy + dy, item, { size: 16, fill: '#2E7D32' }));
      }
      s.appendChild(label(cx, cy + cellH / 2 - 18, String(count), { size: 12, fill: MUTED }));
    });
    if (leftover) {
      s.appendChild(label(20, H - 30, `Not yet in a group: ${leftover}`, { anchor: 'start', size: 13, fill: MUTED }));
    }
    wrap.insertBefore(s, controls);
  }

  if (mode === 'multiply') {
    const say = () => {
      readout.textContent = `${groups} groups of ${per} — count them all.`;
      pulse(readout);
    };
    const a = slider('Groups', 1, 10, groups, 1, v => { groups = v; ctx.interact(); circles(Array(groups).fill(per)); say(); });
    const b = slider('In each', 1, 10, per, 1, v => { per = v; ctx.interact(); circles(Array(groups).fill(per)); say(); });
    controls.append(a.node, b.node);
    circles(Array(groups).fill(per));
    readout.textContent = `${groups} groups of ${per}.`;
  } else if (mode === 'share') {
    const counts = Array(groups).fill(0);
    const deal = (howMany) => {
      ctx.interact();
      for (let k = 0; k < howMany && dealt < total; k++) {
        counts[dealt % groups]++;
        dealt++;
      }
      circles(counts, total - dealt);
      readout.textContent = dealt >= total
        ? 'All shared! Count how many are in ONE group.'
        : `${dealt} dealt out, ${total - dealt} still to share.`;
      pulse(readout);
    };
    controls.append(
      button('Deal one round', () => deal(groups)),
      button('Deal them all', () => deal(total)),
      button('Start again', () => { counts.fill(0); dealt = 0; circles(counts, total); readout.textContent = ' '; }),
    );
    circles(counts, total);
  } else {
    const counts = [];
    let left = total;
    const make = (all) => {
      ctx.interact();
      do {
        if (left < per) break;
        counts.push(per);
        left -= per;
      } while (all);
      circles(counts, left);
      readout.textContent = left < per
        ? (left ? `No more full groups — ${left} left over. How many groups did you make?` : 'No more left! How many groups did you make?')
        : `${counts.length} group${counts.length === 1 ? '' : 's'} so far.`;
      pulse(readout);
    };
    controls.append(
      button('Make a group', () => make(false)),
      button('Make them all', () => make(true)),
      button('Start again', () => { counts.length = 0; left = total; circles(counts, left); readout.textContent = ' '; }),
    );
    circles(counts, left);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. ARRAY — rows × columns of dots, for times tables and area.
//    params: { rows, cols }   A highlight walks across the rows.
// ─────────────────────────────────────────────────────────────────────────
function renderArray(container, params, ctx) {
  const rows = clamp(Number(params && params.rows) || 3, 1, 12);
  const cols = clamp(Number(params && params.cols) || 4, 1, 12);
  const wrap = shell(container, 'Tap a row to count it. How many rows? How many in each?');
  const cell = 36, pad = 30;
  const W = cols * cell + pad * 2, H = rows * cell + pad * 2;
  const s = canvas(W, H, `Array of ${rows} rows and ${cols} columns`);
  const lit = new Set();
  const readout = el('div', { class: 'vis-readout', text: `${rows} rows of ${cols}` });
  for (let r = 0; r < rows; r++) {
    const g = svg('g', { class: 'vis-clickable', tabindex: '0', role: 'button', 'aria-label': 'Row ' + (r + 1) });
    g.appendChild(svg('rect', { x: pad - 6, y: pad + r * cell + 2, width: cols * cell + 12, height: cell - 4, rx: 10, fill: 'transparent' }));
    for (let c = 0; c < cols; c++) {
      g.appendChild(svg('circle', { class: 'vis-block', cx: pad + c * cell + cell / 2, cy: pad + r * cell + cell / 2, r: 11, fill: '#C8E6C9', stroke: INK, 'stroke-width': 1 }));
    }
    const tap = () => {
      ctx.interact();
      if (lit.has(r)) lit.delete(r); else lit.add(r);
      g.querySelectorAll('circle').forEach(dot => dot.setAttribute('fill', lit.has(r) ? '#66BB6A' : '#C8E6C9'));
      readout.textContent = lit.size
        ? `${lit.size} row${lit.size > 1 ? 's' : ''} lit × ${cols} = ${lit.size * cols} dots`
        : `${rows} rows of ${cols}`;
      pulse(readout);
    };
    g.addEventListener('click', tap);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    s.appendChild(g);
  }
  wrap.appendChild(s);
  wrap.appendChild(readout);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. FRACTION BARS — shade parts of a whole; optionally compare two.
//    params: { denominator, shaded?, compare?: { denominator } , whole? }
//    'whole' is a quantity (e.g. 24 sweets) shown under each part.
// ─────────────────────────────────────────────────────────────────────────
function renderFractionBars(container, params, ctx) {
  const p = params || {};
  const bars = [{ den: clamp(Number(p.denominator) || 4, 1, 12), shaded: new Set() }];
  if (p.compare && p.compare.denominator) bars.push({ den: clamp(Number(p.compare.denominator), 1, 12), shaded: new Set() });
  const preset = clamp(Number(p.shaded) || 0, 0, bars[0].den);
  for (let i = 0; i < preset; i++) bars[0].shaded.add(i);
  const whole = Number(p.whole) || 0;
  const wrap = shell(container, bars.length > 1
    ? 'Tap the parts to shade them. Which shaded amount is bigger?'
    : 'Tap the parts to shade them. How many parts make the fraction?');
  const W = 640, barH = 54;
  const H = 30 + bars.length * (barH + 52);
  const readout = el('div', { class: 'vis-readout', text: ' ' });

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const s = canvas(W, H, 'Fraction bars');
    const left = 30, width = W - 60;
    bars.forEach((bar, b) => {
      const y = 20 + b * (barH + 52);
      const partW = width / bar.den;
      for (let i = 0; i < bar.den; i++) {
        const on = bar.shaded.has(i);
        const r = svg('rect', {
          class: 'vis-block vis-clickable', x: left + i * partW, y, width: partW, height: barH,
          fill: on ? PALETTE[b] : '#FFFFFF', stroke: INK, 'stroke-width': 1.5, tabindex: '0', role: 'button',
          'aria-label': `Part ${i + 1} of ${bar.den}${on ? ', shaded' : ''}`,
        });
        const tap = () => { ctx.interact(); if (bar.shaded.has(i)) bar.shaded.delete(i); else bar.shaded.add(i); draw(); say(); };
        r.addEventListener('click', tap);
        r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
        s.appendChild(r);
        s.appendChild(label(left + i * partW + partW / 2, y + barH / 2, whole ? formatNumber(whole / bar.den) : `1/${bar.den}`,
          { size: bar.den > 8 ? 11 : 13, fill: on ? INK : MUTED }));
      }
      s.appendChild(label(left, y + barH + 20, `${bar.shaded.size}/${bar.den} shaded`, { anchor: 'start', size: 13, weight: 600 }));
    });
    wrap.insertBefore(s, readout);
  }

  function say() {
    const parts = bars.map(bar => `${bar.shaded.size}/${bar.den}`);
    if (bars.length === 1) {
      readout.textContent = whole
        ? `${parts[0]} of ${formatNumber(whole)} — each part is ${formatNumber(whole / bars[0].den)}.`
        : `${parts[0]} of the bar is shaded.`;
    } else {
      const a = bars[0].shaded.size / bars[0].den, b = bars[1].shaded.size / bars[1].den;
      readout.textContent = `${parts[0]} ${a > b ? 'is more than' : a < b ? 'is less than' : 'is the same as'} ${parts[1]}`;
    }
    pulse(readout);
  }

  wrap.appendChild(readout);
  draw();
  if (preset) say();
}

// ─────────────────────────────────────────────────────────────────────────
// 7. CLOCK — read and move time.
//    params: { hours, minutes, addMinutes? }
//    The slider moves the clock forward from the start time.
// ─────────────────────────────────────────────────────────────────────────
function renderClock(container, params, ctx) {
  const p = params || {};
  const startH = clamp(Number(p.hours) || 3, 0, 23);
  const startM = clamp(Number(p.minutes) || 0, 0, 59);
  const maxAdd = clamp(Number(p.addMinutes) || 180, 15, 12 * 60);
  const wrap = shell(container, 'Slide to move the clock forward. Watch both hands.');
  const readout = el('div', { class: 'vis-readout', text: '' });
  let added = 0;

  function timeText(totalMinutes) {
    const t = ((totalMinutes % 1440) + 1440) % 1440;
    const h24 = Math.floor(t / 60), m = t % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
  }

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const S = 260, c = S / 2, R = 110;
    const s = canvas(S, S, 'Clock');
    s.appendChild(svg('circle', { cx: c, cy: c, r: R, fill: '#FFFFFF', stroke: INK, 'stroke-width': 3 }));
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const long = i % 5 === 0;
      s.appendChild(svg('line', {
        x1: c + Math.sin(a) * (R - (long ? 12 : 6)), y1: c - Math.cos(a) * (R - (long ? 12 : 6)),
        x2: c + Math.sin(a) * (R - 2), y2: c - Math.cos(a) * (R - 2),
        stroke: long ? INK : '#BDBDBD', 'stroke-width': long ? 2 : 1,
      }));
    }
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      s.appendChild(label(c + Math.sin(a) * (R - 28), c - Math.cos(a) * (R - 28), n, { size: 16, weight: 700 }));
    }
    const total = startH * 60 + startM + added;
    const m = total % 60;
    const h = (total / 60) % 12;
    const hA = (h / 12) * Math.PI * 2, mA = (m / 60) * Math.PI * 2;
    s.appendChild(svg('line', { x1: c, y1: c, x2: c + Math.sin(hA) * 58, y2: c - Math.cos(hA) * 58, stroke: INK, 'stroke-width': 7, 'stroke-linecap': 'round' }));
    s.appendChild(svg('line', { x1: c, y1: c, x2: c + Math.sin(mA) * 88, y2: c - Math.cos(mA) * 88, stroke: '#43A047', 'stroke-width': 4, 'stroke-linecap': 'round' }));
    s.appendChild(svg('circle', { cx: c, cy: c, r: 6, fill: INK }));
    s.style.maxWidth = '280px';
    wrap.insertBefore(s, controls);
    const hrs = Math.floor(added / 60), mins = added % 60;
    readout.textContent = added
      ? `${timeText(startH * 60 + startM)} + ${hrs ? hrs + ' h ' : ''}${mins ? mins + ' min' : ''} → ${timeText(total)}`
      : `Start: ${timeText(total)}`;
  }

  const controls = el('div', { class: 'vis-controls' });
  const sl = slider('Minutes later', 0, maxAdd, 0, 5, v => { added = v; ctx.interact(); draw(); pulse(readout); });
  controls.appendChild(sl.node);
  controls.appendChild(button('+1 hour', () => {
    added = Math.min(maxAdd, added + 60); sl.input.value = added; sl.out.textContent = added; ctx.interact(); draw(); pulse(readout);
  }));
  controls.appendChild(button('+15 min', () => {
    added = Math.min(maxAdd, added + 15); sl.input.value = added; sl.out.textContent = added; ctx.interact(); draw(); pulse(readout);
  }));
  wrap.appendChild(controls);
  wrap.appendChild(readout);
  draw();
}

// ─────────────────────────────────────────────────────────────────────────
// 8. MONEY — notes and coins laid out to count.
//    params: { amounts: [cents, …], labels?: [..] }
//    Each amount is shown as the fewest Singapore notes and coins. Tap a pile
//    to count it.
// ─────────────────────────────────────────────────────────────────────────
const SG_MONEY = [
  { cents: 5000, text: '$50', note: true, fill: '#B3E5FC' },
  { cents: 1000, text: '$10', note: true, fill: '#F8BBD0' },
  { cents: 500, text: '$5', note: true, fill: '#C8E6C9' },
  { cents: 200, text: '$2', note: true, fill: '#E1BEE7' },
  { cents: 100, text: '$1', note: false, fill: '#FFE082' },
  { cents: 50, text: '50¢', note: false, fill: '#E0E0E0' },
  { cents: 20, text: '20¢', note: false, fill: '#E0E0E0' },
  { cents: 10, text: '10¢', note: false, fill: '#E0E0E0' },
  { cents: 5, text: '5¢', note: false, fill: '#E0E0E0' },
];

function breakDown(cents) {
  const out = [];
  let left = Math.round(cents);
  for (const d of SG_MONEY) {
    while (left >= d.cents) { out.push(d); left -= d.cents; }
  }
  return out;
}

function dollars(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function renderMoney(container, params, ctx) {
  const p = params || {};
  const amounts = (p.amounts || []).map(Number).filter(n => n > 0).slice(0, 3);
  const labels = p.labels || [];
  const wrap = shell(container, 'Tap each pile to count the money in it.');
  const readout = el('div', { class: 'vis-readout', text: ' ' });
  const W = 660, rowH = 110;
  const H = 20 + amounts.length * rowH;
  const s = canvas(W, H, 'Money');
  amounts.forEach((cents, row) => {
    const y = 14 + row * rowH;
    const pile = breakDown(cents);
    const g = svg('g', { class: 'vis-clickable', tabindex: '0', role: 'button', 'aria-label': labels[row] || 'Pile ' + (row + 1) });
    g.appendChild(svg('rect', { x: 4, y: y - 6, width: W - 8, height: rowH - 10, rx: 12, fill: '#FAFAFA', stroke: '#EEEEEE' }));
    g.appendChild(label(16, y + 12, labels[row] || 'Pile ' + (row + 1), { anchor: 'start', size: 13, weight: 700, fill: MUTED }));
    let x = 16;
    pile.slice(0, 18).forEach(d => {
      if (d.note) {
        g.appendChild(svg('rect', { class: 'vis-block', x, y: y + 26, width: 64, height: 40, rx: 5, fill: d.fill, stroke: INK, 'stroke-width': 1 }));
        g.appendChild(label(x + 32, y + 46, d.text, { size: 14, weight: 700 }));
        x += 70;
      } else {
        const r = d.cents === 100 ? 20 : d.cents >= 20 ? 17 : 14;
        g.appendChild(svg('circle', { class: 'vis-block', cx: x + r, cy: y + 46, r, fill: d.fill, stroke: INK, 'stroke-width': 1 }));
        g.appendChild(label(x + r, y + 46, d.text, { size: r > 16 ? 11 : 9, weight: 700 }));
        x += r * 2 + 6;
      }
    });
    if (pile.length > 18) g.appendChild(label(x + 20, y + 46, '…', { size: 18 }));
    const tap = () => {
      ctx.interact();
      readout.textContent = `${labels[row] || 'This pile'}: ${dollars(cents)}`;
      pulse(readout);
    };
    g.addEventListener('click', tap);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    s.appendChild(g);
  });
  wrap.appendChild(s);
  wrap.appendChild(el('div', { class: 'vis-controls' }, [
    button('Remember: $1 = 100¢', () => { ctx.interact(); readout.textContent = '$1 = 100 cents, so $3.45 is 3 dollars and 45 cents.'; pulse(readout); }),
  ]));
  wrap.appendChild(readout);
}

// ─────────────────────────────────────────────────────────────────────────
// 9. AREA & PERIMETER GRID — a rectangle on square paper.
//    params: { width, height, unit? }   Sliders resize it; toggle between
//    counting the squares inside and walking the edge.
// ─────────────────────────────────────────────────────────────────────────
function renderAreaGrid(container, params, ctx) {
  const p = params || {};
  let w = clamp(Number(p.width) || 5, 1, 14);
  let h = clamp(Number(p.height) || 3, 1, 10);
  const unit = p.unit || 'cm';
  const lockSize = !!p.lockSize;
  let view = 'area';
  const wrap = shell(container, 'Count the squares inside for AREA. Walk around the edge for PERIMETER.');
  const readout = el('div', { class: 'vis-readout', text: ' ' });
  const controls = el('div', { class: 'vis-controls' });

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const cell = 34, gridW = 16, gridH = 11;
    const W = gridW * cell + 20, H = gridH * cell + 20;
    const s = canvas(W, H, `Rectangle ${w} by ${h}`);
    for (let i = 0; i <= gridW; i++) s.appendChild(svg('line', { x1: 10 + i * cell, y1: 10, x2: 10 + i * cell, y2: 10 + gridH * cell, stroke: '#EEEEEE' }));
    for (let j = 0; j <= gridH; j++) s.appendChild(svg('line', { x1: 10, y1: 10 + j * cell, x2: 10 + gridW * cell, y2: 10 + j * cell, stroke: '#EEEEEE' }));
    const ox = 10 + cell, oy = 10 + cell;
    if (view === 'area') {
      let n = 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          n++;
          s.appendChild(svg('rect', { class: 'vis-block', x: ox + c * cell + 1, y: oy + r * cell + 1, width: cell - 2, height: cell - 2, fill: '#C8E6C9' }));
          if (w * h <= 60) s.appendChild(label(ox + c * cell + cell / 2, oy + r * cell + cell / 2, n, { size: 11, fill: '#2E7D32' }));
        }
      }
    }
    s.appendChild(svg('rect', {
      x: ox, y: oy, width: w * cell, height: h * cell, fill: 'none',
      stroke: view === 'perimeter' ? '#E53935' : INK, 'stroke-width': view === 'perimeter' ? 4 : 2.5,
      'stroke-dasharray': view === 'perimeter' ? '10 6' : null,
    }));
    s.appendChild(label(ox + (w * cell) / 2, oy - 14, `${w} ${unit}`, { size: 14, weight: 700 }));
    s.appendChild(label(ox + w * cell + 26, oy + (h * cell) / 2, `${h} ${unit}`, { size: 14, weight: 700 }));
    wrap.insertBefore(s, controls);
    readout.textContent = view === 'area'
      ? `${h} rows of ${w} squares — count them all for the area.`
      : `Walk the edge: ${w} + ${h} + ${w} + ${h} — add the four sides.`;
  }

  if (!lockSize) {
    controls.append(
      slider('Length', 1, 14, w, 1, v => { w = v; ctx.interact(); draw(); pulse(readout); }).node,
      slider('Breadth', 1, 10, h, 1, v => { h = v; ctx.interact(); draw(); pulse(readout); }).node,
    );
  }
  const areaBtn = button('Count the squares', () => { view = 'area'; ctx.interact(); draw(); pulse(readout); });
  const periBtn = button('Walk the edge', () => { view = 'perimeter'; ctx.interact(); draw(); pulse(readout); });
  controls.append(areaBtn, periBtn);
  wrap.appendChild(controls);
  wrap.appendChild(readout);
  draw();
}

// ─────────────────────────────────────────────────────────────────────────
// 10. MEASURING — a beaker (ml/ℓ), a scale (g/kg) or a ruler (cm/m).
//     params: { kind: 'volume' | 'mass' | 'length', values: [n, …],
//               unit, max?, labels? }
//     Tap "Pour" / "Add" / "Lay down" to put each amount in one at a time.
// ─────────────────────────────────────────────────────────────────────────
function renderMeasure(container, params, ctx) {
  const p = params || {};
  const kind = p.kind || 'volume';
  const values = (p.values || []).map(Number).filter(n => n > 0).slice(0, 4);
  const unit = p.unit || (kind === 'volume' ? 'ml' : kind === 'mass' ? 'g' : 'cm');
  const sum = values.reduce((a, b) => a + b, 0);
  const max = Number(p.max) || niceMax(sum);
  const labels = p.labels || [];
  const verb = kind === 'volume' ? 'Pour in' : kind === 'mass' ? 'Put on' : 'Lay down';
  const wrap = shell(container, `${verb} each amount and read the scale.`);
  const readout = el('div', { class: 'vis-readout', text: `0 ${unit}` });
  const controls = el('div', { class: 'vis-controls' });
  let added = 0;

  function draw() {
    const old = wrap.querySelector('svg');
    if (old) old.remove();
    const level = values.slice(0, added).reduce((a, b) => a + b, 0);
    let s;
    if (kind === 'length') {
      const W = 660, H = 150, left = 30, right = W - 30;
      s = canvas(W, H, 'Ruler');
      s.appendChild(svg('rect', { x: left, y: 90, width: right - left, height: 40, rx: 4, fill: '#FFF8E1', stroke: INK }));
      const step = niceStep(max);
      for (let v = 0; v <= max; v += step / 2) {
        const x = left + (right - left) * (v / max);
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-9;
        s.appendChild(svg('line', { x1: x, y1: 90, x2: x, y2: 90 + (major ? 16 : 9), stroke: INK }));
        if (major) s.appendChild(label(x, 120, formatNumber(v), { size: 11 }));
      }
      let x = left;
      values.slice(0, added).forEach((v, i) => {
        const wpx = (right - left) * (v / max);
        s.appendChild(svg('rect', { class: 'vis-block', x, y: 40 + (i % 2) * 6, width: wpx, height: 30, rx: 6, fill: PALETTE[i], stroke: INK }));
        s.appendChild(label(x + wpx / 2, 55 + (i % 2) * 6, `${formatNumber(v)} ${unit}`, { size: 12, weight: 700 }));
        x += wpx;
      });
    } else if (kind === 'mass') {
      const W = 360, H = 300, c = W / 2;
      s = canvas(W, H, 'Weighing scale');
      s.appendChild(svg('rect', { x: c - 110, y: 120, width: 220, height: 160, rx: 22, fill: '#ECEFF1', stroke: INK, 'stroke-width': 2 }));
      s.appendChild(svg('circle', { cx: c, cy: 200, r: 64, fill: '#FFFFFF', stroke: INK, 'stroke-width': 2 }));
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        s.appendChild(svg('line', { x1: c + Math.sin(a) * 52, y1: 200 - Math.cos(a) * 52, x2: c + Math.sin(a) * 62, y2: 200 - Math.cos(a) * 62, stroke: INK }));
        if (i % 2 === 0) s.appendChild(label(c + Math.sin(a) * 40, 200 - Math.cos(a) * 40, formatNumber((max / 10) * i), { size: 9 }));
      }
      const a = -Math.PI * 0.75 + Math.min(1, level / max) * Math.PI * 1.5;
      s.appendChild(svg('line', { x1: c, y1: 200, x2: c + Math.sin(a) * 56, y2: 200 - Math.cos(a) * 56, stroke: '#E53935', 'stroke-width': 3, 'stroke-linecap': 'round' }));
      s.appendChild(svg('rect', { x: c - 120, y: 100, width: 240, height: 16, rx: 6, fill: '#B0BEC5', stroke: INK }));
      values.slice(0, added).forEach((v, i) => {
        const bx = c - 100 + (i % 4) * 52;
        s.appendChild(svg('rect', { class: 'vis-block', x: bx, y: 58, width: 46, height: 40, rx: 6, fill: PALETTE[i], stroke: INK }));
        s.appendChild(label(bx + 23, 78, formatNumber(v), { size: 11, weight: 700 }));
      });
    } else {
      const W = 320, H = 320;
      s = canvas(W, H, 'Measuring beaker');
      const bx = 90, by = 30, bw = 140, bh = 260;
      const fillH = bh * Math.min(1, level / max);
      s.appendChild(svg('rect', { class: 'vis-block', x: bx + 2, y: by + bh - fillH, width: bw - 4, height: fillH, fill: '#90CAF9', opacity: 0.85 }));
      s.appendChild(svg('path', { d: `M${bx} ${by} V${by + bh} H${bx + bw} V${by}`, fill: 'none', stroke: INK, 'stroke-width': 3 }));
      for (let i = 0; i <= 10; i++) {
        const y = by + bh - (bh * i) / 10;
        s.appendChild(svg('line', { x1: bx, y1: y, x2: bx + (i % 2 === 0 ? 26 : 14), y2: y, stroke: INK }));
        if (i % 2 === 0) s.appendChild(label(bx - 8, y, formatNumber((max / 10) * i), { anchor: 'end', size: 11 }));
      }
      s.appendChild(label(bx + bw / 2, by + bh + 18, unit, { size: 12, fill: MUTED }));
      s.style.maxWidth = '340px';
    }
    wrap.insertBefore(s, controls);
    readout.textContent = added
      ? values.slice(0, added).map(v => formatNumber(v)).join(' + ') + ` = ${formatNumber(level)} ${unit}`
      : `0 ${unit}`;
  }

  const addBtn = button(`${verb} the next one`, () => {
    if (added >= values.length) return;
    added++;
    ctx.interact();
    draw();
    pulse(readout);
    if (added >= values.length) addBtn.disabled = true;
  });
  controls.append(addBtn, button('Empty it', () => { added = 0; addBtn.disabled = false; draw(); }));
  if (labels.length) controls.appendChild(el('span', { class: 'vis-caption', text: labels.join(' · ') }));
  wrap.appendChild(controls);
  wrap.appendChild(readout);
  draw();
}

function niceMax(n) {
  if (n <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (pow * m >= n * 1.15) return pow * m;
  return pow * 10;
}

// ─────────────────────────────────────────────────────────────────────────
// The registry. `name` is what the Parent Studio shows; `sample` is what
// a parent can preview each one with.
// ─────────────────────────────────────────────────────────────────────────
export const VISUALISERS = {
  barModel: {
    name: 'Bar model',
    render: renderBarModel,
    sample: { mode: 'part-whole', parts: [{ label: 'boys', value: 236 }, { label: 'girls', value: 187, hidden: true }], totalLabel: 'pupils', unit: '' },
  },
  numberLine: {
    name: 'Number line',
    render: renderNumberLine,
    sample: { from: 1250, jumps: [300, 40, 6] },
  },
  placeValue: {
    name: 'Place value chart',
    render: renderPlaceValue,
    sample: { number: 3407 },
  },
  equalGroups: {
    name: 'Equal groups',
    render: renderEqualGroups,
    sample: { groups: 4, perGroup: 6, mode: 'multiply', item: '🍪' },
  },
  array: {
    name: 'Array (rows × columns)',
    render: renderArray,
    sample: { rows: 6, cols: 7 },
  },
  fractionBars: {
    name: 'Fraction bars',
    render: renderFractionBars,
    sample: { denominator: 4, compare: { denominator: 8 } },
  },
  clock: {
    name: 'Clock',
    render: renderClock,
    sample: { hours: 9, minutes: 40, addMinutes: 150 },
  },
  money: {
    name: 'Money',
    render: renderMoney,
    sample: { amounts: [1245, 360], labels: ['Mum has', 'Dad has'] },
  },
  areaGrid: {
    name: 'Area & perimeter grid',
    render: renderAreaGrid,
    sample: { width: 6, height: 4, unit: 'cm' },
  },
  measure: {
    name: 'Measuring (beaker / scale / ruler)',
    render: renderMeasure,
    sample: { kind: 'volume', values: [350, 425], unit: 'ml' },
  },
};

// Draws a visualiser into `container`. ctx.onInteract fires ONCE, the first
// time the child touches it. Returns false when the kind is unknown, so the
// caller can fall back to "draw it on paper".
export function renderVisual(kind, params, container, options) {
  const entry = VISUALISERS[kind];
  if (!entry) return false;
  let touched = false;
  const ctx = {
    interact() {
      if (touched) return;
      touched = true;
      if (options && typeof options.onInteract === 'function') options.onInteract();
    },
  };
  try {
    entry.render(container, params || entry.sample, ctx);
    return true;
  } catch (error) {
    console.error('Visualiser failed', kind, error);
    container.innerHTML = '';
    container.appendChild(el('p', { class: 'vis-caption', text: 'This picture could not be drawn. Try drawing it on paper instead!' }));
    return false;
  }
}
