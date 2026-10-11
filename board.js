// Picture It · the one-page question board.
//
// The whole site is one blank page now. "+ Add question" puts down one box.
// Into that box goes a screenshot; the AI reads the question (multiple choice
// or free response) and codes a small app that helps a child picture it.
// Save keeps only two things in the box: the question and the app. Then the
// next box can be added underneath.
//
// Boxes are kept in this browser (localStorage, key vis_blocks). The app each
// box holds runs in <iframe sandbox="allow-scripts"> with srcdoc: an opaque
// origin, so a generated app can never read this site's storage or DOM.

import { readStore, writeStore, uid, escapeHtml, el, showToast, readImageFile } from './core.js?v=1.5.1';
import { generateWebapp, tweakWebapp, saveAiConfig, getAiConfig, MODEL_CHOICES, enhanceDiagram } from './ai.js?v=1.5.1';
import { SYL_LOS, SYL_LO_BY_ID, SYL_LEVELS } from './syllabus.js?v=1.5.1';
import { classifyBatch, needsClassify } from './classify.js?v=1.5.1';
import { printQuestions } from './print.js?v=1.5.1';

const BLOCKS_KEY = 'vis_blocks';
const MAX_BLOCKS = 200;
const MAX_DIAGRAM_CHARS = 700000;
const KEY_ERROR_CODES = new Set(['no-key', 'proxy-unreachable', 'bad-key']);
// Luna is quick and cheap; Sol 6.1 thinks harder for tricky questions.
const DEFAULT_MODEL = 'gpt-6-luna';
const MODEL_IDS = new Set(MODEL_CHOICES.map(m => m.id));
function cleanModel(m) { return MODEL_IDS.has(m) ? m : DEFAULT_MODEL; }
function modelLabel(m) {
  const c = MODEL_CHOICES.find(x => x.id === m);
  return c ? c.label : m;
}
const FRAME_MIN = 220;
const FRAME_MAX = 1600;
const FRAME_START = 460;

// ─────────────────────────────────────────────────────────────────────────
// Building several boxes at once
// ─────────────────────────────────────────────────────────────────────────
//
// Many pictures can be added at once and every box builds by itself. To keep
// the AI server's rate limit happy, at most MAX_PARALLEL boxes talk to the AI
// at the same moment; the rest wait their turn in the order they were added
// and start the instant a slot frees up. A box that is stopped while waiting
// leaves the queue without ever using a slot.

export const MAX_PARALLEL = 3;
export const MAX_BATCH = 40;
let slotsInUse = 0;
const slotQueue = [];

function cancelledError() {
  const e = new Error('Stopped.');
  e.cancelled = true;
  e.kind = 'cancelled';
  return e;
}

/** Wait for a free AI slot. Resolves with a release function (call it once). */
export function acquireSlot(signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(cancelledError()); return; }
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      slotsInUse = Math.max(0, slotsInUse - 1);
      pumpSlots();
    };
    const entry = { grant: () => { slotsInUse++; resolve(release); }, signal };
    if (signal) {
      signal.addEventListener('abort', () => {
        const i = slotQueue.indexOf(entry);
        if (i >= 0) { slotQueue.splice(i, 1); reject(cancelledError()); }
      }, { once: true });
    }
    slotQueue.push(entry);
    pumpSlots();
  });
}

function pumpSlots() {
  while (slotsInUse < MAX_PARALLEL && slotQueue.length) {
    const next = slotQueue.shift();
    if (next.signal && next.signal.aborted) continue;
    next.grant();
  }
}

/** How many boxes are talking to the AI, and how many are waiting. */
export function slotCounts() { return { running: slotsInUse, waiting: slotQueue.length }; }

/** Only the picture files out of a FileList / array. */
export function imageFiles(list) {
  return Array.from(list || []).filter(f => f && /^image\//.test(f.type || ''));
}

// ─────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────

function cleanBlock(b) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string') return null;
  if (typeof b.html !== 'string' || !b.html.trim()) return null;
  const out = {
    id: b.id,
    questionText: String(b.questionText || ''),
    type: b.type === 'mcq' ? 'mcq' : 'free',
    options: Array.isArray(b.options) ? b.options.map(String).slice(0, 8) : [],
    answers: Array.isArray(b.answers) ? b.answers.map(String).slice(0, 10) : [],
    title: String(b.title || ''),
    html: b.html,
    model: cleanModel(b.model),
    tweaks: Array.isArray(b.tweaks) ? b.tweaks.map((t) => String(t).slice(0, 400)).slice(-10) : [],
    createdAt: Number(b.createdAt) || Date.now(),
    updatedAt: Number(b.updatedAt) || Number(b.createdAt) || 0,
    diagram: typeof b.diagram === 'string' && /^data:image\//.test(b.diagram) && b.diagram.length < MAX_DIAGRAM_CHARS
      ? b.diagram : '',
    // Learning objectives (v1.5.0). `los` absent = not sorted yet; [] = sorted, none fit.
    topic: String(b.topic || '').slice(0, 80),
    losManual: !!b.losManual,
  };
  // Never write an undefined field: Firestore refuses them.
  if (Array.isArray(b.los)) out.los = b.los.map(String).filter(id => SYL_LO_BY_ID[id]).slice(0, 5);
  return out;
}

function loadBlocks() {
  const list = readStore(BLOCKS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.map(cleanBlock).filter(Boolean);
}

// Listeners told after every successful save (the cloud sync hangs off this).
const savedListeners = [];
let activeBoard = null;

/** Call fn(list) after every save of the board. Returns an unsubscribe. */
export function onBlocksSaved(fn) {
  if (typeof fn !== 'function') return () => {};
  savedListeners.push(fn);
  return () => { const i = savedListeners.indexOf(fn); if (i >= 0) savedListeners.splice(i, 1); };
}

/** The current saved list (cleaned copies). */
export function getBoardBlocks() {
  return activeBoard ? activeBoard.getBlocks() : loadBlocks();
}

/** Replace the whole list (e.g. after a cloud merge) and re-render. Does not notify listeners. */
export function setBoardBlocks(list) {
  const clean = (Array.isArray(list) ? list : []).map(cleanBlock).filter(Boolean).slice(0, MAX_BLOCKS);
  if (!writeLocal(clean)) return false;
  if (activeBoard) activeBoard.replace(clean);
  return true;
}

function writeLocal(list) {
  try {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(list.slice(0, MAX_BLOCKS)));
    return true;
  } catch (_) {
    return false;
  }
}

