// print.js — print chosen questions as an A4 worksheet (v1.5.3).
//
// Written answers are laid out exam style: blank space for working under each
// part, then a short "Ans: (a) ____" line at the bottom right of that part.
//
// Each page holds ONE large question, or TWO small ones with the second
// starting exactly half way down. Small or large is MEASURED after the
// pictures have loaded, so a tall diagram never spills into the other half.

const PAGE_MM = 276;            // A4 297mm minus 10mm margins, less a hair for rounding
const HALF_MM = PAGE_MM / 2;
const LONG_TEXT = 500;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Split a question into its stem and parts (a), (b), (c)…
 * "(a)" may sit anywhere after a space; a bare "a)" or "a." must start a line
 * or follow the end of a sentence. Letters are LOWERCASE and must run a, b, c…
 * in order, at least two of them — so "E. coli", an "(A) (B) (C)" option list
 * and a roman "(i) (ii)" are never split. Render-time only; text is not changed.
 */
export function splitParts(text) {
  const s = String(text || '');
  const re = /(^|\s)(?:\(([a-h])\)|([a-h])[.)])(?=\s)/g;
  const marks = [];
  let m; let want = 'a';
  while ((m = re.exec(s))) {
    const letter = m[2] || m[3];
    if (letter !== want) continue;
    const start = m.index + m[1].length;
    if (m[3]) {
      const before = s.slice(0, start).replace(/[ \t]+$/, '');
      if (before && !/[\n.?!:]$/.test(before)) continue;
    }
    marks.push({ letter, at: start, body: m.index + m[0].length });
    want = String.fromCharCode(want.charCodeAt(0) + 1);
  }
  if (marks.length < 2) return { stem: s.trim(), parts: [] };
  const parts = marks.map((mk, i) => ({
    label: '(' + mk.letter + ')',
    text: s.slice(mk.body, i + 1 < marks.length ? marks[i + 1].at : s.length).trim(),
  }));
  return { stem: s.slice(0, marks[0].at).trim(), parts };
}

/** Working space plus a right-aligned answer line. label = "(a)" or "" for a question with no parts. */
function answerSpace(label) {
  return '<div class="work"></div><div class="ans">Ans:' + (label ? ' ' + esc(label) : '') +
    ' <span class="blank"></span></div>';
}

/** One question as print HTML. item = { num, stem, options:[{label,text}], diagram, type }. */
export function questionHtml(item) {
  const { stem, parts } = splitParts(item.stem);
  const mcq = item.type === 'mcq' && item.options && item.options.length;
  let h = '<div class="q"><div class="qhead"><span class="num">' + esc(item.num) + '.</span>' +
    '<div class="stem">' + esc(stem) + '</div></div>';
  if (item.diagram) h += '<div class="fig"><img src="' + esc(item.diagram) + '" alt=""></div>';
  if (mcq) {
    h += '<ol class="opts">' + item.options.map(o =>
      '<li><b>(' + esc(o.label) + ')</b> ' + esc(o.text) + '</li>').join('') + '</ol>';
  }
  if (parts.length) {
    for (const p of parts) {
      const part = '<div class="part"><span class="plabel">' + esc(p.label) + '</span><div class="ptext">' + esc(p.text) + '</div></div>';
      h += mcq ? part : '<div class="seg">' + part + answerSpace(p.label) + '</div>';
    }
  }
  if (mcq) h += '<div class="bracket">Answer: (&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</div>';
  else if (!parts.length) h += '<div class="seg">' + answerSpace('') + '</div>';
  return h + '</div>';
}

/** A first guess before measuring: many parts, long text or a picture make a question large. */
export function guessLarge(item) {
  const { parts } = splitParts(item.stem);
  return parts.length >= 2 || String(item.stem || '').length > LONG_TEXT;
}

/** Pack sizes (true = large) into pages: [[i], [i, j], …]. Small + small share a page. */
export function packPages(large) {
  const pages = [];
  let open = null;
  large.forEach((big, i) => {
    if (big) { open = null; pages.push({ full: true, items: [i] }); return; }
    if (open) { open.items.push(i); open = null; return; }
    open = { full: false, items: [i] };
    pages.push(open);
  });
  return pages;
}

