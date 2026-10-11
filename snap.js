// snap.js — "Snap & Play": the screenshot-only section.
//
// A parent pastes (Ctrl/Cmd+V anywhere on the section), drops or picks a
// screenshot of one P3 maths question. gpt-6-luna (via ai.js → the Firebase
// proxy, or this browser's own key as a fallback) builds a whole standalone
// interactive web app for that one question. The app runs large in a
// sandboxed iframe (allow-scripts only: no same-origin, so it can never read
// this site's storage), and the parent can go full screen, rebuild it with a
// "make it…" tweak, read or edit its code, download it as a single .html
// file, or save it into the library and the child's feed.
//
// Past builds live only in THIS browser under `vis_snaps` (newest first, the
// last 20). When storage is full, screenshots are dropped first, then the
// oldest builds, so the newest app always survives a reload.
//
// Public API:
//   initSnap(rootEl, { onChange }) -> { refresh(), destroy() }
//   onChange() fires after something was saved into the library / feed.

import {
  el, uid, showToast, readStore, writeStore, readImageFile, shrinkImageDataUrl,
  STORE_KEYS, escapeHtml,
} from './core.js?v=1.5.0';
import { AI_STORE_KEY, aiReady, describeAiRoute, generateWebapp, saveAiConfig } from './ai.js?v=1.5.0';
import { TOPICS } from './questions.js?v=1.5.0';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

// AI error codes where pasting an OpenAI key is the fix (see ai.js AiError).
const KEY_ERROR_CODES = new Set(['proxy-unreachable', 'no-key', 'bad-key']);

const SNAP_STORE_KEY = 'vis_snaps';
const SNAP_PREFS_KEY = 'vis_snap_prefs';
const MAX_SNAPS = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const THUMB_SIDE = 420;
const SAVED_IMAGE_SIDE = 1000;
const AUTO_BUILD_DELAY_MS = 2200;
const EXPECTED_BUILD_SECONDS = 75;

const TWEAK_IDEAS = [
  'simpler, with fewer words',
  'more drag and drop',
  'use a bar model the child builds',
  'add a number line',
  'show the steps one at a time',
  'bigger buttons for a tablet',
  'more hints before the answer',
  'add a "what if" slider',
];

const PHASES = [
  { at: 0, icon: '🔍', text: 'Reading the question…' },
  { at: 8, icon: '🧮', text: 'Working out the maths (and keeping the answer secret)…' },
  { at: 22, icon: '🧩', text: 'Designing things to drag, tap and slide…' },
  { at: 40, icon: '🛠️', text: 'Writing the web app…' },
  { at: 75, icon: '🎨', text: 'Adding colours, hints and the “check my thinking” bits…' },
  { at: 110, icon: '🔁', text: 'Double-checking everything — big questions take a little longer…' },
  { at: 150, icon: '⏳', text: 'Nearly there — still writing…' },
];

const TIPS = [
  'Tip: ask your child to explain the picture back to you before they type an answer.',
  'Tip: the app never shows the answer until your child asks for it — twice.',
  'Tip: “Rebuild → make it simpler” helps when a question feels too busy.',
  'Tip: Full screen works well on a tablet for little fingers.',
  'Tip: saving to the library also puts the question in the feed.',
  'Tip: crop the screenshot to one question for the best result.',
  'Tip: you can download the app as one .html file and open it offline.',
  'Tip: bar models are how Singapore schools teach word problems — let the child drag them.',
];

// Rough keyword guess for the feed topic; the parent can always change it.
const TOPIC_GUESSES = [
  { id: 'fractions', re: /fraction|\b\d+\s*\/\s*\d+\b|numerator|denominator|half|halves|quarter|third|eighths?|tenths?/i },
  { id: 'money', re: /\$\s*\d|\bcents?\b|\bdollars?\b|\bprice\b|\bcost|\bpaid\b|\bchange\b|\bspent\b|\bsave[ds]?\b/i },
  { id: 'time', re: /\b(a\.m\.|p\.m\.|am|pm)\b|o'clock|\bminutes?\b|\bhours?\b|\bclock\b|\bstarted at\b|\bended at\b/i },
  { id: 'patterns', re: /pattern|next number|sequence|missing number in the|what comes next/i },
  { id: 'placeValue', re: /place value|\bdigit\b|thousands|hundreds|tens|ones|expanded form|in words|round(ed)? (off )?to/i },
  { id: 'mulDiv', re: /\btimes\b|multiply|multiplied|divide|divided|\bshare[ds]? equally|\beach\b.*\bhow many\b|groups? of|\bper\b/i },
  { id: 'comparison', re: /more than|fewer than|less than|how many more|how many fewer|difference|than\b/i },
  { id: 'partWhole', re: /altogether|in all|total|remaining|left\b|how many .* (were|are) there/i },
  { id: 'addSub', re: /\badd\b|\bsum\b|\bplus\b|subtract|minus|\bfind the value\b/i },
];

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────

function topicList() {
  return Array.isArray(TOPICS) && TOPICS.length ? TOPICS : [{ id: 'general', name: 'General', emoji: '📘' }];
}

function guessTopic(text) {
  const list = topicList();
  const ids = new Set(list.map(t => t.id));
  const t = String(text || '');
  const looksMultiStep = (t.match(/\?/g) || []).length > 1 || /\(a\)[\s\S]*\(b\)/i.test(t);
  if (looksMultiStep && ids.has('multiStep')) return 'multiStep';
  for (const g of TOPIC_GUESSES) {
    if (ids.has(g.id) && g.re.test(t)) return g.id;
  }
  return list[0].id;
}

function button(label, opts) {
  const o = opts || {};
  const cls = ['btn'];
  if (o.kind === 'primary') cls.push('btn-primary');
  if (o.kind === 'quiet') cls.push('btn-quiet');
  if (o.kind === 'danger') cls.push('btn-danger');
  if (o.small) cls.push('btn-small');
  if (o.extraClass) cls.push(o.extraClass);
  return el('button', {
    type: 'button',
    class: cls.join(' '),
    title: o.title || null,
    'aria-label': o.ariaLabel || null,
    'aria-pressed': o.pressed == null ? null : String(Boolean(o.pressed)),
    'aria-expanded': o.expanded == null ? null : String(Boolean(o.expanded)),
    'aria-controls': o.controls || null,
    onclick: o.onClick || null,
  }, o.icon ? [el('span', { class: 'snap-btn-icon', 'aria-hidden': 'true', text: o.icon }), ' ' + label] : label);
}

function bounce(node) {
  if (!node) return;
  node.classList.remove('bounce');
  void node.offsetWidth; // restart the animation
  node.classList.add('bounce');
  setTimeout(() => node.classList.remove('bounce'), 700);
}

function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-loading', Boolean(on));
  btn.disabled = Boolean(on);
  btn.setAttribute('aria-busy', on ? 'true' : 'false');
}

function formatWhen(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
    const time = d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return 'Today, ' + time;
    if (yesterday) return 'Yesterday, ' + time;
    return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
  } catch (_) {
    return '';
  }
}

function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return m ? m + ':' + String(s % 60).padStart(2, '0') : s + 's';
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function slugify(text) {
  const s = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'snap-and-play';
}

