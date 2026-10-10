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

import { readStore, writeStore, uid, escapeHtml, el, showToast, readImageFile } from './core.js?v=1.2.2';
import { generateWebapp, tweakWebapp, saveAiConfig, getAiConfig, MODEL_CHOICES } from './ai.js?v=1.2.2';

const BLOCKS_KEY = 'vis_blocks';
const MAX_BLOCKS = 200;
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
// Storage
// ─────────────────────────────────────────────────────────────────────────

function cleanBlock(b) {
  if (!b || typeof b !== 'object' || typeof b.id !== 'string') return null;
  if (typeof b.html !== 'string' || !b.html.trim()) return null;
  return {
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
  };
}

function loadBlocks() {
  const list = readStore(BLOCKS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.map(cleanBlock).filter(Boolean);
}

/** Writes the list; returns false (and says so) when the browser is full. */
function saveBlocks(list) {
  try {
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(list.slice(0, MAX_BLOCKS)));
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

function frameDocument(html, token) {
  const tag = '<script>' + preamble(token).replace(/<\/script/gi, '<\\/script') + '</script>';
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
  const m = String(line).match(/^\(?([1-4A-D])[).:]?\s*(.*)$/);
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
  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'board-file' });
  drop.appendChild(el('div', { class: 'board-drop-icon', 'aria-hidden': 'true' }, '📸'));
  drop.appendChild(el('div', { class: 'board-drop-main' }, 'Paste a screenshot of the question'));
  drop.appendChild(el('div', { class: 'board-drop-sub' }, 'Ctrl+V or ⌘+V, drop it here, or tap to choose one'));
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

    if (d.answers.length) {
      result.appendChild(el('p', { class: 'board-answer-note' },
        'Answer the AI found: ' + d.answers.join(' or ') + ' (kept hidden from your child)'));
    }

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
    setStatus('Reading the question…', 'busy');
    const controller = new AbortController();
    state.controller = controller;
    try {
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
      };
      setStatus(type === 'mcq'
        ? 'Done. It looks like a multiple-choice question. Check it, then Save.'
        : 'Done. It looks like a free-response question. Check it, then Save.', 'ok');
      showResult();
    } catch (err) {
      if (state.controller !== controller) return;
      const msg = err && err.message ? err.message : 'Something went wrong.';
      if (err && err.kind === 'cancelled') {
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

  function save() {
    if (!state.draft || state.building) return;
    const d = state.draft;
    if (!d.questionText.trim()) {
      setStatus('The question is empty. Type it in the box first.', 'error');
      return;
    }
    if (d.type === 'mcq') d.options = d.options.length ? d.options : parseOptions(d.questionText).map(o => '(' + o.label + ') ' + o.text);
    else d.options = [];
    board.commit(cleanBlock(d), box);
  }

  // Wire up.
  drop.addEventListener('click', ev => {
    if (state.building || ev.target === fileInput) return;
    fileInput.click();
  });
  drop.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (f) takeImage(f);
  });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, ev => {
    ev.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', ev => {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) takeImage(f);
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
    isBusy: () => state.building,
    focus: () => drop.focus(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// A saved box: only the question and the app
// ─────────────────────────────────────────────────────────────────────────

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
  box.appendChild(el('div', { class: 'board-num' }, String(index + 1)));
  box.appendChild(questionView(block));
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
  let activeEditor = null;

  const board = {
    commit(block, editorBox) {
      if (!block) return;
      const i = blocks.findIndex(b => b.id === block.id);
      const next = blocks.slice();
      if (i >= 0) next[i] = block; else next.push(block);
      if (!saveBlocks(next)) return;
      blocks = next;
      activeEditor = null;
      render();
      showToast('Saved.', 'success');
      const saved = listEl.querySelector('[data-id="' + CSS.escape(block.id) + '"]');
      if (saved && editorBox) saved.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    closeEditor() {
      activeEditor = null;
      render();
    },
    edit(block) {
      if (activeEditor && activeEditor.isBusy()) {
        showToast('Wait for the box that is building first.', 'info');
        return;
      }
      activeEditor = { editor: null, existing: block };
      render();
    },
    remove(id) {
      const next = blocks.filter(b => b.id !== id);
      if (!saveBlocks(next)) return;
      blocks = next;
      render();
    },
  };

  function render() {
    // Keep a live editor (and its in-flight build) when re-rendering.
    const live = activeEditor && activeEditor.editor ? activeEditor.editor.box : null;
    listEl.innerHTML = '';
    blocks.forEach((block, i) => {
      if (activeEditor && activeEditor.existing && activeEditor.existing.id === block.id) {
        if (!activeEditor.editor) activeEditor.editor = createEditor(board, block);
        listEl.appendChild(activeEditor.editor.box);
      } else {
        listEl.appendChild(createSavedBox(board, block, i));
      }
    });
    if (activeEditor && !activeEditor.existing) {
      if (!activeEditor.editor) activeEditor.editor = createEditor(board, null);
      listEl.appendChild(activeEditor.editor.box);
    }
    if (live && !live.isConnected) { /* editor was closed */ }
    emptyEl.hidden = blocks.length > 0 || !!activeEditor;
    addBtn.hidden = !!activeEditor;
  }

  addBtn.addEventListener('click', () => {
    activeEditor = { editor: null, existing: null };
    render();
    activeEditor.editor.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    activeEditor.editor.focus();
  });

  // A paste anywhere on the page goes into the open box (or opens one).
  document.addEventListener('paste', ev => {
    const target = ev.target;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
    const items = ev.clipboardData && ev.clipboardData.items ? Array.from(ev.clipboardData.items) : [];
    const item = items.find(it => it.kind === 'file' && /^image\//.test(it.type));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    ev.preventDefault();
    if (!activeEditor) {
      activeEditor = { editor: null, existing: null };
      render();
    }
    if (activeEditor.editor.isBusy()) {
      showToast('This box is still building. Press Stop first.', 'info');
      return;
    }
    activeEditor.editor.takeImage(file);
  });

  window.addEventListener('beforeunload', ev => {
    if (activeEditor && activeEditor.editor && activeEditor.editor.isBusy()) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  render();
  return board;
}