/** Writes the list; returns false (and says so) when the browser is full. */
function saveBlocks(list) {
  try {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(list.slice(0, MAX_BLOCKS)));
    for (const fn of savedListeners.slice()) {
      try { fn(list.slice(0, MAX_BLOCKS)); } catch (err) { console.error(err); }
    }
    return true;
  } catch (_) {
    // writeStore swallows errors too; try it once more for its own handling.
    try { writeStore(BLOCKS_KEY, list.slice(0, MAX_BLOCKS)); } catch (__) { /* ignore */ }
    showToast('This browser is out of space. Delete an old question and save again.', 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Question type: multiple choice or free response
// ─────────────────────────────────────────────────────────────────────────
//
// The AI returns the question text and the accepted answers. A question is
// multiple choice when it lists numbered or lettered choices, e.g.
// "(1) 24  (2) 36" or "A. 12  B. 15", or when the answer is just an option
// number/letter. The parent can flip it with one tap if this guesses wrong.

const OPTION_RE = /(?:^|\s|\n)\(?([1-4]|[A-D])[).:]\s+([^\n]*?)(?=\s+\(?(?:[1-4]|[A-D])[).:]\s+|\n|$)/g;

export function parseOptions(text) {
  const s = String(text || '');
  const found = [];
  let m;
  OPTION_RE.lastIndex = 0;
  while ((m = OPTION_RE.exec(s)) && found.length < 8) {
    const body = m[2].trim();
    if (body) found.push({ label: m[1], text: body });
  }
  // Need at least three choices with labels in order to call it a list.
  if (found.length < 3) return [];
  const labels = found.map(o => o.label).join('');
  if (!/^(1234|123|ABCD|ABC)/.test(labels)) return [];
  return found;
}

export function detectType(questionText, answers) {
  if (parseOptions(questionText).length) return 'mcq';
  const ans = (answers || []).map(a => String(a).trim());
  if (ans.length && ans.every(a => /^\(?([1-4]|[A-D])\)?$/i.test(a)) && /\(?[1-4A-D][).]/.test(String(questionText || ''))) {
    return 'mcq';
  }
  return 'free';
}

/** The question without the choices, so the choices can be shown as a list. */
function stemOf(text, options) {
  if (!options.length) return String(text || '');
  const s = String(text || '');
  const first = s.search(/(?:^|\s|\n)\(?(1|A)[).:]\s+/);
  return first > 0 ? s.slice(0, first).trim() : s;
}

// ─────────────────────────────────────────────────────────────────────────
// Checking a child's answer
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lower-case, collapse whitespace, drop thousands commas inside numbers and
 * strip punctuation (keeping the decimal point and a leading minus sign).
 */
export function normaliseAnswer(value) {
  let s = String(value == null ? '' : value).toLowerCase();
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  s = s.replace(/[\u2018\u2019\u201c\u201d]/g, '');
  s = s.replace(/(\d)\.(?=\d)/g, '$1\u0000');        // protect decimals
  s = s.replace(/(^|\s)-(?=\d)/g, '$1\u0001');         // protect a minus sign
  s = s.replace(/[^\p{L}\p{N}\s\u0000\u0001\/]/gu, ' ');
  s = s.replace(/\u0000/g, '.').replace(/\u0001/g, '-');
  return s.replace(/\s+/g, ' ').trim();
}

/** The accepted answers as a list: an array, or a string split on new lines, ";" or " or ". */
export function answerList(answers) {
  const raw = Array.isArray(answers) ? answers : [answers];
  const out = [];
  for (const a of raw) {
    if (a == null) continue;
    for (const part of String(a).split(/\n|;|\s+or\s+/i)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** The first number in a normalised answer, or null. */
function leadingNumber(norm) {
  const m = String(norm).match(/-?\d+(?:\.\d+)?(?:\/\d+)?/);
  if (!m) return null;
  const t = m[0];
  if (t.includes('/')) {
    const [a, b] = t.split('/').map(Number);
    return b ? a / b : null;
  }
  return Number(t);
}

const LETTER_TO_NUM = { a: '1', b: '2', c: '3', d: '4' };

/** Which option an MCQ answer names: "2", "(2)", "B", "option 2", or the option text. '' if none. */
function mcqChoice(value, options) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const m = s.match(/^(?:option|ans(?:wer)?|choice)?\s*[:.]?\s*\(?\s*([1-8]|[a-d])\s*\)?\s*[.):]?(?:\s|$)/i);
  if (m) {
    const k = m[1].toLowerCase();
    return LETTER_TO_NUM[k] || k;
  }
  const norm = normaliseAnswer(s);
  const opts = (options || []).map((o, i) => {
    const p = typeof o === 'string' ? parseLine(o, i) : o;
    const label = String(p.label || i + 1).toLowerCase();
    return { num: LETTER_TO_NUM[label] || label, text: normaliseAnswer(p.text) };
  });
  const hit = opts.find(o => o.text && o.text === norm);
  return hit ? hit.num : '';
}

/**
 * Is `given` right? type is 'mcq' or 'free'. answers: array or string (split
 * on new lines, ";" or " or "). options: the MCQ options ("(1) 24" strings or
 * {label, text}). Any listed answer counts.
 */
export function checkAnswer(type, given, answers, options) {
  const accepted = answerList(answers);
  if (!accepted.length) return false;
  if (String(given == null ? '' : given).trim() === '') return false;
  if (type === 'mcq') {
    const pick = mcqChoice(given, options);
    if (!pick) return false;
    return accepted.some(a => mcqChoice(a, options) === pick);
  }
  const g = normaliseAnswer(given);
  const gNum = leadingNumber(g);
  return accepted.some(a => {
    const n = normaliseAnswer(a);
    if (n === g) return true;
    const aNum = leadingNumber(n);
    if (gNum != null && aNum != null) return Math.abs(gNum - aNum) < 1e-9;
    return false;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Diagram: crop the figure out of the screenshot and tidy it up
// ─────────────────────────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the picture.'));
    img.src = src;
  });
}

/** Crop a {box_2d:[ymin,xmin,ymax,xmax]} (0-1000) region plus 3% padding. */
async function cropDiagram(imageDataUrl, diagram) {
  const img = await loadImage(imageDataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const [ymin, xmin, ymax, xmax] = diagram.box_2d;
  const pad = 30;
  const x0 = Math.max(0, Math.floor((xmin - pad) / 1000 * W));
  const y0 = Math.max(0, Math.floor((ymin - pad) / 1000 * H));
  const x1 = Math.min(W, Math.ceil((xmax + pad) / 1000 * W));
  const y1 = Math.min(H, Math.ceil((ymax + pad) / 1000 * H));
  const w = x1 - x0, h = y1 - y0;
  if (w < 8 || h < 8) throw new Error('The figure is too small to crop.');
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, x0, y0, w, h, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/**
 * A quick clean-up with no AI: the 98th-percentile brightness is taken as the
 * paper, anything within ~12% of it becomes pure white, and the rest is turned
 * grey and contrast-stretched so the lines are dark and crisp.
 */
async function localCleanDiagram(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Uint32Array(256);
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    hist[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
  }
  let lo = 0, white = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.98) { white = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  white = Math.max(white, 40);
  const snap = white * 0.88;
  const span = Math.max(1, snap - lo);
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let out;
    if (y >= snap) out = 255;
    else out = Math.max(0, Math.min(255, Math.round((y - lo) / span * 235)));
    px[i] = px[i + 1] = px[i + 2] = out;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

/** Downscale to at most 1000px a side; PNG, or JPEG 0.85 when the PNG is over 300 KB. */
async function finishDiagram(dataUrl) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL('image/png');
  if (out.length * 0.75 > 300 * 1024) out = c.toDataURL('image/jpeg', 0.85);
  return out;
}

/** AI clean-up, falling back to the quick one. Returns {url, quick}. */
async function cleanUpDiagram(cropUrl, signal) {
  try {
    const url = await enhanceDiagram({ imageDataUrl: cropUrl, signal });
    return { url: await finishDiagram(url), quick: false };
  } catch (err) {
    if (err && err.cancelled) throw err;
    return { url: await finishDiagram(await localCleanDiagram(cropUrl)), quick: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The sandboxed app
// ─────────────────────────────────────────────────────────────────────────

const frames = new Map(); // token -> iframe
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', event => {
    const d = event.data;
    if (!d || typeof d !== 'object' || typeof d.boardFrame !== 'string') return;
    const frame = frames.get(d.boardFrame);
    if (!frame || frame.contentWindow !== event.source) return;
    if (d.type === 'height') {
      const h = Math.max(FRAME_MIN, Math.min(FRAME_MAX, Math.ceil(Number(d.value) || 0)));
      if (h) frame.style.height = h + 'px';
    } else if (d.type === 'error') {
      frame.dataset.error = String(d.value || '').slice(0, 300);
      frame.dispatchEvent(new CustomEvent('apperror', { detail: frame.dataset.error }));
    }
  });
}

function preamble(token) {
  return '(function(){var T=' + JSON.stringify(token) + ';' +
    'function post(t,v){try{parent.postMessage({boardFrame:T,type:t,value:v},"*")}catch(_){}}' +
    'function mem(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},' +
    'setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},' +
    'key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}' +
    '["localStorage","sessionStorage"].forEach(function(n){var ok=false;try{window[n].getItem("__b");ok=true}catch(_){}' +
    'if(!ok){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});' +
    'try{window.alert=function(){};window.confirm=function(){return true};window.prompt=function(m,d){return d==null?"":String(d)};window.open=function(){return null}}catch(_){}' +
    'window.addEventListener("error",function(e){post("error",(e&&e.message)||"Script error")});' +
    'function size(){var b=document.body,h=document.documentElement;if(!b)return;' +
    'post("height",Math.max(b.scrollHeight,b.offsetHeight,h.scrollHeight,h.offsetHeight))}' +
    'window.addEventListener("load",function(){size();setTimeout(size,300);setTimeout(size,1200);' +
    'try{new ResizeObserver(size).observe(document.body)}catch(_){setInterval(size,1000)}});' +
    '})();';
}

// Every built app is set in Century Gothic. Century Gothic's question mark
// is an odd, hooked shape, so ONLY "?" (and the full-width "？") is drawn in
// Helvetica: the @font-face below covers just those two code points
// (unicode-range), and the browser takes every other character from the next
// family in the list. Fonts come from the device only (local()), because a
// built app may not fetch anything.
const APP_FONT_STACK = '"VisQMark","Century Gothic",CenturyGothic,"URW Gothic","URW Gothic L",AppleGothic,"Segoe UI",sans-serif';
const APP_FONT_CSS =
  '@font-face{font-family:"VisQMark";src:local("Helvetica"),local("Helvetica Neue"),local("HelveticaNeue"),local("Arial");unicode-range:U+003F,U+FF1F;}' +
  'html,body,body *{font-family:' + APP_FONT_STACK + ' !important;}';

// Text drawn on a <canvas> ignores CSS, so the same stack is put into every
// ctx.font the app sets: "bold 18px Arial" becomes "bold 18px <stack>".
function canvasFontPatch() {
  return '(function(){try{var S=' + JSON.stringify(APP_FONT_STACK) + ';' +
    'var P=CanvasRenderingContext2D.prototype,d=Object.getOwnPropertyDescriptor(P,"font");' +
    'if(!d||!d.set)return;' +
    'Object.defineProperty(P,"font",{configurable:true,get:d.get,set:function(v){' +
    'var m=String(v).match(/^(.*?\\d*\\.?\\d+(?:px|pt|em|rem|%|vw|vh)(?:\\s*\\/\\s*[^\\s]+)?)\\s+.+$/);' +
    'd.set.call(this,m?m[1]+" "+S:v);}});}catch(e){}})();';
}

function frameDocument(html, token) {
  const tag = '<style>' + APP_FONT_CSS + '</style>' +
    '<script>' + (canvasFontPatch() + preamble(token)).replace(/<\/script/gi, '<\\/script') + '</script>';
  const doc = String(html || '');
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, m => m + tag);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, m => m + '<head>' + tag + '</head>');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    tag + '</head><body>' + doc + '</body></html>';
}

function mountApp(container, html, title) {
  listen();
  const token = uid('brd');
  const frame = el('iframe', {
    class: 'board-frame',
    sandbox: 'allow-scripts',
    referrerpolicy: 'no-referrer',
    title: title ? 'App: ' + title : 'Question app',
  });
  frame.style.height = FRAME_START + 'px';
  frame.srcdoc = frameDocument(html, token);
  frames.set(token, frame);
  container.innerHTML = '';
  container.appendChild(frame);
  setTimeout(() => {
    for (const [k, f] of frames) if (!f.isConnected) frames.delete(k);
  }, 20000);
  return frame;
}

// ─────────────────────────────────────────────────────────────────────────
// Pieces shared by the editing box and the saved box
// ─────────────────────────────────────────────────────────────────────────

function typeBadge(type) {
  return el('span', { class: 'board-badge board-badge-' + type },
    type === 'mcq' ? 'Multiple choice' : 'Free response');
}

/** The question as it is shown in a box: stem, then choices if MCQ. */
function questionView(data) {
  const options = data.type === 'mcq'
    ? (data.options && data.options.length ? data.options.map(parseLine) : parseOptions(data.questionText))
    : [];
  const wrap = el('div', { class: 'board-question' });
  const stem = stemOf(data.questionText, options);
  for (const para of String(stem).split(/\n{2,}/)) {
    if (para.trim()) wrap.appendChild(el('p', { class: 'board-stem' }, para.trim()));
  }
  if (data.diagram) wrap.appendChild(el('img', { class: 'board-diagram', src: data.diagram, alt: 'Diagram' }));
  if (options.length) {
    const list = el('ol', { class: 'board-options' });
    for (const o of options) {
      list.appendChild(el('li', {}, [
        el('span', { class: 'board-option-label' }, '(' + o.label + ')'),
        el('span', {}, o.text),
      ]));
    }
    wrap.appendChild(list);
  }
  return wrap;
}

function parseLine(line, i) {
  // A label needs a bracket or a separator after it: "2/3" is an answer, not option 2.
  const m = String(line).match(/^\(([1-4A-D])\)\s*(.*)$/) || String(line).match(/^([1-4A-D])[).:]\s+(.*)$/);
  return m ? { label: m[1], text: m[2] || line } : { label: String(i + 1), text: String(line) };
}

// ─────────────────────────────────────────────────────────────────────────
// The editing box: screenshot in, AI builds, Save
// ─────────────────────────────────────────────────────────────────────────

function createEditor(board, existing) {
  const state = {
    draft: existing ? { ...existing } : null,
    image: null,
    controller: null,
    building: false,
    model: cleanModel(existing && existing.model),
  };

  const box = el('section', { class: 'board-box board-box-editing', 'aria-label': 'New question' });
  const head = el('div', { class: 'board-box-head' }, [
    el('span', { class: 'board-box-title' }, existing ? 'Change this question' : 'New question'),
  ]);
  const closeBtn = el('button', { type: 'button', class: 'board-icon-btn', 'aria-label': 'Close this box' }, '✕');
  head.appendChild(closeBtn);

  const drop = el('div', { class: 'board-drop', tabindex: '0', role: 'button',
    'aria-label': 'Paste, drop or choose a screenshot of the question' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: '', class: 'board-file' });
  drop.appendChild(el('div', { class: 'board-drop-icon', 'aria-hidden': 'true' }, '📸'));
  drop.appendChild(el('div', { class: 'board-drop-main' }, 'Paste a screenshot of the question'));
  drop.appendChild(el('div', { class: 'board-drop-sub' }, 'Ctrl+V or ⌘+V, drop it here, or tap to choose. Pick several to make a box for each.'));
  drop.appendChild(fileInput);

  const preview = el('div', { class: 'board-preview', hidden: '' });
  const status = el('div', { class: 'board-status', role: 'status', 'aria-live': 'polite' });
  const result = el('div', { class: 'board-result', hidden: '' });
  const keyBox = el('div', { class: 'board-key', hidden: '' });
  const actions = el('div', { class: 'board-actions' });
  const saveBtn = el('button', { type: 'button', class: 'board-btn board-btn-primary', disabled: '' }, 'Save');
  const rebuildBtn = el('button', { type: 'button', class: 'board-btn', hidden: '' }, 'Build again');
  const stopBtn = el('button', { type: 'button', class: 'board-btn', hidden: '' }, 'Stop');
  const cancelBtn = el('button', { type: 'button', class: 'board-btn board-btn-quiet' }, 'Cancel');
  actions.append(saveBtn, rebuildBtn, stopBtn, cancelBtn);

  // Which AI builds (and tweaks) this question's app.
  const modelRow = el('div', { class: 'board-model-row' });
  const modelLabelEl = el('label', { class: 'board-label board-model-label' }, 'Which AI');
  const modelSelect = el('select', { class: 'board-select', 'aria-label': 'Which AI builds the app' });
  MODEL_CHOICES.forEach(m => {
    const opt = el('option', { value: m.id }, m.label);
    if (m.id === state.model) opt.selected = true;
    modelSelect.appendChild(opt);
  });
  modelLabelEl.appendChild(modelSelect);
  modelRow.appendChild(modelLabelEl);
  modelRow.appendChild(el('p', { class: 'board-model-note' },
    'Pick Sol 6.1 for a harder question. It takes longer but thinks more carefully.'));
  modelSelect.addEventListener('change', () => {
    state.model = cleanModel(modelSelect.value);
    if (state.draft) state.draft.model = state.model;
  });

  box.append(head, modelRow, drop, preview, status, keyBox, result, actions);

  function setStatus(text, kind) {
    status.textContent = text || '';
    status.className = 'board-status' + (kind ? ' board-status-' + kind : '');
  }

  function setBuilding(on) {
    state.building = on;
    box.classList.toggle('is-building', on);
    stopBtn.hidden = !on;
    rebuildBtn.hidden = on || !state.image;
    saveBtn.disabled = on || !state.draft;
    drop.classList.toggle('is-disabled', on);
    modelSelect.disabled = on;
    box.querySelectorAll('.board-tweak textarea, .board-tweak button').forEach(n => { n.disabled = on; });
    board.changed();
  }

  function showPreview(dataUrl) {
    preview.innerHTML = '';
    preview.hidden = false;
    preview.appendChild(el('img', { src: dataUrl, alt: 'The screenshot you added' }));
    drop.classList.add('is-small');
    drop.querySelector('.board-drop-main').textContent = 'Use a different screenshot';
  }

  function showResult() {
    result.innerHTML = '';
    if (!state.draft) { result.hidden = true; return; }
    result.hidden = false;
    const d = state.draft;
    const typeRow = el('div', { class: 'board-type-row' });
    typeRow.appendChild(typeBadge(d.type));
    const flip = el('button', { type: 'button', class: 'board-link' },
      d.type === 'mcq' ? 'It is free response' : 'It is multiple choice');
    flip.addEventListener('click', () => {
      d.type = d.type === 'mcq' ? 'free' : 'mcq';
      if (d.type === 'mcq' && !d.options.length) {
        d.options = parseOptions(d.questionText).map(o => '(' + o.label + ') ' + o.text);
      }
      showResult();
    });
    typeRow.appendChild(flip);
    result.appendChild(typeRow);

    const qWrap = el('div', { class: 'board-edit-q' });
    const qLabel = el('label', { class: 'board-label' }, 'Question (you can fix anything the AI misread)');
    const qArea = el('textarea', { class: 'board-textarea', rows: '4' });
    qArea.value = d.questionText;
    qArea.addEventListener('input', () => {
      d.questionText = qArea.value;
      if (d.type === 'mcq') d.options = parseOptions(d.questionText).map(o => '(' + o.label + ') ' + o.text);
    });
    qLabel.appendChild(qArea);
    qWrap.appendChild(qLabel);
    result.appendChild(qWrap);

    const aLabel = el('label', { class: 'board-label' }, 'Correct answer(s)');
    const aInput = el('input', { type: 'text', class: 'board-input board-answers-input', autocomplete: 'off',
      placeholder: d.type === 'mcq' ? 'e.g. 2' : 'e.g. 245; 245 marbles' });
    aInput.value = (d.answers || []).join('; ');
    aInput.addEventListener('input', () => {
      d.answers = aInput.value.split(';').map(a => a.trim()).filter(Boolean).slice(0, 10);
    });
    aLabel.appendChild(aInput);
    result.appendChild(el('div', { class: 'board-edit-answers' }, [
      aLabel,
      el('p', { class: 'board-answer-note' },
        'For MCQ type the option number. Separate several accepted answers with ; (kept hidden from your child until they check).'),
    ]));

    result.appendChild(diagramEditor(d));

    const appHost = el('div', { class: 'board-app' });
    result.appendChild(appHost);
    const frame = mountApp(appHost, d.html, d.title);
    frame.addEventListener('apperror', ev => {
      setStatus('The app hit a problem (' + ev.detail + '). Try "Build again" or tweak it below.', 'warn');
    });

    // Tweak: type a change and the AI rewrites this app.
    const tweak = el('div', { class: 'board-tweak' });
    const tLabel = el('label', { class: 'board-label' }, 'Tweak the app: type what you want changed');
    const tArea = el('textarea', { class: 'board-textarea', rows: '3',
      placeholder: 'e.g. Make the buttons bigger. Use apples instead of blocks. Add a hint button. Show the bar model step by step.' });
    tArea.value = state.tweakText || '';
    tArea.addEventListener('input', () => { state.tweakText = tArea.value; });
    tArea.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); tweak_(); }
    });
    tLabel.appendChild(tArea);
    const tRow = el('div', { class: 'board-tweak-row' });
    const tBtn = el('button', { type: 'button', class: 'board-btn board-btn-primary' }, '✨ Tweak the app');
    tBtn.addEventListener('click', () => tweak_());
    tRow.appendChild(tBtn);
    tRow.appendChild(el('span', { class: 'board-tweak-note' }, 'Uses ' + modelLabel(state.model) + '. Ctrl+Enter also works.'));
    tweak.append(tLabel, tRow);
    if (d.tweaks && d.tweaks.length) {
      const hist = el('ul', { class: 'board-tweak-history' });
      d.tweaks.slice(-5).forEach(t => hist.appendChild(el('li', {}, t)));
      tweak.appendChild(el('p', { class: 'board-tweak-history-title' }, 'Changes made so far:'));
      tweak.appendChild(hist);
    }
    result.appendChild(tweak);
    if (state.building) tweak.querySelectorAll('textarea, button').forEach(n => { n.disabled = true; });
    saveBtn.disabled = state.building;
  }

  function diagramEditor(d) {
    const sec = el('div', { class: 'board-diagram-edit' });
    sec.appendChild(el('p', { class: 'board-label' }, 'Diagram'));
    if (d.diagram) {
      sec.appendChild(el('img', { class: 'board-diagram', src: d.diagram, alt: 'Diagram' }));
    } else {
      sec.appendChild(el('p', { class: 'board-diagram-none' }, 'No diagram for this question.'));
    }
    const row = el('div', { class: 'board-diagram-row' });
    const file = el('input', { type: 'file', accept: 'image/*', class: 'board-file' });
    const replaceBtn = el('button', { type: 'button', class: 'board-btn' }, d.diagram ? 'Replace…' : 'Add a diagram…');
    replaceBtn.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try {
        d.diagram = await finishDiagram(await readImageFile(f));
        showResult();
      } catch (_) { setStatus('Could not read that picture.', 'error'); }
    });
    row.append(replaceBtn, file);
    if (d.diagram) {
      const removeBtn = el('button', { type: 'button', class: 'board-btn board-btn-quiet' }, 'Remove diagram');
      removeBtn.addEventListener('click', () => { d.diagram = ''; showResult(); });
      const againBtn = el('button', { type: 'button', class: 'board-btn' }, 'Clean up again');
      againBtn.addEventListener('click', async () => {
        if (state.building) return;
        setBuilding(true);
        setStatus('Cleaning up the diagram…', 'busy');
        const controller = new AbortController();
        state.controller = controller;
        try {
          const out = await cleanUpDiagram(d.diagram, controller.signal);
          if (state.controller !== controller) return;
          d.diagram = out.url;
          setStatus(out.quick ? 'The AI clean-up was not available, so a quick clean-up was used.' : 'Diagram cleaned up.',
            out.quick ? 'warn' : 'ok');
          showResult();
        } catch (err) {
          if (state.controller !== controller) return;
          setStatus(err && err.cancelled ? 'Stopped.' : 'Could not clean up the diagram.', err && err.cancelled ? '' : 'error');
        } finally {
          if (state.controller === controller) { state.controller = null; setBuilding(false); }
        }
      });
      row.append(againBtn, removeBtn);
    }
    sec.appendChild(row);
    return sec;
  }

  async function tweak_() {
    const d = state.draft;
    if (!d || state.building) return;
    const instruction = String(state.tweakText || '').trim();
    if (!instruction) { setStatus('Type what you want changed first.', 'error'); return; }
    keyBox.hidden = true;
    setBuilding(true);
    setStatus('Changing the app…', 'busy');
    const controller = new AbortController();
    state.controller = controller;
    try {
      const reply = await tweakWebapp({
        html: d.html,
        instruction,
        questionText: d.questionText,
        answers: d.answers,
        model: state.model,
        onStatus: text => { if (state.controller === controller) setStatus(text, 'busy'); },
        signal: controller.signal,
      });
      if (state.controller !== controller) return;
      d.html = reply.html;
      if (reply.title) d.title = String(reply.title);
      const answers = Array.isArray(reply.answers) ? reply.answers.map(String).filter(Boolean) : [];
      if (answers.length) d.answers = answers;
      d.model = state.model;
      d.tweaks = (d.tweaks || []).concat([instruction]).slice(-10);
      state.tweakText = '';
      setStatus('Done. The app has been changed. Check it, then Save.', 'ok');
      showResult();
    } catch (err) {
      if (state.controller !== controller) return;
      const msg = err && err.message ? err.message : 'Something went wrong.';
      if (err && err.kind === 'cancelled') {
        setStatus('Stopped. The app was not changed.');
      } else if (err && KEY_ERROR_CODES.has(err.code)) {
        setStatus(msg, 'error');
        showKeyBox(getAiConfig().apiKey
          ? 'The AI did not accept the saved key. Paste a working OpenAI key:'
          : 'The AI server is not answering right now. You can paste your own OpenAI key:', tweak_);
      } else {
        setStatus(msg, 'error');
      }
    } finally {
      if (state.controller === controller) {
        state.controller = null;
        setBuilding(false);
      }
    }
  }

  function showKeyBox(message, retry) {
    keyBox.innerHTML = '';
    keyBox.hidden = false;
    keyBox.appendChild(el('p', {}, message));
    const row = el('div', { class: 'board-key-row' });
    const input = el('input', { type: 'password', class: 'board-input', placeholder: 'sk-…', autocomplete: 'off',
      'aria-label': 'OpenAI key' });
    const go = el('button', { type: 'button', class: 'board-btn board-btn-primary' }, 'Save key and try again');
    go.addEventListener('click', () => {
      const key = input.value.trim();
      if (!/^sk-[A-Za-z0-9_\-]{10,}$/.test(key)) {
        showToast('That does not look like an OpenAI key (it starts with sk-).', 'error');
        return;
      }
      saveAiConfig({ apiKey: key });
      keyBox.hidden = true;
      (retry || build)();
    });
    row.append(input, go);
    keyBox.appendChild(row);
    keyBox.appendChild(el('p', { class: 'board-key-note' }, 'The key stays in this browser only.'));
  }

  async function takeImage(file) {
    if (state.building) return;
    if (!file || !/^image\//.test(file.type || '')) {
      setStatus('That is not a picture. Paste or choose a screenshot.', 'error');
      return;
    }
    try {
      state.image = await readImageFile(file);
    } catch (err) {
      setStatus('Could not read that picture.', 'error');
      return;
    }
    showPreview(state.image);
    build();
  }

  async function build() {
    if (!state.image || state.building) return;
    keyBox.hidden = true;
    state.draft = null;
    result.hidden = true;
    setBuilding(true);
    const controller = new AbortController();
    state.controller = controller;
    let release = null;
    try {
      if (slotCounts().running >= MAX_PARALLEL) setStatus('Waiting for its turn (a few boxes build at a time)…', 'busy');
      state.waiting = true;
      board.changed();
      release = await acquireSlot(controller.signal);
      state.waiting = false;
      board.changed();
      if (state.controller !== controller) return;
      setStatus('Reading the question…', 'busy');
      const reply = await generateWebapp({
        imageDataUrl: state.image,
        model: state.model,
        note: 'Build an app for a Primary 3 child. Show the question at the top of the app.',
        onStatus: text => { if (state.controller === controller) setStatus(text, 'busy'); },
        signal: controller.signal,
      });
      if (state.controller !== controller) return;
      const answers = Array.isArray(reply.answers) ? reply.answers.map(String).filter(Boolean) : [];
      const questionText = String(reply.questionText || '').trim();
      const type = detectType(questionText, answers);
      state.draft = {
        id: existing ? existing.id : uid('q'),
        createdAt: existing ? existing.createdAt : Date.now(),
        title: String(reply.title || ''),
        questionText,
        type,
        options: type === 'mcq' ? parseOptions(questionText).map(o => '(' + o.label + ') ' + o.text) : [],
        answers,
        html: reply.html,
        model: state.model,
        diagram: '',
      };
      let diagramNote = '';
      if (reply.diagram) {
        try {
          setStatus('Cleaning up the diagram…', 'busy');
          const crop = await cropDiagram(state.image, reply.diagram);
          const out = await cleanUpDiagram(crop, controller.signal);
          if (state.controller !== controller) return;
          state.draft.diagram = out.url;
          if (out.quick) diagramNote = ' The diagram got a quick clean-up (the AI clean-up was not available).';
        } catch (err) {
          if (state.controller !== controller) return;
          if (err && err.cancelled) throw err;
          diagramNote = ' The diagram could not be cut out; you can add one in the Diagram section.';
        }
      }
      setStatus((type === 'mcq'
        ? 'Done. It looks like a multiple-choice question. Check it, then Save.'
        : 'Done. It looks like a free-response question. Check it, then Save.') + diagramNote, 'ok');
      showResult();
    } catch (err) {
      if (state.controller !== controller) return;
      const msg = err && err.message ? err.message : 'Something went wrong.';
      if (err && (err.kind === 'cancelled' || err.cancelled)) {
        setStatus('Stopped.');
      } else if (err && KEY_ERROR_CODES.has(err.code)) {
        setStatus(msg, 'error');
        showKeyBox(getAiConfig().apiKey
          ? 'The AI did not accept the saved key. Paste a working OpenAI key:'
          : 'The AI server is not answering right now. You can paste your own OpenAI key to build it now:');
      } else {
        setStatus(msg, 'error');
      }
    } finally {
      state.waiting = false;
      if (release) release();
      if (state.controller === controller) {
        state.controller = null;
        setBuilding(false);
      }
    }
  }

  function stop() {
    if (state.controller) state.controller.abort();
  }

  function close() {
    stop();
    state.controller = null;
    board.closeEditor(box, existing);
  }

  /** The block this box would save, or null (with a message) if it is not ready. */
  function readyBlock(quiet) {
    if (!state.draft || state.building) return null;
    const d = state.draft;
    if (!d.questionText.trim()) {
      if (!quiet) setStatus('The question is empty. Type it in the box first.', 'error');
      return null;
    }
    if (d.type === 'mcq') d.options = d.options.length ? d.options : parseOptions(d.questionText).map(o => '(' + o.label + ') ' + o.text);
    else d.options = [];
    d.updatedAt = Date.now();
    return cleanBlock(d);
  }

  function save() {
    const block = readyBlock(false);
    if (block) board.commit(block, box);
  }

  // Wire up.
  drop.addEventListener('click', ev => {
    if (state.building || ev.target === fileInput) return;
    fileInput.click();
  });
  drop.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fileInput.click(); }
  });
  // Several pictures chosen or dropped here: the first fills this box, the
  // rest open boxes of their own underneath and build at the same time.
  function takeMany(list) {
    const files = imageFiles(list);
    if (!files.length) {
      if (list && list.length) setStatus('That is not a picture. Paste or choose a screenshot.', 'error');
      return;
    }
    if (state.building) { board.openWithFiles(files); return; }
    takeImage(files[0]);
    if (files.length > 1) board.openWithFiles(files.slice(1));
  }
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (files.length) takeMany(files);
  });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, ev => {
    ev.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const files = ev.dataTransfer && ev.dataTransfer.files ? Array.from(ev.dataTransfer.files) : [];
    if (files.length) takeMany(files);
  });
  saveBtn.addEventListener('click', save);
  rebuildBtn.addEventListener('click', build);
  stopBtn.addEventListener('click', stop);
  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);

  if (existing) {
    state.draft = { ...existing, options: existing.options.slice(), answers: existing.answers.slice() };
    setStatus('Paste a new screenshot to rebuild it, or fix the question and Save.');
    showResult();
  }

  return {
    box,
    takeImage,
    readyBlock,
    isBusy: () => state.building,
    isWaiting: () => !!state.waiting,
    hasDraft: () => !!state.draft && !state.building,
    isEmpty: () => !state.image && !state.draft && !state.building,
    focus: () => drop.focus(),
    cancel: () => { stop(); state.controller = null; },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A saved box: only the question and the app
// ─────────────────────────────────────────────────────────────────────────

/** The "check your answer" row on a saved box. */
function answerCheck(block) {
  const wrap = el('div', { class: 'board-check' });
  const hasAnswers = answerList(block.answers).length > 0;
  const feedback = el('div', { class: 'board-feedback', role: 'status', 'aria-live': 'polite', hidden: '' });
  const submit = el('button', { type: 'button', class: 'board-btn board-btn-primary board-submit', disabled: '' }, 'Check my answer');
  const retry = el('button', { type: 'button', class: 'board-btn board-retry', hidden: '' }, 'Try again');
  let getGiven = () => '';
  let lock = () => {};
  let unlock = () => {};

  if (block.type === 'mcq') {
    const opts = (block.options && block.options.length ? block.options.map(parseLine) : parseOptions(block.questionText));
    const group = el('div', { class: 'board-choices', role: 'group', 'aria-label': 'Choose an answer' });
    let picked = '';
    const btns = opts.map((o) => {
      const b = el('button', { type: 'button', class: 'board-choice', 'aria-pressed': 'false' }, [
        el('span', { class: 'board-option-label' }, '(' + o.label + ')'),
        el('span', {}, o.text),
      ]);
      b.addEventListener('click', () => {
        picked = o.label;
        btns.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        if (hasAnswers) submit.disabled = false;
      });
      group.appendChild(b);
      return b;
    });
    getGiven = () => picked;
    lock = () => btns.forEach(b => { b.disabled = true; });
    unlock = () => {
      picked = '';
      btns.forEach(b => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });
      submit.disabled = true;
    };
    wrap.appendChild(group);
  } else {
    const input = el('input', { type: 'text', class: 'board-input board-free-input', autocomplete: 'off',
      'aria-label': 'Your answer', placeholder: 'Type your answer' });
    input.addEventListener('input', () => { submit.disabled = !hasAnswers || !input.value.trim(); });
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !submit.disabled) { ev.preventDefault(); submit.click(); }
    });
    getGiven = () => input.value;
    lock = () => { input.disabled = true; };
    unlock = () => { input.disabled = false; input.value = ''; submit.disabled = true; input.focus(); };
    wrap.appendChild(input);
  }

  const row = el('div', { class: 'board-submit-row' }, [submit, retry]);
  wrap.append(row, feedback);
  if (!hasAnswers) {
    submit.disabled = true;
    row.appendChild(el('span', { class: 'board-no-answer' }, 'No answer saved — add one in ✎ edit'));
  }

  submit.addEventListener('click', () => {
    const given = getGiven();
    if (!hasAnswers || !String(given).trim()) return;
    const ok = checkAnswer(block.type, given, block.answers, block.options);
    feedback.hidden = false;
    feedback.className = 'board-feedback ' + (ok ? 'is-ok' : 'is-wrong');
    feedback.textContent = ok ? '✓ Correct!' : '✗ Not quite — try again';
    lock();
    submit.hidden = true;
    retry.hidden = false;
  });
  retry.addEventListener('click', () => {
    feedback.hidden = true;
    feedback.textContent = '';
    submit.hidden = false;
    retry.hidden = true;
    unlock();
  });
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────
// Learning objectives on a saved question (v1.5.0)
// ─────────────────────────────────────────────────────────────────────────