function splitAnswers(text) {
  // Not on commas: "1,245" is one answer. One per line, or separated by ; or |.
  const seen = new Set();
  const out = [];
  for (const piece of String(text || '').split(/[;\n|]/)) {
    const a = piece.trim();
    if (!a || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
  }
  return out.slice(0, 12);
}

function isTypingTarget(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (node.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(type);
  }
  return false;
}

/** Re-encode a picture as a small JPEG for gallery thumbnails. Always shrinks. */
function makeThumbnail(dataUrl, maxSide, quality) {
  return new Promise(resolve => {
    if (!dataUrl) { resolve(''); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, (maxSide || THUMB_SIDE) / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality || 0.72));
      } catch (_) {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** Resolve true when the browser can actually decode the picture. */
function canDecode(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

function firstImageFile(list) {
  if (!list) return null;
  for (const item of Array.from(list)) {
    // DataTransferItemList entries vs FileList entries.
    if (item && typeof item.getAsFile === 'function') {
      if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
        const f = item.getAsFile();
        if (f) return f;
      }
    } else if (item && /^image\//i.test(item.type || '')) {
      return item;
    }
  }
  return null;
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestFs(node) {
  const fn = node.requestFullscreen || node.webkitRequestFullscreen;
  if (!fn) return Promise.reject(new Error('unsupported'));
  try {
    const out = fn.call(node, { navigationUI: 'hide' });
    return out && typeof out.then === 'function' ? out : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

function exitFs() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!fn) return Promise.resolve();
  try {
    const out = fn.call(document);
    return out && typeof out.then === 'function' ? out.catch(() => {}) : Promise.resolve();
  } catch (_) {
    return Promise.resolve();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sandbox document for the generated app
// ─────────────────────────────────────────────────────────────────────────
//
// The app runs in <iframe sandbox="allow-scripts"> with srcdoc: an opaque
// origin, so it cannot touch this site's localStorage, cookies or DOM. A tiny
// preamble keeps a careless app working anyway (in-memory storage instead of
// a SecurityError, no-op dialogs) and reports script errors back so the
// parent can be offered a rebuild. The downloaded .html never carries it.

function preambleSource(token) {
  return '(function(){' +
    'var T=' + JSON.stringify(token) + ';' +
    'function post(type,msg){try{parent.postMessage({snapFrame:T,type:type,message:String(msg==null?"":msg).slice(0,300)},"*")}catch(_){}}' +
    'function mem(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},' +
    'setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},' +
    'key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}' +
    '["localStorage","sessionStorage"].forEach(function(n){var ok=false;try{window[n].getItem("__snap");ok=true}catch(_){}' +
    'if(!ok){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(_){}}});' +
    'try{window.alert=function(m){post("alert",m)};window.confirm=function(){return true};' +
    'window.prompt=function(m,d){return d==null?"":String(d)};window.open=function(){return null}}catch(_){}' +
    'window.addEventListener("error",function(e){post("error",(e&&e.message||"Script error")+(e&&e.lineno?" (line "+e.lineno+")":""))});' +
    'window.addEventListener("unhandledrejection",function(e){var r=e&&e.reason;post("error",r&&r.message||r||"Promise error")});' +
    'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");' +
    'if(a&&!/^#/.test(a.getAttribute("href")||"")){e.preventDefault()}},true);' +
    'window.addEventListener("load",function(){post("ready","")});' +
    '})();';
}

function frameDocument(html, token) {
  const tag = '<script>' + preambleSource(token).replace(/<\/script/gi, '<\\/script') + '</script>';
  const doc = String(html || '');
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, m => m + tag);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, m => m + '<head>' + tag + '</head>');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    tag + '</head><body>' + doc + '</body></html>';
}

/** Light check that a pasted/edited document is plausibly runnable. */
function looksLikeHtml(code) {
  const s = String(code || '').trim();
  return s.length > 20 && /<[a-z!][\s\S]*>/i.test(s);
}

/** Make an edited fragment into a full document, like ai.js does for replies. */
function wrapIfFragment(code, title) {
  const s = String(code || '').trim();
  if (/<html[\s>]/i.test(s)) return /^<!doctype/i.test(s) ? s : '<!doctype html>\n' + s;
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeHtml(title || 'Snap & Play') + '</title></head><body>\n' + s + '\n</body></html>';
}

// ─────────────────────────────────────────────────────────────────────────
// Gallery storage (vis_snaps)
// ─────────────────────────────────────────────────────────────────────────

function loadSnaps() {
  const list = readStore(SNAP_STORE_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(s => s && typeof s === 'object' && s.id && typeof s.html === 'string' && s.html);
}

function quietWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Save the gallery, keeping the newest MAX_SNAPS. If the browser is full,
 * shed screenshots oldest-first, then whole builds oldest-first; the newest
 * build is the last thing to go. Returns {ok, droppedImages, droppedBuilds}.
 */
function saveSnaps(list) {
  let next = (Array.isArray(list) ? list : []).slice(0, MAX_SNAPS).map(s => Object.assign({}, s));
  const report = { ok: false, droppedImages: 0, droppedThumbs: 0, droppedBuilds: 0 };
  if (quietWrite(SNAP_STORE_KEY, next)) { report.ok = true; return report; }

  // 1. Full screenshots go first, oldest first (the thumbnail stays).
  for (let i = next.length - 1; i >= 0; i--) {
    if (!next[i].image) continue;
    delete next[i].image;
    report.droppedImages++;
    if (quietWrite(SNAP_STORE_KEY, next)) { report.ok = true; return report; }
  }
  // 2. Then the little thumbnails, oldest first.
  for (let i = next.length - 1; i >= 0; i--) {
    if (!next[i].thumb) continue;
    delete next[i].thumb;
    report.droppedThumbs++;
    if (quietWrite(SNAP_STORE_KEY, next)) { report.ok = true; return report; }
  }
  // 3. Then whole builds, oldest first, never the newest one.
  while (next.length > 1) {
    next = next.slice(0, -1);
    report.droppedBuilds++;
    if (quietWrite(SNAP_STORE_KEY, next)) { report.ok = true; return report; }
  }
  // Last try goes through writeStore so the parent hears about the failure.
  report.ok = writeStore(SNAP_STORE_KEY, next);
  return report;
}

function loadPrefs() {
  const p = readStore(SNAP_PREFS_KEY, {});
  return {
    autoBuild: p && typeof p.autoBuild === 'boolean' ? p.autoBuild : true,
    keepImage: p && typeof p.keepImage === 'boolean' ? p.keepImage : true,
    frameHeight: p && Number.isFinite(p.frameHeight) ? p.frameHeight : 0,
  };
}

function savePrefs(patch) {
  const next = Object.assign(loadPrefs(), patch || {});
  quietWrite(SNAP_PREFS_KEY, next);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// initSnap
// ─────────────────────────────────────────────────────────────────────────

export function initSnap(rootEl, opts) {
  if (!rootEl) throw new Error('initSnap needs a root element.');
  const options = opts || {};
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const ids = {
    note: uid('snap-note'),
    noteHelp: uid('snap-note-help'),
    file: uid('snap-file'),
    status: uid('snap-status'),
    result: uid('snap-result'),
    code: uid('snap-code'),
    tweak: uid('snap-tweak'),
    save: uid('snap-save'),
    saveText: uid('snap-save-text'),
    saveAnswers: uid('snap-save-answers'),
    saveTopic: uid('snap-save-topic'),
    saveTitle: uid('snap-save-title'),
    auto: uid('snap-auto'),
    keep: uid('snap-keep'),
    gallery: uid('snap-gallery'),
    heading: uid('snap-heading'),
  };

  const state = {
    image: '',           // the current screenshot (data URL)
    imageName: '',
    run: 0,              // increments per build so stale replies are ignored
    controller: null,    // AbortController for the running build
    building: false,
    startedAt: 0,
    tickTimer: null,
    tipTimer: null,
    autoTimer: null,
    autoStartedAt: 0,
    current: null,       // {id, title, questionText, answers, hint, html, note, image, thumb, createdAt, savedVisId, savedQuestionId}
    frameToken: '',
    frameErrors: [],
    lastError: '',
    pseudoFs: false,
    destroyed: false,
    prefs: loadPrefs(),
  };

  rootEl.classList.add('snap');
  rootEl.innerHTML = '';

  // ── Header ──────────────────────────────────────────────────────────────
  const header = el('header', { class: 'snap-header' }, [
    el('div', { class: 'snap-header-badge', 'aria-hidden': 'true', text: '📸' }),
    el('div', { class: 'snap-header-text' }, [
      el('h2', { class: 'snap-title', id: ids.heading, text: 'Snap & Play' }),
      el('p', {
        class: 'snap-lede',
        text: 'Paste a screenshot of one maths question. The AI builds a little web app your child can drag, tap and slide to understand it — without giving the answer away.',
      }),
    ]),
  ]);

  // ── AI readiness notice ─────────────────────────────────────────────────
  const notice = el('div', { class: 'snap-notice', role: 'note', hidden: true });

  function renderNotice() {
    const ready = aiReady();
    notice.hidden = ready;
    notice.innerHTML = '';
    if (ready) return;
    notice.appendChild(el('div', { class: 'snap-notice-icon', 'aria-hidden': 'true', text: '🔌' }));
    notice.appendChild(el('div', { class: 'snap-notice-body' }, [
      el('strong', { text: 'The AI is not set up in this browser yet.' }),
      el('p', {}, [
        'Snap & Play needs one of two routes: the ',
        el('strong', { text: 'cloud function' }),
        ' (the Firebase proxy “visualiseAi”, which keeps the OpenAI key safely on the server), or a ',
        el('strong', { text: 'personal OpenAI key' }),
        ' saved only in this browser.',
      ]),
      el('p', {}, [
        'Open ',
        el('strong', { text: 'Parent Studio → AI settings' }),
        ' and either keep the default server address or paste your own key. Then come back — this notice disappears on its own.',
      ]),
    ]));
  }

  // ── Drop zone ───────────────────────────────────────────────────────────
  const fileInput = el('input', {
    type: 'file',
    id: ids.file,
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/*',
    class: 'snap-file-input',
    tabindex: '-1',
    'aria-hidden': 'true',
  });

  const dropTitle = el('span', { class: 'snap-drop-title', text: 'Paste a screenshot here' });
  const dropKeys = el('span', { class: 'snap-drop-keys' }, [
    el('kbd', { text: /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl' }),
    ' + ',
    el('kbd', { text: 'V' }),
    ' anywhere on this page, drop a picture, or tap to choose one',
  ]);
  const dropZone = el('div', {
    class: 'snap-drop',
    role: 'button',
    tabindex: '0',
    'aria-describedby': ids.status,
    'aria-label': 'Paste, drop or choose a screenshot of a maths question',
  }, [
    el('span', { class: 'snap-drop-art', 'aria-hidden': 'true' }, [
      el('span', { class: 'snap-drop-art-card' }),
      el('span', { class: 'snap-drop-art-plus', text: '+' }),
    ]),
    dropTitle,
    dropKeys,
  ]);

  const pasteBtn = button('Paste from clipboard', { kind: 'quiet', small: true, icon: '📋', onClick: pasteFromClipboard });
  const chooseBtn = button('Choose a picture', { kind: 'quiet', small: true, icon: '🖼️', onClick: () => fileInput.click() });
  if (!(navigator.clipboard && typeof navigator.clipboard.read === 'function')) pasteBtn.hidden = true;

  // ── Preview ─────────────────────────────────────────────────────────────
  const previewImg = el('img', { class: 'snap-preview-img', alt: 'The screenshot you added' });
  const previewMeta = el('span', { class: 'snap-preview-meta' });
  const replaceBtn = button('Replace', { kind: 'quiet', small: true, onClick: () => fileInput.click() });
  const removeBtn = button('Remove', { kind: 'quiet', small: true, onClick: () => clearImage(true) });
  const preview = el('figure', { class: 'snap-preview', hidden: true }, [
    el('div', { class: 'snap-preview-frame' }, previewImg),
    el('figcaption', { class: 'snap-preview-caption' }, [
      previewMeta,
      el('span', { class: 'snap-preview-actions' }, [replaceBtn, removeBtn]),
    ]),
  ]);

  // ── Note + options ──────────────────────────────────────────────────────
  const noteInput = el('textarea', {
    id: ids.note,
    rows: '2',
    maxlength: '1500',
    'aria-describedby': ids.noteHelp,
    placeholder: 'e.g. “She mixes up more than and fewer than” or “Only part (b) please”',
  });
  const noteField = el('div', { class: 'field snap-note' }, [
    el('label', { for: ids.note, text: 'A note for the AI (optional)' }),
    noteInput,
    el('span', { class: 'help', id: ids.noteHelp, text: 'What your child finds tricky, which part to focus on, or how you want it explained.' }),
  ]);

  const autoBox = el('input', { type: 'checkbox', id: ids.auto });
  autoBox.checked = state.prefs.autoBuild;
  autoBox.addEventListener('change', () => { state.prefs = savePrefs({ autoBuild: autoBox.checked }); });
  const autoLabel = el('label', { class: 'snap-check', for: ids.auto }, [autoBox, ' Start building as soon as I paste']);

  const buildBtn = button('Build the app', { kind: 'primary', icon: '✨', onClick: () => startBuild() });
  buildBtn.classList.add('snap-build-btn');
  const cancelBtn = button('Cancel', { kind: 'quiet', onClick: () => cancelAll('Cancelled. Press “Build the app” when you are ready.') });
  cancelBtn.hidden = true;
  const buildNowBtn = button('Build now', { kind: 'quiet', small: true, onClick: () => { clearAuto(); startBuild(); } });

  const autoBar = el('div', { class: 'snap-auto', hidden: true, role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'snap-auto-ring', 'aria-hidden': 'true' }),
    el('span', { class: 'snap-auto-text', text: 'Building starts in a moment — add a note now if you like.' }),
    buildNowBtn,
  ]);

  const statusLine = el('p', { class: 'snap-status', id: ids.status, role: 'status', 'aria-live': 'polite' });

  const actions = el('div', { class: 'snap-actions' }, [buildBtn, cancelBtn, autoLabel]);

  const inputCard = el('section', { class: 'card snap-input', 'aria-labelledby': ids.heading }, [
    dropZone,
    el('div', { class: 'snap-drop-alt' }, [pasteBtn, chooseBtn]),
    preview,
    noteField,
    autoBar,
    actions,
    statusLine,
    fileInput,
  ]);

  // ── Progress ────────────────────────────────────────────────────────────
  const progressIcon = el('span', { class: 'snap-progress-icon', 'aria-hidden': 'true', text: '🔍' });
  const progressPhase = el('span', { class: 'snap-progress-phase', text: 'Reading the question…' });
  const progressFill = el('span', { class: 'snap-progress-fill' });
  const progressBar = el('div', {
    class: 'snap-progress-bar',
    role: 'progressbar',
    'aria-label': 'Building the app',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  }, progressFill);
  const progressTime = el('span', { class: 'snap-progress-time', text: '0s' });
  const progressRoute = el('span', { class: 'snap-progress-route' });
  const progressTip = el('p', { class: 'snap-progress-tip' });
  const progressThumb = el('img', { class: 'snap-progress-thumb', alt: '' });
  const progressSteps = el('ol', { class: 'snap-progress-steps' },
    PHASES.slice(0, 5).map(p => el('li', { class: 'snap-progress-step' }, [
      el('span', { class: 'snap-progress-step-dot', 'aria-hidden': 'true' }),
      el('span', { text: p.text.replace(/…$/, '') }),
    ])));
  const progressCancel = button('Cancel', { kind: 'quiet', small: true, onClick: () => cancelAll('Cancelled. Press “Build the app” when you are ready.') });
  const progress = el('section', { class: 'card snap-progress', hidden: true, 'aria-live': 'polite', 'aria-busy': 'true' }, [
    el('div', { class: 'snap-progress-head' }, [
      el('div', { class: 'snap-progress-scan', 'aria-hidden': 'true' }, [progressThumb, el('span', { class: 'snap-progress-scanline' })]),
      el('div', { class: 'snap-progress-main' }, [
        el('div', { class: 'snap-progress-title' }, [progressIcon, progressPhase]),
        progressBar,
        el('div', { class: 'snap-progress-sub' }, [progressTime, progressRoute]),
      ]),
    ]),
    progressSteps,
    progressTip,
    el('div', { class: 'snap-progress-foot' }, [
      el('span', { class: 'snap-progress-note', text: 'A whole app is a big job — usually 30 seconds to 2 minutes. You can keep this tab open and do something else.' }),
      progressCancel,
    ]),
  ]);

  // ── Error ───────────────────────────────────────────────────────────────
  const errorText = el('p', { class: 'snap-error-text' });
  const errorRetry = button('Try again', { kind: 'primary', small: true, onClick: () => startBuild(state.lastBuildArgs || undefined) });
  const errorTips = el('ul', { class: 'snap-error-tips' }, [
    el('li', { text: 'Crop the screenshot to just one question.' }),
    el('li', { text: 'Make sure the numbers are sharp and not cut off.' }),
    el('li', { text: 'If it keeps failing, check Parent Studio → AI settings.' }),
  ]);
  const errorKeyId = uid('snap-key');
  const errorKeyInput = el('input', {
    type: 'password', id: errorKeyId, autocomplete: 'off', spellcheck: 'false',
    placeholder: 'sk-…', class: 'snap-error-key-input',
  });
  const errorKeySave = button('Save key and try again', { kind: 'primary', small: true, onClick: () => saveKeyAndRetry() });
  errorKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveKeyAndRetry(); } });
  const errorKeyBox = el('div', { class: 'snap-error-key', hidden: true }, [
    el('label', { for: errorKeyId, text: 'OpenAI key' }),
    el('div', { class: 'snap-error-key-row' }, [errorKeyInput, errorKeySave]),
    el('p', { class: 'help', text: 'The key is kept only in this browser.' }),
  ]);
  function saveKeyAndRetry() {
    const apiKey = errorKeyInput.value.trim();
    if (!apiKey) {
      setStatus('Paste an OpenAI key first.', 'error');
      errorKeyInput.focus();
      return;
    }
    try { saveAiConfig({ apiKey }); } catch (err) {
      setStatus('Could not save the key: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      return;
    }
    errorKeyInput.value = '';
    startBuild(state.lastBuildArgs || undefined);
  }
  const errorBox = el('section', { class: 'card snap-error', hidden: true, role: 'alert' }, [
    el('div', { class: 'snap-error-icon', 'aria-hidden': 'true', text: '😕' }),
    el('div', { class: 'snap-error-body' }, [
      el('strong', { text: 'The AI could not build this one.' }),
      errorText,
      errorTips,
      errorKeyBox,
      el('div', { class: 'snap-error-actions' }, [errorRetry]),
    ]),
  ]);

  // ── Result ──────────────────────────────────────────────────────────────
  const resultTitle = el('h3', { class: 'snap-result-title', tabindex: '-1' });
  const resultMeta = el('p', { class: 'snap-result-meta' });
  const resultQuestion = el('p', { class: 'snap-result-question' });
  const resultQuestionWrap = el('details', { class: 'snap-result-q' }, [
    el('summary', { text: 'The question the AI read' }),
    resultQuestion,
  ]);
  const frameErrorBar = el('div', { class: 'snap-frame-warn', hidden: true, role: 'status' });
  const frameAlertBar = el('div', { class: 'snap-frame-alert', hidden: true, role: 'status', 'aria-live': 'polite' });

  const stage = el('div', { class: 'snap-stage' });
  const stageClose = button('Exit full screen', { kind: 'primary', small: true, icon: '✕', onClick: () => leaveFullscreen() });
  stageClose.classList.add('snap-stage-close');
  const stageWrap = el('div', { class: 'snap-stage-wrap', role: 'region', 'aria-label': 'The interactive app' }, [stage, stageClose]);
  const sizeSmaller = button('Shorter', { kind: 'quiet', small: true, ariaLabel: 'Make the app window shorter', onClick: () => nudgeHeight(-120) });
  const sizeTaller = button('Taller', { kind: 'quiet', small: true, ariaLabel: 'Make the app window taller', onClick: () => nudgeHeight(120) });

  const fsBtn = button('Full screen', { kind: 'primary', icon: '⛶', onClick: () => enterFullscreen() });
  const rebuildBtn = button('Rebuild', { kind: 'quiet', icon: '🔁', controls: ids.tweak, expanded: false, onClick: () => toggleTweak() });
  const codeBtn = button('Show code', { kind: 'quiet', icon: '</>', controls: ids.code, expanded: false, onClick: () => toggleCode() });
  const downloadBtn = button('Download .html', { kind: 'quiet', icon: '⬇️', onClick: () => downloadCurrent() });
  const saveBtn = button('Save to library + feed', { kind: 'quiet', icon: '📚', controls: ids.save, expanded: false, onClick: () => toggleSave() });
  const reloadBtn = button('Restart app', { kind: 'quiet', small: true, icon: '↺', onClick: () => renderFrame() });

  const toolbar = el('div', { class: 'snap-toolbar', role: 'toolbar', 'aria-label': 'App actions' }, [
    fsBtn, rebuildBtn, codeBtn, downloadBtn, saveBtn,
  ]);

  // Tweak / rebuild panel
  const tweakInput = el('input', {
    type: 'text',
    id: ids.tweak + '-input',
    maxlength: '300',
    placeholder: 'simpler, with a number line…',
    autocomplete: 'off',
  });
  const tweakChips = el('div', { class: 'chip-row snap-tweak-chips' }, TWEAK_IDEAS.map(idea => el('button', {
    type: 'button',
    class: 'chip',
    onclick: () => {
      const now = tweakInput.value.trim();
      tweakInput.value = now ? (now.includes(idea) ? now : now + ', ' + idea) : idea;
      tweakInput.focus();
    },
  }, idea)));
  const tweakGo = button('Rebuild it', { kind: 'primary', small: true, icon: '✨', onClick: () => rebuildWithTweak() });
  const tweakPlain = button('Just rebuild', { kind: 'quiet', small: true, onClick: () => { tweakInput.value = ''; rebuildWithTweak(); } });
  tweakInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rebuildWithTweak(); } });
  const tweakPanel = el('div', { class: 'snap-panel snap-tweak', id: ids.tweak, hidden: true }, [
    el('div', { class: 'field' }, [
      el('label', { for: ids.tweak + '-input' }, ['Make it… ', el('span', { class: 'help', text: '(optional)' })]),
      tweakInput,
    ]),
    tweakChips,
    el('div', { class: 'snap-panel-actions' }, [tweakGo, tweakPlain]),
    el('p', { class: 'help', text: 'The current app stays in your gallery below, so nothing is lost.' }),
  ]);

  // Code panel
  const codeArea = el('textarea', {
    id: ids.code + '-area',
    class: 'snap-code-area',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    wrap: 'off',
    'aria-label': 'The app’s HTML code',
  });
  const codeStats = el('span', { class: 'snap-code-stats' });
  const codeApply = button('Run my edits', { kind: 'primary', small: true, icon: '▶', onClick: () => applyCodeEdits() });
  const codeReset = button('Undo my edits', { kind: 'quiet', small: true, onClick: () => { if (state.current) { codeArea.value = state.current.html; updateCodeStats(); } } });
  const codeCopy = button('Copy code', { kind: 'quiet', small: true, icon: '📋', onClick: () => copyCode() });
  codeArea.addEventListener('input', updateCodeStats);
  codeArea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); applyCodeEdits(); }
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // Tab inserts two spaces; Esc then Tab leaves the box (keyboard users).
      if (codeArea.dataset.escaped === '1') { codeArea.dataset.escaped = ''; return; }
      e.preventDefault();
      const start = codeArea.selectionStart;
      const end = codeArea.selectionEnd;
      codeArea.setRangeText('  ', start, end, 'end');
      updateCodeStats();
    }
    if (e.key === 'Escape') codeArea.dataset.escaped = '1';
  });
  const codePanel = el('div', { class: 'snap-panel snap-code', id: ids.code, hidden: true }, [
    el('div', { class: 'snap-code-head' }, [
      el('strong', { text: 'The app’s code' }),
      codeStats,
    ]),
    codeArea,
    el('div', { class: 'snap-panel-actions' }, [codeApply, codeReset, codeCopy]),
    el('p', { class: 'help', text: 'One self-contained HTML file. Edit and press “Run my edits” (Ctrl/⌘ + Enter). Tab indents; press Esc then Tab to leave the box.' }),
  ]);

  // Save panel
  const saveTitle = el('input', { type: 'text', id: ids.saveTitle, maxlength: '60' });
  const saveText = el('textarea', { id: ids.saveText, rows: '3', maxlength: '4000' });
  const saveAnswers = el('textarea', { id: ids.saveAnswers, rows: '2', maxlength: '600', placeholder: 'One accepted answer per line' });
  const saveTopic = el('select', { id: ids.saveTopic },
    topicList().map(t => el('option', { value: t.id }, (t.emoji ? t.emoji + ' ' : '') + t.name)));
  const keepBox = el('input', { type: 'checkbox', id: ids.keep });
  keepBox.checked = state.prefs.keepImage;
  keepBox.addEventListener('change', () => { state.prefs = savePrefs({ keepImage: keepBox.checked }); });
  const saveGo = button('Save it', { kind: 'primary', small: true, icon: '✓', onClick: () => saveToLibrary() });
  const saveVisOnly = button('Library only (no feed card)', { kind: 'quiet', small: true, onClick: () => saveToLibrary({ libraryOnly: true }) });
  const saveStatus = el('p', { class: 'snap-save-status', role: 'status', 'aria-live': 'polite' });
  const answersReveal = button('Show answers', { kind: 'quiet', small: true, onClick: () => toggleAnswersVisible() });
  const savePanel = el('div', { class: 'snap-panel snap-save', id: ids.save, hidden: true }, [
    el('p', { class: 'help', text: 'Saves the app as a visualiser in your library and adds the question to your child’s feed, with the app as its picture.' }),
    el('div', { class: 'snap-save-grid' }, [
      el('div', { class: 'field' }, [el('label', { for: ids.saveTitle, text: 'Name' }), saveTitle]),
      el('div', { class: 'field' }, [el('label', { for: ids.saveTopic, text: 'Topic' }), saveTopic]),
    ]),
    el('div', { class: 'field' }, [el('label', { for: ids.saveText, text: 'Question text' }), saveText]),
    el('div', { class: 'field snap-answers-field' }, [
      el('div', { class: 'snap-answers-head' }, [
        el('label', { for: ids.saveAnswers, text: 'Accepted answers' }),
        answersReveal,
      ]),
      saveAnswers,
      el('span', { class: 'help', text: 'Hidden by default, so you can save while your child is watching. One per line.' }),
    ]),
    el('label', { class: 'snap-check', for: ids.keep }, [keepBox, ' Keep the screenshot with the question']),
    el('div', { class: 'snap-panel-actions' }, [saveGo, saveVisOnly]),
    saveStatus,
  ]);

  const result = el('section', { class: 'card snap-result', id: ids.result, hidden: true, 'aria-labelledby': ids.result + '-title' }, [
    el('div', { class: 'snap-result-head' }, [
      el('div', { class: 'snap-result-heading' }, [resultTitle, resultMeta]),
      el('div', { class: 'snap-size' }, [reloadBtn, sizeSmaller, sizeTaller]),
    ]),
    resultQuestionWrap,
    frameAlertBar,
    frameErrorBar,
    stageWrap,
    toolbar,
    tweakPanel,
    codePanel,
    savePanel,
  ]);
  resultTitle.id = ids.result + '-title';

  // ── Gallery ─────────────────────────────────────────────────────────────
  const galleryGrid = el('ul', { class: 'snap-gallery-grid', id: ids.gallery });
  const galleryCount = el('span', { class: 'snap-gallery-count' });
  const galleryClear = button('Clear all', { kind: 'quiet', small: true, onClick: () => clearGallery() });
  const galleryEmpty = el('p', { class: 'snap-gallery-empty', text: 'Your builds will appear here, ready to reopen instantly — even offline.' });
  const gallery = el('section', { class: 'snap-gallery', 'aria-labelledby': ids.gallery + '-h' }, [
    el('div', { class: 'snap-gallery-head' }, [
      el('h3', { id: ids.gallery + '-h', class: 'snap-gallery-title' }, ['Past builds ', galleryCount]),
      galleryClear,
    ]),
    el('p', { class: 'help', text: 'Kept only in this browser (the last ' + MAX_SNAPS + ').' }),
    galleryEmpty,
    galleryGrid,
  ]);

  const dragVeil = el('div', { class: 'snap-veil', 'aria-hidden': 'true' }, [
    el('div', { class: 'snap-veil-inner' }, [el('span', { class: 'snap-veil-icon', text: '📥' }), el('span', { text: 'Drop the screenshot to build' })]),
  ]);

  rootEl.appendChild(header);
  rootEl.appendChild(notice);
  rootEl.appendChild(inputCard);
  rootEl.appendChild(progress);
  rootEl.appendChild(errorBox);
  rootEl.appendChild(result);
  rootEl.appendChild(gallery);
  rootEl.appendChild(dragVeil);

  // ───────────────────────────────────────────────────────────────────────
  // Status helpers
  // ───────────────────────────────────────────────────────────────────────

  function setStatus(text, kind) {
    statusLine.textContent = text || '';
    statusLine.className = 'snap-status' + (kind ? ' is-' + kind : '');
  }

  function refreshButtons() {
    const ready = aiReady();
    buildBtn.disabled = state.building || !state.image || !ready;
    buildBtn.title = !ready ? 'Set up the AI in Parent Studio → AI settings first'
      : !state.image ? 'Paste or choose a screenshot first' : '';
    cancelBtn.hidden = !state.building && !state.autoTimer;
    rebuildBtn.disabled = state.building || !ready || !(state.current && state.current.image);
    rebuildBtn.title = state.current && !state.current.image
      ? 'This older build no longer has its screenshot. Paste the question again to rebuild.' : '';
    tweakGo.disabled = rebuildBtn.disabled;
    tweakPlain.disabled = rebuildBtn.disabled;
    errorRetry.disabled = state.building || !state.image || !ready;
    rootEl.classList.toggle('is-building', state.building);
    rootEl.classList.toggle('has-image', Boolean(state.image));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Taking a picture in
  // ───────────────────────────────────────────────────────────────────────

  async function acceptFile(file, how) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      setStatus('That is not a picture. Paste or choose a screenshot (PNG or JPEG).', 'error');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus('That picture is very large (' + Math.round(file.size / 1048576) + ' MB). Crop it to the question and try again.', 'error');
      return;
    }
    setStatus('Reading the picture…');
    let dataUrl = '';
    try {
      dataUrl = await readImageFile(file);
    } catch (err) {
      setStatus('Could not read that picture: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      return;
    }
    if (!(await canDecode(dataUrl))) {
      setStatus(/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '')
        ? 'This browser cannot open HEIC photos. Take a screenshot of the photo instead and paste that.'
        : 'This picture could not be opened. Try a PNG or JPEG screenshot.', 'error');
      return;
    }
    // Normalise once: large phone photos become a sensible JPEG here, so the
    // preview, thumbnail and request all agree.
    try { dataUrl = await shrinkImageDataUrl(dataUrl, 1800); } catch (_) { /* keep original */ }
    setImage(dataUrl, file.name || (how === 'paste' ? 'Pasted screenshot' : 'Picture'));
    if (how === 'paste' || how === 'drop') maybeAutoBuild();
    else setStatus('Picture ready. Add a note if you like, then press “Build the app”.', 'ok');
  }

  function setImage(dataUrl, name) {
    // A new picture replaces whatever is running.
    if (state.building) cancelAll('');
    clearAuto();
    state.image = dataUrl;
    state.imageName = name || '';
    previewImg.src = dataUrl;
    previewMeta.textContent = truncate(state.imageName || 'Screenshot', 40);
    preview.hidden = false;
    dropZone.classList.add('has-image');
    dropTitle.textContent = 'Paste another screenshot to replace it';
    errorBox.hidden = true;
    refreshButtons();
  }

  function clearImage(announce) {
    clearAuto();
    state.image = '';
    state.imageName = '';
    previewImg.removeAttribute('src');
    preview.hidden = true;
    dropZone.classList.remove('has-image');
    dropTitle.textContent = 'Paste a screenshot here';
    fileInput.value = '';
    refreshButtons();
    if (announce) {
      setStatus('Picture removed.');
      dropZone.focus();
    }
  }

  function maybeAutoBuild() {
    if (!aiReady()) {
      setStatus('Picture ready — but the AI is not set up yet (see the note above).', 'error');
      return;
    }
    if (!autoBox.checked) {
      setStatus('Picture ready. Press “Build the app” when you are ready.', 'ok');
      buildBtn.focus();
      return;
    }
    clearAuto();
    state.autoStartedAt = Date.now();
    autoBar.hidden = false;
    autoBar.style.setProperty('--snap-auto-ms', AUTO_BUILD_DELAY_MS + 'ms');
    autoBar.classList.remove('is-running');
    void autoBar.offsetWidth;
    autoBar.classList.add('is-running');
    setStatus('Got it! Building starts in a moment…', 'ok');
    state.autoTimer = setTimeout(() => {
      state.autoTimer = null;
      autoBar.hidden = true;
      startBuild();
    }, AUTO_BUILD_DELAY_MS);
    refreshButtons();
  }

  function clearAuto() {
    if (state.autoTimer) clearTimeout(state.autoTimer);
    state.autoTimer = null;
    autoBar.hidden = true;
    autoBar.classList.remove('is-running');
  }

  async function pasteFromClipboard() {
    if (!(navigator.clipboard && navigator.clipboard.read)) {
      setStatus('Press Ctrl+V (or ⌘V on a Mac) to paste.', 'error');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = (item.types || []).find(t => /^image\//i.test(t));
        if (!type) continue;
        const blob = await item.getType(type);
        const file = blob instanceof File ? blob : new File([blob], 'Pasted screenshot', { type });
        await acceptFile(file, 'paste');
        return;
      }
      setStatus('There is no picture on the clipboard. Take a screenshot first, then paste.', 'error');
    } catch (err) {
      setStatus(err && err.name === 'NotAllowedError'
        ? 'The browser blocked clipboard access. Press Ctrl+V (or ⌘V) instead.'
        : 'Could not read the clipboard. Press Ctrl+V (or ⌘V) instead.', 'error');
    }
  }

  // Paste anywhere while the section is visible. Text pastes into the note or
  // other text boxes are left alone; a picture is always taken.
  function sectionVisible() {
    if (state.destroyed || !rootEl.isConnected) return false;
    if (rootEl.closest('[hidden]')) return false;
    return rootEl.getClientRects().length > 0;
  }

  function onDocumentPaste(event) {
    if (!sectionVisible()) return;
    const data = event.clipboardData;
    if (!data) return;
    const file = firstImageFile(data.items) || firstImageFile(data.files);
    if (!file) {
      if (!isTypingTarget(event.target)) {
        setStatus('That paste had no picture in it. Copy a screenshot (not a link), then paste again.', 'error');
      }
      return;
    }
    // Only claim pastes aimed at this section or at nothing in particular.
    const target = event.target;
    const insideOther = target && target.nodeType === 1 && target !== document.body &&
      !rootEl.contains(target) && isTypingTarget(target);
    if (insideOther) return;
    event.preventDefault();
    acceptFile(file, 'paste');
  }

  // Drag and drop over the whole section.
  let dragDepth = 0;
  function hasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return types && Array.from(types).includes('Files');
  }
  function onDragEnter(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    rootEl.classList.add('is-dragging');
  }
  function onDragOver(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
  function onDragLeave(event) {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) rootEl.classList.remove('is-dragging');
  }
  function onDrop(event) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    rootEl.classList.remove('is-dragging');
    const file = firstImageFile(event.dataTransfer.items) || firstImageFile(event.dataTransfer.files);
    if (!file) {
      setStatus('That was not a picture. Drop a PNG or JPEG screenshot.', 'error');
      return;
    }
    acceptFile(file, 'drop');
  }

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) acceptFile(file, 'choose');
    fileInput.value = '';
  });
  rootEl.addEventListener('dragenter', onDragEnter);
  rootEl.addEventListener('dragover', onDragOver);
  rootEl.addEventListener('dragleave', onDragLeave);
  rootEl.addEventListener('drop', onDrop);
  document.addEventListener('paste', onDocumentPaste);

  // ───────────────────────────────────────────────────────────────────────
  // Building
  // ───────────────────────────────────────────────────────────────────────

  function showProgress(routeText) {
    progress.hidden = false;
    errorBox.hidden = true;
    progressRoute.textContent = routeText ? ' · ' + routeText : '';
    progressThumb.src = state.image || '';
    progressFill.style.width = '2%';
    progressBar.setAttribute('aria-valuenow', '2');
    progressTime.textContent = '0s';
    for (const li of progressSteps.children) li.className = 'snap-progress-step';
    let tip = Math.floor(Math.random() * TIPS.length);
    progressTip.textContent = TIPS[tip];
    clearInterval(state.tickTimer);
    clearInterval(state.tipTimer);
    state.tickTimer = setInterval(tick, 500);
    state.tipTimer = setInterval(() => {
      tip = (tip + 1) % TIPS.length;
      progressTip.classList.remove('is-fresh');
      void progressTip.offsetWidth;
      progressTip.textContent = TIPS[tip];
      progressTip.classList.add('is-fresh');
    }, 7000);
    tick();
  }

  function tick() {
    const sec = (Date.now() - state.startedAt) / 1000;
    progressTime.textContent = formatSeconds(sec);
    // Never reaches 100 by itself; the real finish snaps it there.
    const pct = Math.min(96, 2 + 94 * (1 - Math.exp(-sec / (EXPECTED_BUILD_SECONDS * 0.7))));
    progressFill.style.width = pct.toFixed(1) + '%';
    progressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
    let phaseIndex = 0;
    for (let i = 0; i < PHASES.length; i++) if (sec >= PHASES[i].at) phaseIndex = i;
    const phase = PHASES[phaseIndex];
    if (progressPhase.dataset.phase !== String(phaseIndex) && !progressPhase.dataset.override) {
      progressPhase.dataset.phase = String(phaseIndex);
      progressIcon.textContent = phase.icon;
      progressPhase.textContent = phase.text;
      progressPhase.classList.remove('is-fresh');
      void progressPhase.offsetWidth;
      progressPhase.classList.add('is-fresh');
    }
    Array.from(progressSteps.children).forEach((li, i) => {
      li.className = 'snap-progress-step' + (i < phaseIndex ? ' is-done' : i === phaseIndex ? ' is-active' : '');
    });
    // Route messages (e.g. "trying this browser's key") show for a few seconds.
    if (progressPhase.dataset.override && Date.now() > Number(progressPhase.dataset.override)) {
      delete progressPhase.dataset.override;
      progressPhase.dataset.phase = '';
    }
  }

  function routeStatus(text) {
    if (!text) return;
    // Only the interesting transport moments override the playful phase text.
    if (/trying|backup|browser/i.test(text) && state.building) {
      progressIcon.textContent = '🔀';
      progressPhase.textContent = text;
      progressPhase.dataset.override = String(Date.now() + 6000);
    }
    progressRoute.textContent = ' · ' + text.replace(/…$/, '');
  }

  function stopProgress() {
    clearInterval(state.tickTimer);
    clearInterval(state.tipTimer);
    state.tickTimer = null;
    state.tipTimer = null;
    delete progressPhase.dataset.override;
    progressPhase.dataset.phase = '';
  }

  function cancelAll(message) {
    clearAuto();
    if (state.controller) {
      try { state.controller.abort(); } catch (_) { /* ignore */ }
    }
    state.controller = null;
    state.run++;
    state.building = false;
    stopProgress();
    progress.hidden = true;
    setLoading(buildBtn, false);
    setLoading(tweakGo, false);
    refreshButtons();
    if (message) setStatus(message);
  }

  async function startBuild(extra) {
    const x = extra || {};
    state.lastBuildArgs = extra || null;
    const image = x.image || state.image;
    if (!image) {
      setStatus('Paste or choose a screenshot first.', 'error');
      dropZone.focus();
      return;
    }
    if (!aiReady()) {
      renderNotice();
      setStatus('The AI is not set up yet — see the note above.', 'error');
      notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (state.building) cancelAll('');
    clearAuto();

    const run = ++state.run;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.controller = controller;
    state.building = true;
    state.startedAt = Date.now();
    state.lastError = '';
    setLoading(buildBtn, true);
    refreshButtons();
    const baseNote = x.note != null ? x.note : noteInput.value.trim();
    const note = x.tweak
      ? [baseNote, 'The parent asked for a new version of the app. Make it ' + x.tweak + '.' +
          (x.previousTitle ? ' (The previous version was called "' + x.previousTitle + '".)' : '')].filter(Boolean).join('\n')
      : baseNote;
    setStatus(x.tweak ? 'Rebuilding — make it ' + x.tweak + '…' : 'Building your app…');
    showProgress(describeAiRoute());
    progress.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const reply = await generateWebapp({
        imageDataUrl: image,
        note,
        onStatus: text => { if (run === state.run) routeStatus(text); },
        signal: controller ? controller.signal : undefined,
      });
      if (run !== state.run) return;
      progressFill.style.width = '100%';
      progressBar.setAttribute('aria-valuenow', '100');
      progressIcon.textContent = '🎉';
      progressPhase.textContent = 'Done! Opening the app…';
      const thumb = await makeThumbnail(image, THUMB_SIDE, 0.72);
      if (run !== state.run) return;
      const build = {
        id: uid('snap'),
        title: reply.title || 'Snap & Play app',
        questionText: reply.questionText || '',
        answers: Array.isArray(reply.answers) ? reply.answers : [],
        hint: reply.hint || '',
        html: reply.html,
        note: baseNote,
        tweak: x.tweak || '',
        image,
        thumb,
        createdAt: new Date().toISOString(),
        seconds: Math.round((Date.now() - state.startedAt) / 1000),
      };
      rememberBuild(build);
      showBuild(build, { focus: true });
      setStatus('Ready! Built in ' + formatSeconds(build.seconds) + '. Hand it to your child — or go full screen.', 'ok');
      showToast('Your app is ready ✨', 'ok');
    } catch (err) {
      if (run !== state.run) return;
      if (err && err.cancelled) {
        setStatus('Cancelled.');
        return;
      }
      const message = err && err.message ? err.message : String(err || 'Something went wrong.');
      state.lastError = message;
      errorText.textContent = message;
      const needsKey = Boolean(err && KEY_ERROR_CODES.has(err.code));
      errorTips.hidden = needsKey;
      errorKeyBox.hidden = !needsKey;
      errorRetry.hidden = needsKey && err.code !== 'proxy-unreachable';
      errorBox.hidden = false;
      setStatus('The AI could not build it — see below.', 'error');
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      if (run === state.run) {
        state.building = false;
        state.controller = null;
        stopProgress();
        setTimeout(() => { if (!state.building) progress.hidden = true; }, 350);
        setLoading(buildBtn, false);
        setLoading(tweakGo, false);
        refreshButtons();
      }
    }
  }

  function rebuildWithTweak() {
    if (!state.current) return;
    const image = state.current.image;
    if (!image) {
      setStatus('This build has no screenshot kept, so it cannot be rebuilt. Paste the question again.', 'error');
      return;
    }
    if (!aiReady()) {
      renderNotice();
      setStatus('The AI is not set up yet — see the note above.', 'error');
      return;
    }
    const tweak = tweakInput.value.trim();
    setLoading(tweakGo, true);
    // Make the rebuilt picture the current one so "Build" and gallery agree.
    if (state.image !== image) {
      state.image = image;
      previewImg.src = image;
      preview.hidden = false;
      previewMeta.textContent = 'From “' + truncate(state.current.title, 30) + '”';
      dropZone.classList.add('has-image');
    }
    startBuild({ image, note: state.current.note || '', tweak, previousTitle: state.current.title });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Showing a build
  // ───────────────────────────────────────────────────────────────────────

  function showBuild(build, how) {
    state.current = Object.assign({}, build);
    state.frameErrors = [];
    result.hidden = false;
    errorBox.hidden = true;
    resultTitle.textContent = build.title || 'Snap & Play app';
    const bits = [];
    if (build.createdAt) bits.push(formatWhen(build.createdAt));
    if (build.tweak) bits.push('made ' + truncate(build.tweak, 40));
    if (build.savedVisId) bits.push('saved to library ✓');
    resultMeta.textContent = bits.join(' · ');
    resultQuestion.textContent = build.questionText || '(The AI did not transcribe the question.)';
    resultQuestionWrap.hidden = !build.questionText;
    frameAlertBar.hidden = true;
    renderFrame();
    // Panels reflect the new build.
    codeArea.value = build.html;
    updateCodeStats();
    fillSaveForm();
    closePanels();
    highlightGallery();
    if (how && how.focus) {
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { try { resultTitle.focus({ preventScroll: true }); } catch (_) { resultTitle.focus(); } }, 400);
    }
  }

  function renderFrame() {
    if (!state.current) return;
    const token = uid('snapf');
    state.frameToken = token;
    state.frameErrors = [];
    frameErrorBar.hidden = true;
    frameAlertBar.hidden = true;
    const frame = el('iframe', {
      class: 'snap-frame',
      sandbox: 'allow-scripts',
      referrerpolicy: 'no-referrer',
      allow: 'fullscreen',
      title: 'Interactive app: ' + (state.current.title || 'Snap & Play'),
    });
    frame.srcdoc = frameDocument(state.current.html, token);
    stage.innerHTML = '';
    stage.appendChild(frame);
    applyHeight();
  }

  function currentFrame() {
    return stage.querySelector('iframe');
  }

  function applyHeight() {
    const h = state.prefs.frameHeight;
    if (h && !state.pseudoFs && !fullscreenElement()) stage.style.height = h + 'px';
    else stage.style.removeProperty('height');
  }

  function nudgeHeight(delta) {
    const now = stage.getBoundingClientRect().height || 640;
    const next = Math.round(Math.max(360, Math.min(2400, now + delta)));
    state.prefs = savePrefs({ frameHeight: next });
    applyHeight();
  }

  function onFrameMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.snapFrame !== state.frameToken) return;
    const frame = currentFrame();
    if (!frame || event.source !== frame.contentWindow) return;
    if (data.type === 'error') {
      state.frameErrors.push(String(data.message || 'Script error'));
      frameErrorBar.hidden = false;
      frameErrorBar.innerHTML = '';
      frameErrorBar.appendChild(el('span', { text: '⚠️ The app hit a snag (' + truncate(state.frameErrors[0], 90) + ')' +
        (state.frameErrors.length > 1 ? ' and ' + (state.frameErrors.length - 1) + ' more' : '') + '. Parts of it may not work.' }));
      frameErrorBar.appendChild(button('Rebuild it', {
        kind: 'quiet',
        small: true,
        onClick: () => { tweakInput.value = 'work without any script errors'; openPanel('tweak'); tweakInput.focus(); },
      }));
    } else if (data.type === 'alert') {
      frameAlertBar.hidden = false;
      frameAlertBar.textContent = '💬 ' + String(data.message || '');
      clearTimeout(frameAlertBar._t);
      frameAlertBar._t = setTimeout(() => { frameAlertBar.hidden = true; }, 6000);
    }
  }
  window.addEventListener('message', onFrameMessage);

  // ── Full screen (real where supported, a fixed overlay otherwise) ──────
  function enterFullscreen() {
    if (!state.current) return;
    requestFs(stageWrap).then(() => {
      stageWrap.classList.add('is-fullscreen');
      applyHeight();
    }).catch(() => {
      // iPhone Safari and some embeds: fall back to a fixed overlay.
      state.pseudoFs = true;
      stageWrap.classList.add('is-fullscreen', 'is-pseudo');
      document.documentElement.classList.add('snap-noscroll');
      applyHeight();
      stageClose.focus();
    });
  }

  function leaveFullscreen() {
    if (state.pseudoFs) {
      state.pseudoFs = false;
      stageWrap.classList.remove('is-fullscreen', 'is-pseudo');
      document.documentElement.classList.remove('snap-noscroll');
      applyHeight();
      fsBtn.focus();
      return;
    }
    exitFs();
  }

  function onFsChange() {
    if (fullscreenElement() !== stageWrap) {
      stageWrap.classList.remove('is-fullscreen');
      applyHeight();
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  function onKeydown(event) {
    if (event.key === 'Escape' && state.pseudoFs) {
      event.preventDefault();
      leaveFullscreen();
    }
  }
  document.addEventListener('keydown', onKeydown);

  // ── Panels ──────────────────────────────────────────────────────────────
  const panels = {
    tweak: { panel: tweakPanel, btn: rebuildBtn },
    code: { panel: codePanel, btn: codeBtn, labels: ['Show code', 'Hide code'] },
    save: { panel: savePanel, btn: saveBtn },
  };

  function openPanel(name) {
    for (const [key, p] of Object.entries(panels)) {
      const open = key === name;
      p.panel.hidden = !open;
      p.btn.setAttribute('aria-expanded', String(open));
      p.btn.classList.toggle('is-open', open);
      if (p.labels) setBtnLabel(p.btn, p.labels[open ? 1 : 0]);
    }
  }

  function closePanels() { openPanel(null); }

  function togglePanel(name) {
    const isOpen = !panels[name].panel.hidden;
    openPanel(isOpen ? null : name);
    return !isOpen;
  }

  function setBtnLabel(btn, label) {
    const last = btn.lastChild;
    if (last && last.nodeType === 3) last.textContent = ' ' + label;
  }

  function toggleTweak() {
    if (togglePanel('tweak')) {
      tweakInput.focus();
      tweakPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function toggleCode() {
    if (togglePanel('code')) {
      if (state.current && !codeArea.value) codeArea.value = state.current.html;
      updateCodeStats();
      codePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function toggleSave() {
    if (togglePanel('save')) {
      fillSaveForm();
      savePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      (saveText.value ? saveGo : saveText).focus();
    }
  }

  // ── Code ────────────────────────────────────────────────────────────────
  function updateCodeStats() {
    const v = codeArea.value;
    const lines = v ? v.split('\n').length : 0;
    const kb = (new Blob([v]).size / 1024).toFixed(1);
    const edited = state.current && v !== state.current.html;
    codeStats.textContent = lines + ' lines · ' + kb + ' KB' + (edited ? ' · edited' : '');
    codeReset.disabled = !edited;
  }

  function applyCodeEdits() {
    if (!state.current) return;
    const code = codeArea.value;
    if (!looksLikeHtml(code)) {
      showToast('That does not look like HTML yet.', 'error');
      return;
    }
    const html = wrapIfFragment(code, state.current.title);
    state.current.html = html;
    state.current.edited = true;
    codeArea.value = html;
    renderFrame();
    updateCodeStats();
    // Keep the gallery copy in step with the edits.
    const list = loadSnaps();
    const idx = list.findIndex(s => s.id === state.current.id);
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], { html, edited: true });
      saveSnaps(list);
      renderGallery();
    }
    bounce(codeApply);
    showToast('Running your edited version ✓', 'ok');
  }

  async function copyCode() {
    const text = codeArea.value || (state.current && state.current.html) || '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Code copied ✓', 'ok');
    } catch (_) {
      codeArea.focus();
      codeArea.select();
      showToast('Press Ctrl+C (or ⌘C) to copy the selected code.');
    }
  }

  // ── Download ────────────────────────────────────────────────────────────
  function downloadCurrent() {
    if (!state.current) return;
    const html = state.current.html;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: slugify(state.current.title) + '.html', class: 'snap-hidden-link' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    bounce(downloadBtn);
    showToast('Downloaded — open the file in any browser, even offline.', 'ok');
  }

  // ── Save to library + feed ──────────────────────────────────────────────
  let answersVisible = false;
  function toggleAnswersVisible(force) {
    answersVisible = typeof force === 'boolean' ? force : !answersVisible;
    saveAnswers.classList.toggle('is-masked', !answersVisible);
    setBtnLabel(answersReveal, answersVisible ? 'Hide answers' : 'Show answers');
    answersReveal.setAttribute('aria-pressed', String(answersVisible));
  }

  function fillSaveForm() {
    const c = state.current;
    if (!c) return;
    saveTitle.value = c.title || '';
    saveText.value = c.questionText || '';
    saveAnswers.value = (c.answers || []).join('\n');
    saveTopic.value = guessTopic(c.questionText);
    if (!saveTopic.value) saveTopic.value = topicList()[0].id;
    keepBox.checked = state.prefs.keepImage && Boolean(c.image);
    keepBox.disabled = !c.image;
    toggleAnswersVisible(false);
    saveStatus.textContent = c.savedVisId ? 'Already saved once — saving again makes a second copy.' : '';
    saveStatus.className = 'snap-save-status';
  }

  function setSaveStatus(text, kind) {
    saveStatus.textContent = text;
    saveStatus.className = 'snap-save-status' + (kind ? ' is-' + kind : '');
  }

  async function saveToLibrary(saveOpts) {
    const so = saveOpts || {};
    const c = state.current;
    if (!c) return;
    const name = saveTitle.value.trim() || c.title || 'Snap & Play app';
    const text = saveText.value.replace(/\s+/g, ' ').trim();
    const answers = splitAnswers(saveAnswers.value);
    if (!so.libraryOnly) {
      if (!text) {
        setSaveStatus('Type the question text first — the feed shows it above the app.', 'error');
        saveText.focus();
        return;
      }
      if (!answers.length) {
        setSaveStatus('Add at least one accepted answer (it stays hidden from your child).', 'error');
        toggleAnswersVisible(true);
        saveAnswers.focus();
        return;
      }
    }

    setLoading(saveGo, true);
    try {
      const now = new Date().toISOString();
      const vis = {
        id: uid('vis'),
        name: truncate(name, 60),
        code: c.html,
        source: 'ai',
        createdAt: now,
      };
      const visNote = ['Snap & Play', c.note, truncate(text, 160)].filter(Boolean).join(' — ');
      if (visNote) vis.note = visNote;

      const library = readStore(STORE_KEYS.visualisers, []);
      const libList = Array.isArray(library) ? library : [];
      if (!writeStore(STORE_KEYS.visualisers, [vis].concat(libList))) {
        setSaveStatus('Not saved — the browser refused to store it. Try clearing old builds below.', 'error');
        return;
      }

      let questionId = null;
      if (!so.libraryOnly) {
        const record = {
          id: uid('pq'),
          source: 'parent',
          topic: saveTopic.value || topicList()[0].id,
          text,
          answers,
          visualiserId: vis.id,
          createdAt: now,
        };
        if (c.hint) record.hint = c.hint;
        if (keepBox.checked && c.image) {
          try { record.image = await shrinkImageDataUrl(c.image, SAVED_IMAGE_SIDE); } catch (_) { record.image = c.image; }
        }
        const questions = readStore(STORE_KEYS.questions, []);
        const qList = Array.isArray(questions) ? questions : [];
        let ok = writeStore(STORE_KEYS.questions, [record].concat(qList));
        if (!ok && record.image) {
          // Retry without the screenshot before giving up.
          delete record.image;
          ok = writeStore(STORE_KEYS.questions, [record].concat(qList));
          if (ok) showToast('Saved without the screenshot — the browser is nearly full.', 'error');
        }
        if (!ok) {
          // Roll back the visualiser so the library does not collect orphans.
          writeStore(STORE_KEYS.visualisers, libList);
          setSaveStatus('Not saved — the browser is out of space. Untick the screenshot or clear old builds.', 'error');
          return;
        }
        questionId = record.id;
      }

      c.savedVisId = vis.id;
      if (questionId) c.savedQuestionId = questionId;
      c.title = name;
      resultTitle.textContent = name;
      const list = loadSnaps();
      const idx = list.findIndex(s => s.id === c.id);
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], { savedVisId: vis.id, savedQuestionId: questionId || list[idx].savedQuestionId, title: name });
        saveSnaps(list);
      }
      renderGallery();
      bounce(saveBtn);
      setSaveStatus(so.libraryOnly
        ? 'Saved to the library ✓ (find it in Parent Studio → library).'
        : 'Saved ✓ The question is in the feed now, with this app as its picture.', 'ok');
      showToast(so.libraryOnly ? 'Saved to your library ✓' : 'Saved to the library and the feed ✓', 'ok');
      resultMeta.textContent = [formatWhen(c.createdAt), 'saved to library ✓'].filter(Boolean).join(' · ');
      try { onChange(); } catch (err) { try { console.warn('[snap] onChange failed', err); } catch (_) { /* ignore */ } }
    } finally {
      setLoading(saveGo, false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Gallery
  // ───────────────────────────────────────────────────────────────────────

  function rememberBuild(build) {
    const list = loadSnaps().filter(s => s.id !== build.id);
    const entry = Object.assign({}, build);
    // The gallery keeps a small thumbnail plus the screenshot for rebuilds.
    const report = saveSnaps([entry].concat(list));
    if (!report.ok) {
      showToast('Could not keep this build in the gallery — the browser is full.', 'error');
    } else if (report.droppedBuilds) {
      showToast('The browser was full, so the ' + report.droppedBuilds + ' oldest build' +
        (report.droppedBuilds === 1 ? ' was' : 's were') + ' removed from the gallery.');
    } else if (report.droppedImages || report.droppedThumbs) {
      showToast('The browser was nearly full, so screenshots of older builds were dropped (the apps are kept).');
    }
    renderGallery();
  }

  function renderGallery() {
    const list = loadSnaps();
    galleryGrid.innerHTML = '';
    galleryCount.textContent = list.length ? '(' + list.length + ')' : '';
    galleryEmpty.hidden = list.length > 0;
    galleryClear.hidden = list.length === 0;
    for (const snap of list) {
      const img = snap.thumb || snap.image;
      const openBtn = el('button', {
        type: 'button',
        class: 'snap-tile-open',
        'aria-label': 'Open “' + (snap.title || 'app') + '”',
        onclick: () => openSnap(snap.id),
      }, [
        el('span', { class: 'snap-tile-thumb' }, img
          ? el('img', { src: img, alt: '', loading: 'lazy', decoding: 'async' })
          : el('span', { class: 'snap-tile-placeholder', 'aria-hidden': 'true', text: '🧩' })),
        el('span', { class: 'snap-tile-body' }, [
          el('span', { class: 'snap-tile-title', text: snap.title || 'Snap & Play app' }),
          el('span', { class: 'snap-tile-meta' }, [
            formatWhen(snap.createdAt),
            snap.savedVisId ? el('span', { class: 'snap-tile-badge', text: 'saved' }) : null,
            snap.tweak ? el('span', { class: 'snap-tile-badge is-tweak', text: 'tweaked' }) : null,
            snap.edited ? el('span', { class: 'snap-tile-badge is-edit', text: 'edited' }) : null,
          ]),
        ]),
      ]);
      const delBtn = el('button', {
        type: 'button',
        class: 'snap-tile-delete',
        'aria-label': 'Delete “' + (snap.title || 'app') + '” from this gallery',
        title: 'Delete from gallery',
        onclick: event => { event.stopPropagation(); deleteSnap(snap.id); },
      }, '✕');
      galleryGrid.appendChild(el('li', {
        class: 'snap-tile' + (state.current && state.current.id === snap.id ? ' is-current' : ''),
        'data-id': snap.id,
      }, [openBtn, delBtn]));
    }
  }

  function highlightGallery() {
    for (const li of galleryGrid.children) {
      li.classList.toggle('is-current', Boolean(state.current && li.getAttribute('data-id') === state.current.id));
    }
  }

  function openSnap(id) {
    const snap = loadSnaps().find(s => s.id === id);
    if (!snap) { renderGallery(); return; }
    if (state.building) cancelAll('');
    showBuild(snap, { focus: true });
    setStatus('Reopened “' + truncate(snap.title, 40) + '”.', 'ok');
  }

  let pendingDelete = null;
  function deleteSnap(id) {
    const list = loadSnaps();
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) return;
    const removed = list[idx];
    list.splice(idx, 1);
    saveSnaps(list);
    pendingDelete = { item: removed, index: idx };
    renderGallery();
    if (state.current && state.current.id === id) {
      // Keep it on screen; it just is no longer in the gallery.
      resultMeta.textContent = (resultMeta.textContent ? resultMeta.textContent + ' · ' : '') + 'removed from gallery';
    }
    showUndo('Removed “' + truncate(removed.title, 30) + '” from the gallery.');
  }

  const undoBar = el('div', { class: 'snap-undo', hidden: true, role: 'status', 'aria-live': 'polite' });
  gallery.insertBefore(undoBar, galleryGrid);
  function showUndo(text) {
    undoBar.innerHTML = '';
    undoBar.appendChild(el('span', { text }));
    undoBar.appendChild(button('Undo', {
      kind: 'quiet',
      small: true,
      onClick: () => {
        if (!pendingDelete) return;
        const list = loadSnaps();
        if (Array.isArray(pendingDelete.items)) {
          saveSnaps(pendingDelete.items.concat(list.filter(s => !pendingDelete.items.some(p => p.id === s.id))));
        } else {
          list.splice(Math.min(pendingDelete.index, list.length), 0, pendingDelete.item);
          saveSnaps(list);
        }
        pendingDelete = null;
        undoBar.hidden = true;
        renderGallery();
      },
    }));
    undoBar.hidden = false;
    clearTimeout(undoBar._t);
    undoBar._t = setTimeout(() => { undoBar.hidden = true; pendingDelete = null; }, 8000);
  }

  function clearGallery() {
    const list = loadSnaps();
    if (!list.length) return;
    if (galleryClear.dataset.armed !== '1') {
      galleryClear.dataset.armed = '1';
      setBtnLabelPlain(galleryClear, 'Tap again to clear ' + list.length);
      clearTimeout(galleryClear._t);
      galleryClear._t = setTimeout(() => {
        galleryClear.dataset.armed = '';
        setBtnLabelPlain(galleryClear, 'Clear all');
      }, 3500);
      return;
    }
    galleryClear.dataset.armed = '';
    setBtnLabelPlain(galleryClear, 'Clear all');
    saveSnaps([]);
    pendingDelete = { items: list };
    renderGallery();
    showUndo('Cleared ' + list.length + ' build' + (list.length === 1 ? '' : 's') + '.');
  }

  function setBtnLabelPlain(btn, label) {
    btn.textContent = label;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Live refresh (AI settings changed in Studio, another tab, focus…)
  // ───────────────────────────────────────────────────────────────────────

  function refresh() {
    if (state.destroyed) return;
    renderNotice();
    refreshButtons();
    renderGallery();
  }

  function onStorage(event) {
    if (!event || event.key == null || event.key === SNAP_STORE_KEY || event.key === AI_STORE_KEY) refresh();
  }
  function onFocus() { renderNotice(); refreshButtons(); }
  function onVisibility() { if (document.visibilityState === 'visible') onFocus(); }
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);

  function destroy() {
    state.destroyed = true;
    cancelAll('');
    document.removeEventListener('paste', onDocumentPaste);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('message', onFrameMessage);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
    document.documentElement.classList.remove('snap-noscroll');
    rootEl.innerHTML = '';
    rootEl.classList.remove('snap', 'is-building', 'has-image', 'is-dragging');
  }

  // ── First paint ─────────────────────────────────────────────────────────
  toggleAnswersVisible(false);
  renderNotice();
  refreshButtons();
  renderGallery();
  setStatus(aiReady() ? 'Waiting for a screenshot. Take one of a single question, then paste it here.' : '');

  return { refresh, destroy };
}
