// core.js — shared plumbing for Visualise.
//
// Storage, tiny helpers, toasts, the drawn ✓ / ✗ feedback marks, confetti,
// and the SANDBOX that every pasted or AI-written visualiser runs inside.
//
// Everything a parent pastes in is untrusted code. It never runs in this
// page's own window: it runs in an <iframe sandbox="allow-scripts"> with NO
// allow-same-origin, so it cannot read localStorage (where the OpenAI key
// lives), cannot touch this page's DOM and cannot open popups. The only
// channel back is postMessage, and the page only listens for one message
// shape — a height report — so the frame can size itself to its content.

export const APP_VERSION = 'v1.2.0';

// ─────────────────────────────────────────────────────────────────────────
// Storage. Every key is prefixed `vis_` so nothing here can collide with the
// other Polymath apps that share this GitHub Pages origin (cer uses `sq_`).
// Reads never throw: a private window or blocked storage just means an empty
// library, which the page renders correctly.
// ─────────────────────────────────────────────────────────────────────────
export const STORE_KEYS = {
  questions: 'vis_questions',
  visualisers: 'vis_visualisers',
  settings: 'vis_settings',
  progress: 'vis_progress',
};

export function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // A full or blocked store is the one failure a parent must hear about:
    // a question they think is saved and is not would vanish on reload.
    showToast('Could not save — this browser is refusing storage (' + (err && err.name || 'error') + ').', 'error');
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  // The whole point of the app: a question's answer box stays locked until
  // the child has opened the picture at least once.
  requireVisualFirst: true,
  // How often a parent-written question appears among generated ones
  // (1 = every card is a parent question when there are any).
  parentShare: 0.5,
  // Which generated topics are switched on.
  topics: null, // null = all
  difficulty: 'core', // 'warmup' | 'core' | 'stretch'
};

export function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, readStore(STORE_KEYS.settings, {}));
}

export function saveSettings(patch) {
  const next = Object.assign(getSettings(), patch || {});
  writeStore(STORE_KEYS.settings, next);
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// Small helpers.
// ─────────────────────────────────────────────────────────────────────────
export function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i]; copy[i] = copy[j]; copy[j] = t;
  }
  return copy;
}

export function formatNumber(n) {
  return Number(n).toLocaleString('en-SG');
}

export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else node.setAttribute(key, value === true ? '' : value);
    }
  }
  if (children != null) {
    for (const child of [].concat(children).flat(Infinity)) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

// The answer a child types is compared loosely: spaces, commas in big
// numbers, a leading "$", trailing units and letter case are all forgiven,
// and any of a list of accepted answers ("1/2", "0.5", "half") is fine.
export function normaliseAnswer(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[,\s]/g, '')
    .replace(/^\$/, '')
    .replace(/(cm²|cm2|m²|m2|cm|km|kg|ml|mins?|minutes?|hours?|h|g|l|m|\$|¢|cents?|dollars?)$/i, '')
    .replace(/\.0+$/, '')
    .trim();
}