/** Levels with P3 first: this board is for a P3 child. */
const LEVEL_ORDER = ['P3'].concat(SYL_LEVELS.filter(l => l !== 'P3'));

function loLabel(lo) { return lo.level + ' · ' + lo.code + ' ' + lo.text; }

/** <option>s for every LO, grouped by level (P3 first), optionally only one topic. */
function loOptions(select, topicKey) {
  for (const lv of LEVEL_ORDER) {
    const los = SYL_LOS.filter(lo => lo.level === lv && (!topicKey || lo.level + '|' + lo.sub === topicKey));
    if (!los.length) continue;
    const g = el('optgroup', { label: lv });
    for (const lo of los) g.appendChild(el('option', { value: lo.id }, loLabel(lo)));
    select.appendChild(g);
  }
}

function loChips(board, block) {
  const wrap = el('div', { class: 'board-los', 'data-los-for': block.id });
  fillChips(board, wrap, block);
  return wrap;
}

function fillChips(board, wrap, block) {
  wrap.innerHTML = '';
  const los = Array.isArray(block.los) ? block.los.map(id => SYL_LO_BY_ID[id]).filter(Boolean) : null;
  if (los === null) wrap.appendChild(el('span', { class: 'board-lo board-lo-wait' }, 'Sorting…'));
  else if (!los.length) wrap.appendChild(el('span', { class: 'board-lo board-lo-none' }, 'No learning objective'));
  for (const lo of los || []) {
    wrap.appendChild(el('span', { class: 'board-lo', title: lo.strand + ' › ' + lo.sub + ' › ' + lo.topic },
      lo.level + ' · ' + lo.sub + ' · ' + lo.code + ' ' + lo.text));
  }
  const change = el('button', { type: 'button', class: 'board-lo-change' }, 'change');
  change.addEventListener('click', () => {
    const sel = el('select', { class: 'board-lo-select', 'aria-label': 'Learning objective' });
    sel.appendChild(el('option', { value: '' }, '— none —'));
    loOptions(sel);
    sel.value = los && los[0] ? los[0].id : '';
    change.replaceWith(sel);
    sel.focus();
    sel.addEventListener('change', () => board.setLos(block.id, sel.value ? [sel.value] : []));
    sel.addEventListener('blur', () => { if (sel.isConnected) sel.replaceWith(change); });
  });
  wrap.appendChild(change);
}