const CSS = `
@page { size: A4 portrait; margin: 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Century Gothic", "Nunito", "Segoe UI", Arial, sans-serif; color: #111; font-size: 12.5pt; line-height: 1.5; }
.page { width: 190mm; height: ${PAGE_MM}mm; overflow: hidden; break-after: page; page-break-after: always; display: flex; flex-direction: column; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page.full { height: auto; min-height: ${PAGE_MM}mm; overflow: visible; }
.half { height: ${HALF_MM}mm; overflow: hidden; display: flex; flex-direction: column; }
.half > .q, .page.full > .q { flex: 1; display: flex; flex-direction: column; }
.half + .half { border-top: 1px dashed #bbb; padding-top: 4mm; }
.q { padding: 2mm 0; }
.qhead { display: flex; gap: 3mm; }
.num { font-weight: 700; min-width: 7mm; }
.stem, .ptext { white-space: pre-wrap; flex: 1; }
.fig { margin: 3mm 0 3mm 10mm; }
.fig img { display: block; max-width: 100%; height: auto; }
.half .fig img { max-height: 70mm; }
.full .fig img, .measure .fig img { max-height: 150mm; }
.measure.small .fig img { max-height: 70mm; }
.opts { list-style: none; margin: 2mm 0 0 10mm; padding: 0; display: grid; gap: 1mm; }
.part { display: flex; gap: 3mm; margin: 3mm 0 0 10mm; }
.plabel { font-weight: 700; min-width: 7mm; }
.seg { flex: 1; display: flex; flex-direction: column; }
.work { flex: 1; min-height: 22mm; }
.ans { text-align: right; font-weight: 600; margin: 1mm 0 2mm; white-space: nowrap; }
.ans .blank { display: inline-block; width: 42mm; border-bottom: 1px solid #111; margin-left: 2mm; vertical-align: baseline; height: 1.1em; }
.bracket { text-align: right; margin-top: 4mm; font-weight: 600; }
.measure { position: absolute; left: -9999px; top: 0; width: 190mm; }
`;

function waitForImages(doc, ms = 8000) {
  const imgs = Array.from(doc.images);
  return Promise.race([
    Promise.all(imgs.map(img => img.complete ? null : new Promise(r => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
    }))),
    new Promise(r => setTimeout(r, ms)),
  ]);
}

/**
 * Build the worksheet in a hidden iframe and lay it out. Resolves the iframe,
 * ready to print. The caller removes it afterwards.
 */
export async function preparePrint(items) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Print';
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '210mm', height: '297mm',
    border: '0', opacity: '0', pointerEvents: 'none', zIndex: '-1' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Picture It — questions</title><style>' +
    CSS + '</style></head><body><div id="out"></div><div class="measure small" id="measure">' +
    items.map(questionHtml).join('') + '</div></body></html>');
  doc.close();
  await waitForImages(doc);
  // Measure each question at small size; anything taller than half a page is large.
  const mmPx = doc.getElementById('measure').getBoundingClientRect().width / 190 || 3.78;
  const halfPx = (HALF_MM - 6) * mmPx;
  const measured = Array.from(doc.querySelectorAll('#measure > .q'));
  const large = items.map((it, i) => guessLarge(it) || (measured[i] && measured[i].offsetHeight > halfPx));
  const blocks = measured.map(n => n.outerHTML);
  const out = doc.getElementById('out');
  out.innerHTML = packPages(large).map(p => p.full
    ? '<div class="page full">' + blocks[p.items[0]] + '</div>'
    : '<div class="page">' + p.items.map(i => '<div class="half">' + blocks[i] + '</div>').join('') + '</div>'
  ).join('');
  doc.getElementById('measure').remove();
  await waitForImages(doc);
  return frame;
}

/** Print the items (opens the browser's print dialog, where it can be saved as PDF). */
export async function printQuestions(items) {
  const frame = await preparePrint(items);
  const done = () => setTimeout(() => frame.remove(), 500);
  if (typeof window.__visPrintHook === 'function') { window.__visPrintHook(frame); return; }
  frame.contentWindow.addEventListener('afterprint', done, { once: true });
  setTimeout(() => { if (frame.isConnected) frame.remove(); }, 120000);
  frame.contentWindow.focus();
  frame.contentWindow.print();
}