export function answerMatches(given, accepted) {
  const g = normaliseAnswer(given);
  if (!g) return false;
  const list = Array.isArray(accepted) ? accepted : String(accepted).split('|');
  return list.some(a => {
    const n = normaliseAnswer(a);
    if (n === g) return true;
    const gn = Number(g), an = Number(n);
    return Number.isFinite(gn) && Number.isFinite(an) && Math.abs(gn - an) < 1e-9;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Toasts.
// ─────────────────────────────────────────────────────────────────────────
let toastTimer = null;
export function showToast(message, kind) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast ' + (kind || ''); }, kind === 'error' ? 6000 : 3200);
}

// ─────────────────────────────────────────────────────────────────────────
// Feedback marks — a ✓ or ✗ that draws itself (stroke-dashoffset), then the
// message slides in. Sequential, never simultaneous.
// ─────────────────────────────────────────────────────────────────────────
export function feedbackMarkSvg(correct) {
  if (correct) {
    return '<svg class="mark mark-tick" viewBox="0 0 52 52" aria-hidden="true">' +
      '<circle class="mark-ring" cx="26" cy="26" r="24"/>' +
      '<path class="mark-path" d="M14 27 l8 8 l16 -18"/></svg>';
  }
  return '<svg class="mark mark-cross" viewBox="0 0 52 52" aria-hidden="true">' +
    '<circle class="mark-ring" cx="26" cy="26" r="24"/>' +
    '<path class="mark-path" d="M17 17 L35 35"/><path class="mark-path mark-path-2" d="M35 17 L17 35"/></svg>';
}

export function burstConfetti(anchor) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = anchor.getBoundingClientRect();
  const colours = ['#A5D6A7', '#C8E6C9', '#FFE0B2', '#BBDEFB', '#D1C4E9', '#FFCDD2'];
  const layer = el('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
  document.body.appendChild(layer);
  for (let i = 0; i < 28; i++) {
    const bit = el('span', { class: 'confetti-bit' });
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 90;
    bit.style.left = (rect.left + rect.width / 2) + 'px';
    bit.style.top = (rect.top + rect.height / 2) + 'px';
    bit.style.background = colours[i % colours.length];
    bit.style.setProperty('--dx', Math.cos(angle) * distance + 'px');
    bit.style.setProperty('--dy', Math.sin(angle) * distance - 40 + 'px');
    bit.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
    layer.appendChild(bit);
  }
  setTimeout(() => layer.remove(), 1200);
}

// ─────────────────────────────────────────────────────────────────────────
// THE SANDBOX.
//
// A visualiser is whatever the parent pasted, or whatever the AI wrote. It
// can be:
//   • a whole HTML document            (<!doctype html> … / <html> …)
//   • an HTML fragment                 (<svg> …, <div> … <script> …)
//   • bare JavaScript                  (it gets a #app div to draw into)
// `buildSandboxDocument` turns any of the three into one complete document,
// and injects `window.QUESTION` (the card's question, never its answer) so a
// generic visualiser can read the numbers it is meant to draw.
// ─────────────────────────────────────────────────────────────────────────
export function detectSnippetKind(code) {
  const text = String(code || '').trim();
  if (!text) return 'empty';
  if (/^<!doctype|<html[\s>]/i.test(text)) return 'document';
  if (/^</.test(text) || /<(svg|div|canvas|script|style|section|p|table|button|input)[\s>]/i.test(text)) return 'fragment';
  return 'script';
}

const SANDBOX_BASE_CSS = [
  'html,body{margin:0;padding:0;background:#fff;color:#1A1A1A;',
  "font-family:'Century Gothic',CenturyGothic,AppleGothic,sans-serif;}",
  'body{padding:16px;box-sizing:border-box;}',
  'button{font-family:inherit;font-size:15px;padding:8px 14px;border-radius:10px;',
  'border:1px solid #d9d9d9;background:#fff;cursor:pointer;}',
  'button:hover{background:#F1F8F1;}',
  '#app{min-height:40px;}',
].join('');

// The resize reporter is the ONLY thing this page accepts from a frame.
const SANDBOX_REPORTER = [
  '(function(){',
  'var token=' + 'window.__VIS_TOKEN__' + ';',
  'function report(){try{var h=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0);',
  'parent.postMessage({visSandbox:token,height:h},"*");}catch(e){}}',
  'window.addEventListener("load",report);',
  'if(window.ResizeObserver){try{new ResizeObserver(report).observe(document.documentElement);}catch(e){}}',
  'setInterval(report,800);',
  'window.addEventListener("error",function(ev){var b=document.createElement("pre");',
  'b.style.cssText="color:#b71c1c;background:#fff3f3;padding:8px;border-radius:8px;white-space:pre-wrap;font-size:12px";',
  'b.textContent="This visualiser hit an error: "+(ev.message||"unknown");(document.body||document.documentElement).appendChild(b);report();});',
  '})();',
].join('');

function scriptTag(source) {
  // A literal "</script>" inside injected data would end the tag early.
  return '<script>' + String(source).replace(/<\/script/gi, '<\\/script') + '</script>';
}

export function buildSandboxDocument(code, questionData, token) {
  const kind = detectSnippetKind(code);
  const safeQuestion = questionData ? {
    text: questionData.text || '',
    topic: questionData.topic || '',
    numbers: questionData.numbers || extractNumbers(questionData.text || ''),
    params: questionData.visual && questionData.visual.params ? questionData.visual.params : null,
  } : null;
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + SANDBOX_BASE_CSS + '</style>' +
    scriptTag('window.__VIS_TOKEN__=' + JSON.stringify(token || '') + ';window.QUESTION=' + JSON.stringify(safeQuestion) + ';') +
    scriptTag(SANDBOX_REPORTER);

  if (kind === 'empty') {
    return '<!doctype html><html><head>' + head + '</head><body><p style="color:#888">Nothing to show yet.</p></body></html>';
  }
  if (kind === 'document') {
    const text = String(code);
    if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, m => m + head);
    if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, m => m + '<head>' + head + '</head>');
    return head + text;
  }
  if (kind === 'fragment') {
    return '<!doctype html><html><head>' + head + '</head><body>' + code + '</body></html>';
  }
  return '<!doctype html><html><head>' + head + '</head><body><div id="app"></div>' + scriptTag(code) + '</body></html>';
}

export function extractNumbers(text) {
  return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, '')));
}

const sandboxFrames = new Map();
let sandboxListenerBound = false;

function bindSandboxListener() {
  if (sandboxListenerBound) return;
  sandboxListenerBound = true;
  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.visSandbox !== 'string') return;
    const frame = sandboxFrames.get(data.visSandbox);
    if (!frame || frame.contentWindow !== event.source) return;
    const height = Math.max(120, Math.min(1400, Number(data.height) || 0));
    if (height) frame.style.height = height + 'px';
  });
}

export function mountSandbox(container, code, questionData) {
  bindSandboxListener();
  const token = uid('sbx');
  const frame = el('iframe', {
    class: 'sandbox-frame',
    sandbox: 'allow-scripts',
    referrerpolicy: 'no-referrer',
    title: 'Visualiser',
    loading: 'lazy',
  });
  frame.style.height = '280px';
  frame.srcdoc = buildSandboxDocument(code, questionData, token);
  sandboxFrames.set(token, frame);
  container.innerHTML = '';
  container.appendChild(frame);
  // Forget frames that have left the page so the map does not grow forever.
  const forget = () => {
    for (const [key, f] of sandboxFrames) if (!f.isConnected) sandboxFrames.delete(key);
  };
  setTimeout(forget, 30000);
  return frame;
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the picture.'));
    reader.readAsDataURL(file);
  });
}

// A phone photo can be 12 MP; the model needs nowhere near that and the
// request would be enormous. Shrink to a sensible longest side as JPEG.
export function shrinkImageDataUrl(dataUrl, maxSide) {
  const limit = maxSide || 1600;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, limit / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale >= 1 && dataUrl.length < 3_000_000) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