/** What a saved question prints as. */
function printItem(block, num) {
  const options = block.type === 'mcq'
    ? (block.options && block.options.length ? block.options.map(parseLine) : parseOptions(block.questionText))
    : [];
  return { num, type: block.type, stem: stemOf(block.questionText, options), options, diagram: block.diagram };
}

function createSavedBox(board, block, index) {
  const box = el('section', { class: 'board-box board-box-saved', 'data-id': block.id,
    'aria-label': 'Question ' + (index + 1) });
  const tools = el('div', { class: 'board-tools' });
  const editBtn = el('button', { type: 'button', class: 'board-icon-btn', 'aria-label': 'Change this question',
    title: 'Change' }, '✎');
  const delBtn = el('button', { type: 'button', class: 'board-icon-btn', 'aria-label': 'Delete this question',
    title: 'Delete' }, '🗑');
  tools.append(editBtn, delBtn);
  box.appendChild(tools);
  const pick = el('input', { type: 'checkbox', class: 'board-pick', 'aria-label': 'Choose question ' + (index + 1) });
  pick.checked = board.isSelected(block.id);
  pick.addEventListener('change', () => board.select(block.id, pick.checked));
  box.appendChild(el('label', { class: 'board-num' }, [pick, el('span', {}, String(index + 1))]));
  box.appendChild(questionView(block));
  box.appendChild(loChips(board, block));
  box.appendChild(answerCheck(block));
  // The app starts hidden. It is only built the first time it is shown, so a long
  // board does not load every app at once; hiding it again keeps its state.
  const appId = uid('app');
  const toggle = el('button', { type: 'button', class: 'board-btn board-reveal',
    'aria-expanded': 'false', 'aria-controls': appId }, '▶ Show the app');
  const appHost = el('div', { class: 'board-app', id: appId, hidden: '' });
  box.append(toggle, appHost);
  let mounted = false;
  toggle.addEventListener('click', () => {
    const open = appHost.hidden;
    if (open && !mounted) { mountApp(appHost, block.html, block.title); mounted = true; }
    appHost.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '▼ Hide the app' : '▶ Show the app';
  });

  editBtn.addEventListener('click', () => board.edit(block, box));
  delBtn.addEventListener('click', () => {
    if (!confirm('Delete question ' + (index + 1) + '? This cannot be undone.')) return;
    board.remove(block.id);
  });
  return box;
}

// ─────────────────────────────────────────────────────────────────────────
// The board
// ─────────────────────────────────────────────────────────────────────────

export function initBoard({ listEl, addBtn, emptyEl }) {
  let blocks = loadBlocks();
  // Every open box: { editor, existing }. Several can be open and building
  // at once; acquireSlot keeps at most MAX_PARALLEL talking to the AI.
  let editors = [];

  const batchEl = document.getElementById('batchStatus');
  const saveAllBtn = document.getElementById('saveAllReady');
  const pickManyBtn = document.getElementById('addPictures');
  const pickManyInput = document.getElementById('addPicturesInput');
  const blankCountEl = document.getElementById('blankCount');
  const addBlanksBtn = document.getElementById('addBlanks');

  // v1.5.0: which saved questions are ticked (in memory only), and the filter.
  const selected = new Set();
  const filter = { topic: '', lo: '' };
  const tb = buildToolbar();
  listEl.before(tb.root);

  const entryFor = box => editors.find(e => e.editor && e.editor.box === box);
  const removeEntry = box => { editors = editors.filter(e => !(e.editor && e.editor.box === box)); };

  function newEntry() {
    const entry = { editor: null, existing: null };
    editors.push(entry);
    return entry;
  }

  /** Open boxes that hold nothing yet and are not building: reused first. */
  const idleEmpty = () => editors.filter(e => !e.existing && e.editor && e.editor.isEmpty());

  const board = {
    isSelected(id) { return selected.has(id); },
    select(id, on) { if (on) selected.add(id); else selected.delete(id); updateToolbar(); },
    /** The parent picked an objective by hand: it is never overwritten by auto-sorting. */
    setLos(id, los) {
      const i = blocks.findIndex(b => b.id === id);
      if (i < 0) return;
      const lo = SYL_LO_BY_ID[los[0]];
      const next = blocks.slice();
      next[i] = cleanBlock({ ...blocks[i], los, topic: lo ? lo.sub : '', losManual: true, updatedAt: Date.now() });
      if (!saveBlocks(next)) return;
      blocks = next;
      refreshChips(next[i]);
      applyFilter();
    },
    commit(block, editorBox) {
      if (!block) return;
      const old = blocks.find(b => b.id === block.id);
      // Changed wording: sort it again (unless the parent chose its objective).
      if (old && old.questionText !== block.questionText && !block.losManual) {
        block = { ...block }; delete block.los; block.topic = '';
      }
      const i = blocks.findIndex(b => b.id === block.id);
      const next = blocks.slice();
      if (i >= 0) next[i] = block; else next.push(block);
      if (!saveBlocks(next)) return;
      blocks = next;
      removeEntry(editorBox);
      render();
      showToast('Saved.', 'success');
      const saved = listEl.querySelector('[data-id="' + CSS.escape(block.id) + '"]');
      if (saved && editorBox) saved.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      sortPending();
    },
    closeEditor(box) {
      removeEntry(box);
      render();
    },
    edit(block) {
      const open = editors.find(e => e.existing && e.existing.id === block.id);
      if (open) {
        if (open.editor) open.editor.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      editors.push({ editor: null, existing: block });
      render();
    },
    remove(id) {
      const next = blocks.filter(b => b.id !== id);
      if (!saveBlocks(next)) return;
      blocks = next;
      render();
    },
    getBlocks() { return blocks.slice(); },
    replace(list) {
      blocks = list.slice();
      // A box editing a question that has gone is dropped, unless it is busy.
      editors = editors.filter(e => !e.existing || blocks.some(b => b.id === e.existing.id) ||
        (e.editor && e.editor.isBusy()));
      render();
      sortPending();
    },
    /** Something in a box changed (building, waiting, ready): refresh the bar. */
    changed() { updateBatch(); },
    /** One new box per picture; every one starts building straight away. */
    openWithFiles(list) {
      const files = imageFiles(list);
      if (!files.length) return;
      const room = Math.max(0, MAX_BATCH - editors.length);
      const reuse = idleEmpty();
      const usable = reuse.length + room;
      const take = files.slice(0, usable);
      if (files.length > take.length) {
        showToast('Only ' + MAX_BATCH + ' boxes can be open at once. ' +
          (files.length - take.length) + ' picture(s) were left out.', 'info');
      }
      const targets = reuse.slice(0, take.length);
      while (targets.length < take.length) targets.push(newEntry());
      render();
      take.forEach((file, i) => targets[i].editor.takeImage(file));
      const first = targets[0] && targets[0].editor;
      if (first) first.box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (take.length > 1) showToast(take.length + ' pictures added. They build ' + MAX_PARALLEL + ' at a time.', 'info');
    },
    /** n empty boxes, ready for a screenshot each. */
    openNew(n) {
      const count = Math.max(1, Math.min(Number(n) || 1, MAX_BATCH - editors.length));
      if (MAX_BATCH - editors.length <= 0) {
        showToast('Only ' + MAX_BATCH + ' boxes can be open at once.', 'info');
        return;
      }
      const made = [];
      for (let i = 0; i < count; i++) made.push(newEntry());
      render();
      const first = made[0].editor;
      first.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.focus();
    },
  };
  activeBoard = board;

  function render() {
    listEl.innerHTML = '';
    blocks.forEach((block, i) => {
      const entry = editors.find(e => e.existing && e.existing.id === block.id);
      if (entry) {
        if (!entry.editor) entry.editor = createEditor(board, block);
        listEl.appendChild(entry.editor.box);
      } else {
        listEl.appendChild(createSavedBox(board, block, i));
      }
    });
    editors.forEach(entry => {
      if (entry.existing && blocks.some(b => b.id === entry.existing.id)) return;
      if (!entry.editor) entry.editor = createEditor(board, entry.existing);
      listEl.appendChild(entry.editor.box);
    });
    emptyEl.hidden = blocks.length > 0 || editors.length > 0;
    updateBatch();
    applyFilter();
  }

  // ── Toolbar: select, print, filter (v1.5.0) ──
  function buildToolbar() {
    const root = el('div', { class: 'board-toolbar' });
    const allBtn = el('button', { type: 'button', class: 'board-tb-btn' }, 'Select all');
    const clearBtn = el('button', { type: 'button', class: 'board-tb-btn' }, 'Clear');
    const count = el('span', { class: 'board-tb-count' });
    const printBtn = el('button', { type: 'button', class: 'board-tb-btn board-tb-print' }, '🖨 Print selected questions');
    const filterBtn = el('button', { type: 'button', class: 'board-tb-btn', 'aria-expanded': 'false' }, '🔎 Filter');
    const status = el('span', { class: 'board-tb-status', hidden: '' });
    const panel = el('div', { class: 'board-filter', hidden: '' });
    const topicSel = el('select', { 'aria-label': 'Topic' });
    const loSel = el('select', { 'aria-label': 'Learning objective' });
    const clearFilter = el('button', { type: 'button', class: 'board-tb-btn' }, 'Clear filter');
    topicSel.append(el('option', { value: '' }, 'All topics'), el('option', { value: '__none' }, 'Not sorted / no objective'));
    for (const lv of LEVEL_ORDER) {
      const subs = [...new Set(SYL_LOS.filter(lo => lo.level === lv).map(lo => lo.sub))];
      const g = el('optgroup', { label: lv });
      for (const sub of subs) g.appendChild(el('option', { value: lv + '|' + sub }, lv + ' · ' + sub));
      topicSel.appendChild(g);
    }
    const fillLo = () => {
      loSel.innerHTML = '';
      loSel.appendChild(el('option', { value: '' }, 'All learning objectives'));
      if (filter.topic !== '__none') loOptions(loSel, filter.topic);
      loSel.value = filter.lo;
      loSel.disabled = filter.topic === '__none';
    };
    fillLo();
    panel.append(el('label', {}, ['Topic ', topicSel]), el('label', {}, ['Learning objective ', loSel]), clearFilter);
    root.append(el('div', { class: 'board-tb-row' }, [allBtn, clearBtn, count, printBtn, filterBtn, status]), panel);

    allBtn.addEventListener('click', () => {
      visibleBlocks().forEach(b => selected.add(b.id));
      syncTicks(); updateToolbar();
    });
    clearBtn.addEventListener('click', () => { selected.clear(); syncTicks(); updateToolbar(); });
    printBtn.addEventListener('click', printSelected);
    filterBtn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      filterBtn.setAttribute('aria-expanded', String(!panel.hidden));
    });
    topicSel.addEventListener('change', () => { filter.topic = topicSel.value; filter.lo = ''; fillLo(); applyFilter(); });
    loSel.addEventListener('change', () => { filter.lo = loSel.value; applyFilter(); });
    clearFilter.addEventListener('click', () => {
      filter.topic = ''; filter.lo = ''; topicSel.value = ''; fillLo(); applyFilter();
    });
    return { root, count, printBtn, filterBtn, status, allBtn, clearBtn };
  }

  function matches(b) {
    const los = Array.isArray(b.los) ? b.los.map(id => SYL_LO_BY_ID[id]).filter(Boolean) : [];
    if (filter.topic === '__none') return !los.length;
    if (filter.topic && !los.some(lo => lo.level + '|' + lo.sub === filter.topic)) return false;
    if (filter.lo && !los.some(lo => lo.id === filter.lo)) return false;
    return true;
  }
  const visibleBlocks = () => blocks.filter(matches);

  function applyFilter() {
    for (const box of listEl.querySelectorAll('.board-box-saved')) {
      const b = blocks.find(x => x.id === box.dataset.id);
      box.hidden = !!b && !matches(b);
    }
    const n = (filter.topic ? 1 : 0) + (filter.lo ? 1 : 0);
    tb.filterBtn.textContent = n ? '🔎 Filter (' + n + ') · ' + visibleBlocks().length + ' shown' : '🔎 Filter';
    updateToolbar();
  }

  function syncTicks() {
    for (const box of listEl.querySelectorAll('.board-box-saved')) {
      const t = box.querySelector('.board-pick');
      if (t) t.checked = selected.has(box.dataset.id);
    }
  }

  function updateToolbar() {
    for (const id of [...selected]) if (!blocks.some(b => b.id === id)) selected.delete(id);
    tb.count.textContent = selected.size ? selected.size + ' chosen' : '';
    tb.printBtn.disabled = !selected.size;
    tb.root.hidden = !blocks.length;
  }

  async function printSelected() {
    const chosen = blocks.filter(b => selected.has(b.id));
    if (!chosen.length) return;
    tb.printBtn.disabled = true;
    try {
      await printQuestions(chosen.map((b, i) => printItem(b, i + 1)));
    } catch (err) {
      console.error(err);
      showToast('Could not make the printout.', 'error');
    } finally { updateToolbar(); }
  }

  // ── Auto-sorting into learning objectives (v1.5.0) ──
  let sorting = false;
  function refreshChips(block) {
    const wrap = listEl.querySelector('[data-los-for="' + CSS.escape(block.id) + '"]');
    if (wrap) fillChips(board, wrap, block);
  }

  async function sortPending() {
    if (sorting) return;
    sorting = true;
    let tries = 0;
    try {
      while (tries++ < 20) {
        const todo = blocks.filter(needsClassify).slice(0, 20);
        if (!todo.length) break;
        tb.status.hidden = false;
        tb.status.textContent = 'Sorting questions into learning objectives…';
        const snap = new Map(todo.map(b => [b.id, b.questionText]));
        const result = await classifyBatch(todo);
        const next = blocks.slice();
        const changed = [];
        next.forEach((b, i) => {
          if (!result.has(b.id) || b.losManual || snap.get(b.id) !== b.questionText) return;
          const los = result.get(b.id);
          const lo = SYL_LO_BY_ID[los[0]];
          next[i] = cleanBlock({ ...b, los, topic: lo ? lo.sub : '', updatedAt: Date.now() });
          changed.push(next[i]);
        });
        if (!changed.length || !saveBlocks(next)) break;
        blocks = next;
        changed.forEach(refreshChips);
        applyFilter();
      }
    } finally {
      sorting = false;
      tb.status.hidden = true;
    }
  }

  function readyEditors() {
    return editors.filter(e => e.editor && e.editor.hasDraft());
  }

  function updateBatch() {
    const building = editors.filter(e => e.editor && e.editor.isBusy());
    const waiting = building.filter(e => e.editor.isWaiting()).length;
    const running = building.length - waiting;
    const ready = readyEditors().length;
    if (batchEl) {
      const bits = [];
      if (running) bits.push(running + ' building');
      if (waiting) bits.push(waiting + ' waiting');
      if (ready) bits.push(ready + ' ready to save');
      batchEl.textContent = bits.join(' · ');
      batchEl.hidden = !bits.length;
    }
    if (saveAllBtn) {
      saveAllBtn.hidden = ready < 2;
      saveAllBtn.textContent = 'Save all ready (' + ready + ')';
    }
  }

  function saveAllReady() {
    const ready = readyEditors();
    const next = blocks.slice();
    const done = [];
    let skipped = 0;
    ready.forEach(entry => {
      const block = entry.editor.readyBlock(true);
      if (!block) { skipped++; return; }
      const i = next.findIndex(b => b.id === block.id);
      if (i >= 0) next[i] = block; else next.push(block);
      done.push(entry.editor.box);
    });
    if (!done.length) {
      showToast('Nothing is ready to save yet.', 'info');
      return;
    }
    if (!saveBlocks(next)) return;
    blocks = next;
    done.forEach(removeEntry);
    render();
    sortPending();
    showToast('Saved ' + done.length + ' question' + (done.length === 1 ? '' : 's') + '.' +
      (skipped ? ' ' + skipped + ' still need a question typed in.' : ''), 'success');
  }

  addBtn.addEventListener('click', () => board.openNew(1));
  if (saveAllBtn) saveAllBtn.addEventListener('click', saveAllReady);
  if (addBlanksBtn) addBlanksBtn.addEventListener('click', () => board.openNew(blankCountEl ? blankCountEl.value : 1));
  if (pickManyBtn && pickManyInput) {
    pickManyBtn.addEventListener('click', () => pickManyInput.click());
    pickManyInput.addEventListener('change', () => {
      const files = Array.from(pickManyInput.files || []);
      pickManyInput.value = '';
      if (files.length) board.openWithFiles(files);
    });
  }

  // Paste: one picture goes into an empty open box if there is one; several
  // pictures (or no empty box) open a box each.
  document.addEventListener('paste', ev => {
    const target = ev.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const items = ev.clipboardData && ev.clipboardData.items ? Array.from(ev.clipboardData.items) : [];
    const files = items.filter(it => it.kind === 'file' && /^image\//.test(it.type))
      .map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) return;
    ev.preventDefault();
    board.openWithFiles(files);
  });

  // Drop pictures anywhere on the page (boxes handle drops on themselves).
  document.addEventListener('dragover', ev => {
    if (ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files')) ev.preventDefault();
  });
  document.addEventListener('drop', ev => {
    const files = ev.dataTransfer ? imageFiles(ev.dataTransfer.files) : [];
    if (!files.length) return;
    ev.preventDefault();
    board.openWithFiles(files);
  });

  window.addEventListener('beforeunload', ev => {
    if (editors.some(e => e.editor && e.editor.isBusy())) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  render();
  sortPending();
  return board;
}
