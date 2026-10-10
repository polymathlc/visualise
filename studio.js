// ─────────────────────────────────────────────────────────────────────────
// Parent Studio
//
// Four cards, top to bottom:
//   1. Add a question        — text, answers, unit, hint, topic, screenshot,
//                              and an optional picture (built-in visualiser,
//                              one from the library, or the question's own code).
//   2. Paste a visualiser    — HTML / fragment / JS snippet, live sandbox
//                              preview, saved to the visualiser library.
//   3. Screenshot → visualiser (AI) — paste / drop / pick a screenshot, the AI
//                              transcribes the question and writes a picture.
//   4. Settings & backup     — feed settings, export / import / clear.
//
// Everything is kept in this browser (localStorage via core.js). The module
// calls onChange() after every data change so the feed can pick it up.
// ─────────────────────────────────────────────────────────────────────────
import {
  APP_VERSION,
  STORE_KEYS,
  DEFAULT_SETTINGS,
  readStore,
  writeStore,
  getSettings,
  saveSettings,
  uid,
  el,
  showToast,
  detectSnippetKind,
  mountSandbox,
  readImageFile,
  shrinkImageDataUrl,
} from './core.js?v=1.2.1';
import { VISUALISERS, renderVisual } from './visualisers.js?v=1.2.1';
import { TOPICS, loadParentQuestions, saveParentQuestions } from './questions.js?v=1.2.1';
import { getAiConfig, saveAiConfig, aiReady, generateVisualiser } from './ai.js?v=1.2.1';

const AI_MODEL_LABEL = 'gpt-6-luna';
const QUESTION_IMAGE_MAX_SIDE = 1200;
const AI_IMAGE_MAX_SIDE = 1600;
const PREVIEW_DELAY = 450;
const SANDBOX_DELAY = 700;

const KIND_LABELS = {
  empty: 'Nothing yet',
  document: 'Full HTML page',
  fragment: 'HTML fragment',
  script: 'JavaScript (draws into #app)',
};

const KIND_HELP = {
  empty: 'Paste some code to see it here.',
  document: 'A complete page with <html>. It runs as-is inside a locked-down frame.',
  fragment: 'Some HTML (and maybe <script> / <style>). It is placed inside a blank page.',
  script: 'Plain JavaScript. It runs in a page with an empty <div id="app"> to draw into.',
};

const STARTER_SNIPPET = [
  '<div id="app"></div>',
  '<script>',
  '  // window.QUESTION = { text, topic, numbers, params }',
  '  const q = window.QUESTION || { text: "", numbers: [] };',
  '  const app = document.getElementById("app");',
  '  const nums = q.numbers.length ? q.numbers : [3, 5];',
  '  const max = Math.max(...nums, 1);',
  '  app.innerHTML = "<p style=\\"margin:0 0 8px\\">" + (q.text || "My picture") + "</p>";',
  '  nums.forEach((n, i) => {',
  '    const bar = document.createElement("div");',
  '    bar.style.cssText = "height:30px;margin:6px 0;border-radius:8px;display:flex;align-items:center;padding:0 10px;' +
    'background:" + (i % 2 ? "#BBDEFB" : "#C8E6C9") + ";width:" + Math.max(12, (n / max) * 100) + "%";',
  '    bar.textContent = n;',
  '    app.appendChild(bar);',
  '  });',
  '</script>',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────
function topicList() {
  const list = Array.isArray(TOPICS) && TOPICS.length ? TOPICS : [{ id: 'general', name: 'General', emoji: '📘' }];
  return list;
}

function topicById(id) {
  return topicList().find(t => t.id === id) || null;
}

function topicLabel(id) {
  const topic = topicById(id);
  if (!topic) return id ? String(id) : 'No topic';
  return (topic.emoji ? topic.emoji + ' ' : '') + topic.name;
}

function sampleQuestion() {
  return {
    id: 'sample',
    source: 'parent',
    topic: topicList()[0].id,
    text: 'Mei Ling has 236 stickers. Her brother has 187 more stickers than her. How many stickers does her brother have?',
    answers: ['423'],
    unit: 'stickers',
    hint: 'Draw a bar for Mei Ling, then a longer bar for her brother.',
  };
}

function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

function parseAnswers(text) {
  const seen = new Set();
  const out = [];
  for (const piece of String(text || '').split(/[,;\n]/)) {
    const answer = piece.trim();
    if (!answer) continue;
    const key = answer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(answer);
  }
  return out;
}

function answersToText(list) {
  return (Array.isArray(list) ? list : list ? [list] : []).join(', ');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function truncate(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function button(label, className, onClick, attrs) {
  return el('button', Object.assign({ type: 'button', class: className || 'btn', onclick: onClick }, attrs || {}), label);
}

function setLoading(btn, loading, busyLabel) {
  if (loading) {
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyLabel) btn.setAttribute('aria-label', busyLabel);
  } else {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.removeAttribute('aria-label');
  }
}

function bounce(btn) {
  btn.classList.remove('bounce');
  void btn.offsetWidth; // restart the animation
  btn.classList.add('bounce');
}

function setStatus(line, message, kind) {
  line.textContent = message || '';
  line.className = 'status-line' + (kind ? ' ' + kind : '');
}

// A labelled field. `control` may be a node or an array of nodes.
function field(labelText, control, opts) {
  const options = opts || {};
  const id = options.id || (control && control.id) || uid('f');
  const first = Array.isArray(control) ? control[0] : control;
  if (first && !first.id) first.id = id;
  return el('div', { class: 'field' + (options.full ? ' full' : '') + (options.className ? ' ' + options.className : '') }, [
    el('label', { for: first ? first.id : id, text: labelText }),
    control,
    options.help ? el('span', { class: 'help', text: options.help }) : null,
  ]);
}

function makeSelect(options, value, attrs) {
  const select = el('select', attrs || {});
  fillSelect(select, options, value);
  return select;
}

function fillSelect(select, options, value) {
  select.innerHTML = '';
  for (const opt of options) {
    const node = el('option', { value: opt.value, text: opt.label });
    if (opt.disabled) node.disabled = true;
    select.appendChild(node);
  }
  if (value != null && options.some(o => o.value === value)) select.value = value;
}

function topicOptions() {
  return topicList().map(t => ({ value: t.id, label: topicLabel(t.id) }));
}

function loadLibrary() {
  const list = readStore(STORE_KEYS.visualisers, []);
  return Array.isArray(list) ? list.filter(v => v && typeof v === 'object' && v.id) : [];
}

function saveLibrary(list) {
  return writeStore(STORE_KEYS.visualisers, list);
}

function loadQuestions() {
  try {
    const list = loadParentQuestions();
    return Array.isArray(list) ? list.filter(q => q && typeof q === 'object' && q.id) : [];
  } catch (error) {
    console.error('Could not load questions', error);
    return [];
  }
}

function storeQuestions(list) {
  try {
    return saveParentQuestions(list) !== false;
  } catch (error) {
    console.error('Could not save questions', error);
    showToast('Could not save the questions: ' + (error && error.message || 'unknown error'), 'error');
    return false;
  }
}

function findVisualiser(id) {
  return id ? loadLibrary().find(v => v.id === id) || null : null;
}

function describeVisual(q) {
  if (q.visual && q.visual.kind) {
    const entry = VISUALISERS[q.visual.kind];
    return '🧩 ' + (entry ? entry.name : q.visual.kind);
  }
  if (q.visualiserId) {
    const vis = findVisualiser(q.visualiserId);
    return vis ? '📚 ' + vis.name : '⚠️ missing visualiser';
  }
  if (q.code) return '💻 own code';
  return 'no picture';
}

function imageFromClipboard(event) {
  const data = event.clipboardData;
  if (!data) return null;
  for (const item of Array.from(data.items || [])) {
    if (item.kind === 'file' && /^image\//.test(item.type)) return item.getAsFile();
  }
  for (const file of Array.from(data.files || [])) {
    if (/^image\//.test(file.type)) return file;
  }
  return null;
}

function isVisible(node) {
  return !!node && node.isConnected && node.getClientRects().length > 0;
}

function byteSize(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? raw.length * 2 : 0;
  } catch (error) {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ─────────────────────────────────────────────────────────────────────────
// Question preview — how the child will see it (minus the answer box).
// ─────────────────────────────────────────────────────────────────────────
function renderQuestionPreview(q, container, opts) {
  const options = opts || {};
  container.innerHTML = '';
  if (!q || (!q.text && !q.image && !q.visual && !q.visualiserId && !q.code)) {
    container.appendChild(el('p', { class: 'list-empty', text: options.emptyText || 'Start typing a question to see a preview.' }));
    return;
  }
  const head = el('div', { class: 'card-head' }, [
    el('span', { class: 'topic-tag from-parent', text: topicLabel(q.topic) }),
    q.visualiserId && findVisualiser(q.visualiserId) && findVisualiser(q.visualiserId).source === 'ai'
      ? el('span', { class: 'topic-tag from-ai', text: '✨ AI picture' }) : null,
  ]);
  container.appendChild(head);
  if (q.image) container.appendChild(el('img', { class: 'question-image', src: q.image, alt: 'Screenshot of the original question' }));
  if (q.text) container.appendChild(el('p', { class: 'question-text', text: q.text }));

  const stage = el('div', { class: 'visual-stage' });
  let hasVisual = false;
  if (q.visual && q.visual.kind) {
    hasVisual = true;
    const holder = el('div', { class: 'vis-block' });
    stage.appendChild(holder);
    const ok = renderVisual(q.visual.kind, q.visual.params, holder, {});
    if (!ok && !VISUALISERS[q.visual.kind]) holder.appendChild(el('p', { class: 'status-line error', text: 'Unknown visualiser: ' + q.visual.kind }));
  } else if (q.visualiserId) {
    hasVisual = true;
    const vis = findVisualiser(q.visualiserId);
    if (vis) mountSandbox(stage, vis.code, q);
    else stage.appendChild(el('p', { class: 'status-line error', text: 'The linked visualiser is no longer in your library.' }));
  } else if (q.code) {
    hasVisual = true;
    mountSandbox(stage, q.code, q);
  }
  if (hasVisual) {
    container.appendChild(el('div', { class: 'visual-panel' }, [
      el('div', { class: 'visual-panel-head' }, [el('span', { class: 'visual-panel-title', text: '🔍 Picture it' })]),
      stage,
    ]));
  }

  const answers = Array.isArray(q.answers) ? q.answers : [];
  container.appendChild(el('p', { class: 'list-item-meta studio-answer-line' }, [
    el('strong', { text: 'Accepted: ' }),
    answers.length ? answers.join(' · ') : '— none yet —',
    q.unit ? ' (' + q.unit + ')' : '',
  ]));
  if (q.hint) container.appendChild(el('div', { class: 'hint-box', text: '💡 ' + q.hint }));
}

// ─────────────────────────────────────────────────────────────────────────
// Image picker — click, drop, or paste a screenshot.
// ─────────────────────────────────────────────────────────────────────────
function createImagePicker(registry, opts) {
  const options = opts || {};
  let dataUrl = null;
  let busy = false;

  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const prompt = el('div', { class: 'studio-drop-prompt' }, [
    el('span', { class: 'big', text: options.icon || '🖼️' }),
    el('strong', { text: options.label || 'Add a screenshot' }),
    el('div', { class: 'help', text: options.help || 'Click to choose, drag a picture here, or paste with Ctrl/⌘ + V.' }),
  ]);
  const img = el('img', { alt: options.alt || 'Chosen screenshot' });
  img.hidden = true;
  const zone = el('div', {
    class: 'drop-zone',
    tabindex: '0',
    role: 'button',
    'aria-label': (options.label || 'Add a screenshot') + ' — click, drop or paste',
  }, [prompt, img, fileInput]);
  const removeBtn = button('Remove picture', 'btn btn-quiet btn-small', () => api.set(null));
  removeBtn.hidden = true;
  const status = el('div', { class: 'status-line' });
  const element = el('div', { class: 'studio-picker' }, [zone, el('div', { class: 'button-row studio-picker-row' }, [removeBtn, status])]);

  async function acceptFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      showToast('That file is not a picture. Try a PNG or JPG screenshot.', 'error');
      return;
    }
    if (busy) return;
    busy = true;
    setStatus(status, 'Reading the picture…');
    try {
      const raw = await readImageFile(file);
      const small = await shrinkImageDataUrl(raw, options.maxSide || QUESTION_IMAGE_MAX_SIDE);
      api.set(small);
      setStatus(status, 'Picture ready (' + formatBytes(Math.round(small.length * 0.75)) + ').', 'ok');
    } catch (error) {
      setStatus(status, 'Could not read that picture: ' + (error && error.message || 'unknown error'), 'error');
    } finally {
      busy = false;
    }
  }

  zone.addEventListener('click', event => {
    if (event.target === fileInput) return;
    registry.active = api;
    fileInput.click();
  });
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  zone.addEventListener('focus', () => { registry.active = api; });
  zone.addEventListener('pointerenter', () => { registry.active = api; });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    acceptFile(file);
  });
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('is-over');
    registry.active = api;
    const files = Array.from(event.dataTransfer && event.dataTransfer.files || []);
    const file = files.find(f => /^image\//.test(f.type)) || files[0];
    if (file) acceptFile(file);
  });

  const api = {
    element,
    zone,
    get: () => dataUrl,
    acceptFile,
    set(value) {
      dataUrl = value || null;
      if (dataUrl) {
        img.src = dataUrl;
        img.hidden = false;
        prompt.querySelector('strong').textContent = 'Picture added — click or paste to replace it';
      } else {
        img.removeAttribute('src');
        img.hidden = true;
        prompt.querySelector('strong').textContent = options.label || 'Add a screenshot';
        setStatus(status, '');
      }
      removeBtn.hidden = !dataUrl;
      if (typeof options.onChange === 'function') options.onChange(dataUrl);
    },
  };
  registry.pickers.push(api);
  return api;
}

// ─────────────────────────────────────────────────────────────────────────
// initStudio
// ─────────────────────────────────────────────────────────────────────────
export function initStudio(rootEl, opts) {
  if (!rootEl) throw new Error('initStudio needs a root element');
  const options = opts || {};
  const notify = () => {
    try {
      if (typeof options.onChange === 'function') options.onChange();
    } catch (error) {
      console.error('onChange failed', error);
    }
  };

  // Every section registers a refresh(); a data change anywhere refreshes all,
  // so the library dropdown in card 1 sees a visualiser saved in card 2 or 3.
  const refreshers = [];
  const refreshAll = () => {
    for (const fn of refreshers) {
      try { fn(); } catch (error) { console.error('Studio refresh failed', error); }
    }
  };
  const changed = () => {
    refreshAll();
    notify();
  };

  const pickerRegistry = { pickers: [], active: null };

  rootEl.innerHTML = '';
  rootEl.classList.add('studio');

  const nav = el('nav', { class: 'chip-row studio-nav', 'aria-label': 'Studio sections' });
  rootEl.appendChild(nav);

  const sections = [];
  function addSection(number, title, lead, id) {
    const card = el('section', { class: 'card studio-card', id, 'aria-labelledby': id + 'Title' }, [
      el('h2', { class: 'section-title', id: id + 'Title' }, [el('span', { class: 'step-badge', text: String(number) }), title]),
      lead ? el('p', { class: 'section-lead', text: lead }) : null,
    ]);
    rootEl.appendChild(card);
    const chip = button(number + '. ' + title, 'chip', () => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    nav.appendChild(chip);
    sections.push({ card, chip });
    return card;
  }

  const questionApi = buildQuestionSection(addSection(1, 'Add a question',
    'Type a question your child found hard, list the answers you will accept, and attach a picture that helps them see it.',
    'studioQuestion'));
  const libraryApi = buildLibrarySection(addSection(2, 'Paste a visualiser',
    'Got a picture-maker from somewhere else (or written by an AI chat)? Paste its HTML or JavaScript here, test it, and keep it in your library.',
    'studioLibrary'));
  buildAiSection(addSection(3, 'Screenshot → visualiser (AI)',
    'Paste a screenshot of a worksheet question. The AI reads it, writes down the question and answer, and builds a picture for it.',
    'studioAi'));
  buildSettingsSection(addSection(4, 'Settings & backup',
    'Choose how the feed behaves, and keep a copy of everything you have made.',
    'studioSettings'));

  // Clipboard paste anywhere in the studio goes to the picker under the
  // pointer / last used, else the AI picker (the most common use).
  const onPaste = event => {
    if (!isVisible(rootEl)) return;
    const file = imageFromClipboard(event);
    if (!file) return;
    const target = event.target;
    const inside = pickerRegistry.pickers.find(p => p.element.contains(target));
    const picker = inside || pickerRegistry.active || pickerRegistry.pickers[pickerRegistry.pickers.length - 1];
    if (!picker) return;
    event.preventDefault();
    picker.acceptFile(file);
    picker.zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  document.addEventListener('paste', onPaste);

  refreshAll();

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Add a question
  // ═══════════════════════════════════════════════════════════════════════
  function buildQuestionSection(card) {
    const state = { editingId: null, mode: 'none', keepCreatedAt: null, keepSource: null };

    const textInput = el('textarea', { rows: '3', placeholder: 'e.g. A shop sold 1,248 apples on Monday and 389 fewer on Tuesday. How many apples did it sell on Tuesday?' });
    const answersInput = el('input', { type: 'text', placeholder: 'e.g. 859, 859 apples', autocomplete: 'off' });
    const unitInput = el('input', { type: 'text', placeholder: 'e.g. apples, cm, $', autocomplete: 'off' });
    const hintInput = el('textarea', { rows: '2', placeholder: 'e.g. Draw a long bar for Monday and a shorter one for Tuesday.' });
    const topicSelect = makeSelect(topicOptions(), topicList()[0].id);

    const imagePicker = createImagePicker(pickerRegistry, {
      label: 'Add a screenshot of the question (optional)',
      help: 'Shown above the question. Click, drop a picture, or paste with Ctrl/⌘ + V.',
      maxSide: QUESTION_IMAGE_MAX_SIDE,
      onChange: () => schedulePreview(),
    });

    // ── visual mode chips ────────────────────────────────────────────────
    const modes = [
      { id: 'none', label: 'No picture' },
      { id: 'builtin', label: '🧩 Built-in picture' },
      { id: 'library', label: '📚 From my library' },
      { id: 'code', label: '💻 Its own code' },
    ];
    const modeChips = {};
    const modeRow = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Picture type' });
    for (const mode of modes) {
      const chip = button(mode.label, 'chip', () => setMode(mode.id), { 'aria-pressed': 'false' });
      modeChips[mode.id] = chip;
      modeRow.appendChild(chip);
    }

    // built-in
    const kindOptions = Object.entries(VISUALISERS).map(([kind, entry]) => ({ value: kind, label: entry.name }));
    const kindSelect = makeSelect(kindOptions, kindOptions[0] && kindOptions[0].value);
    const paramsInput = el('textarea', { class: 'code studio-params', spellcheck: 'false', rows: '8' });
    const paramsStatus = el('div', { class: 'status-line' });
    const sampleBtn = button('Reset to sample', 'btn btn-quiet btn-small', () => {
      paramsInput.value = JSON.stringify(VISUALISERS[kindSelect.value].sample, null, 2);
      schedulePreview.flush();
    });
    const formatBtn = button('Tidy JSON', 'btn btn-quiet btn-small', () => {
      try {
        paramsInput.value = JSON.stringify(JSON.parse(paramsInput.value || '{}'), null, 2);
        schedulePreview.flush();
      } catch (error) {
        setStatus(paramsStatus, 'Cannot tidy: ' + error.message, 'error');
      }
    });
    const paramsHelp = el('p', { class: 'help studio-params-help' });
    const builtinPanel = el('div', { class: 'studio-mode-panel form-grid' }, [
      field('Picture', kindSelect, { help: 'Each one has sensible sample settings to start from.' }),
      el('div', { class: 'field' }, [el('span', { class: 'help', text: 'Change the numbers below to match your question. The preview updates as you type.' })]),
      field('Settings (JSON)', paramsInput, { full: true }),
      el('div', { class: 'full button-row' }, [sampleBtn, formatBtn, paramsStatus]),
      el('div', { class: 'full' }, [paramsHelp]),
    ]);

    // library
    const librarySelect = el('select');
    const libraryNote = el('p', { class: 'help' });
    const libraryPanel = el('div', { class: 'studio-mode-panel' }, [
      field('Visualiser from your library', librarySelect, { help: 'Add more in card 2 (paste) or card 3 (AI).' }),
      libraryNote,
    ]);

    // own code
    const codeInput = el('textarea', { class: 'code', spellcheck: 'false', placeholder: 'Paste HTML or JavaScript that draws a picture for just this question.' });
    const codeKind = el('div', { class: 'status-line' });
    const codePanel = el('div', { class: 'studio-mode-panel' }, [
      field('Code for this question only', codeInput, { help: 'Runs in a locked-down frame. It can read window.QUESTION (text, topic, numbers).' }),
      codeKind,
    ]);

    const modePanels = { builtin: builtinPanel, library: libraryPanel, code: codePanel };

    // ── preview + actions ────────────────────────────────────────────────
    const preview = el('div', { class: 'preview-box studio-preview', 'aria-live': 'polite' });
    const formStatus = el('div', { class: 'status-line' });
    const saveBtn = button('Save question', 'btn btn-primary', () => save());
    const cancelBtn = button('Cancel editing', 'btn btn-quiet', () => resetForm());
    const clearBtn = button('Clear form', 'btn btn-quiet', () => {
      if (hasDraft() && !window.confirm('Clear everything you have typed in this form?')) return;
      resetForm();
    });
    cancelBtn.hidden = true;
    const editingBanner = el('div', { class: 'studio-editing', hidden: true });

    const form = el('form', { class: 'form-grid studio-form', novalidate: true, onsubmit: event => { event.preventDefault(); save(); } }, [
      editingBanner,
      field('Question', textInput, { full: true, help: 'Write it the way it appears on the worksheet.' }),
      field('Accepted answers', answersInput, { help: 'Separate with commas — any one of them counts as correct (e.g. 1/2, 0.5, half).' }),
      field('Unit (optional)', unitInput, { help: 'Shown next to the answer box.' }),
      field('Hint (optional)', hintInput, { full: true, help: 'Shown after a wrong try. Point at the picture, not the answer.' }),
      field('Topic', topicSelect),
      el('div', { class: 'field' }, [el('span', { class: 'help', text: 'The topic lets the feed mix your question in with the right practice.' })]),
      el('div', { class: 'field full' }, [el('label', { text: 'Screenshot (optional)' }), imagePicker.element]),
      el('div', { class: 'field full' }, [el('label', { text: 'Attach a picture' }), modeRow]),
      el('div', { class: 'full' }, [builtinPanel, libraryPanel, codePanel]),
      el('div', { class: 'field full' }, [el('label', { text: 'Preview — how your child will see it' }), preview]),
      el('div', { class: 'full button-row' }, [saveBtn, cancelBtn, clearBtn, formStatus]),
    ]);
    card.appendChild(form);

    // ── saved list ───────────────────────────────────────────────────────
    const searchInput = el('input', { type: 'search', placeholder: 'Search your questions…', 'aria-label': 'Search saved questions' });
    const topicFilter = makeSelect([{ value: '', label: 'All topics' }].concat(topicOptions()), '', { 'aria-label': 'Filter by topic' });
    const countLine = el('span', { class: 'list-item-meta' });
    const list = el('div', { class: 'list' });
    card.appendChild(el('div', { class: 'studio-list-head' }, [
      el('h3', { text: 'Your saved questions' }),
      countLine,
    ]));
    card.appendChild(el('div', { class: 'studio-filters' }, [
      el('div', { class: 'field' }, [searchInput]),
      el('div', { class: 'field' }, [topicFilter]),
    ]));
    card.appendChild(list);
    searchInput.addEventListener('input', debounce(() => renderList(), 200));
    topicFilter.addEventListener('change', () => renderList());

    // ── behaviour ────────────────────────────────────────────────────────
    function setMode(mode) {
      state.mode = mode;
      for (const [id, chip] of Object.entries(modeChips)) chip.setAttribute('aria-pressed', id === mode ? 'true' : 'false');
      for (const [id, panel] of Object.entries(modePanels)) panel.hidden = id !== mode;
      if (mode === 'builtin' && !paramsInput.value.trim()) {
        paramsInput.value = JSON.stringify(VISUALISERS[kindSelect.value].sample, null, 2);
      }
      schedulePreview.flush();
    }

    function describeParams() {
      const entry = VISUALISERS[kindSelect.value];
      if (!entry) { paramsHelp.textContent = ''; return; }
      paramsHelp.textContent = 'Sample for ' + entry.name + ': ' + JSON.stringify(entry.sample);
    }

    kindSelect.addEventListener('change', () => {
      paramsInput.value = JSON.stringify(VISUALISERS[kindSelect.value].sample, null, 2);
      describeParams();
      schedulePreview.flush();
    });
    librarySelect.addEventListener('change', () => { describeLibraryChoice(); schedulePreview.flush(); });
    codeInput.addEventListener('input', () => { showCodeKind(); scheduleSandboxPreview(); });
    paramsInput.addEventListener('input', () => schedulePreview());
    for (const input of [textInput, answersInput, unitInput, hintInput]) input.addEventListener('input', () => {
      // Sandbox pictures re-run on every rebuild, so text edits wait a little longer.
      if (state.mode === 'library' || state.mode === 'code') scheduleSandboxPreview();
      else schedulePreview();
    });
    topicSelect.addEventListener('change', () => schedulePreview());

    function showCodeKind() {
      const kind = detectSnippetKind(codeInput.value);
      setStatus(codeKind, 'Detected: ' + KIND_LABELS[kind] + ' — ' + KIND_HELP[kind]);
    }

    function describeLibraryChoice() {
      const vis = findVisualiser(librarySelect.value);
      if (!vis) {
        libraryNote.textContent = loadLibrary().length ? 'Choose a visualiser.' : 'Your library is empty — paste one in card 2 or make one with the AI in card 3.';
        return;
      }
      libraryNote.textContent = (vis.source === 'ai' ? '✨ Made by AI' : '📋 Pasted') + ' · ' +
        KIND_LABELS[detectSnippetKind(vis.code)] + (vis.createdAt ? ' · saved ' + formatDate(vis.createdAt) : '') +
        (vis.note ? ' · ' + truncate(vis.note, 80) : '');
    }

    function refreshLibrarySelect() {
      const library = loadLibrary();
      const current = librarySelect.value;
      const opts = library.length
        ? [{ value: '', label: '— choose a visualiser —' }].concat(library.map(v => ({ value: v.id, label: (v.source === 'ai' ? '✨ ' : '') + v.name })))
        : [{ value: '', label: '(library is empty)' }];
      fillSelect(librarySelect, opts, current);
      describeLibraryChoice();
    }

    function buildDraft() {
      const errors = [];
      const draft = {
        id: state.editingId || 'draft',
        source: state.keepSource || 'parent',
        topic: topicSelect.value,
        text: textInput.value.trim(),
        answers: parseAnswers(answersInput.value),
      };
      const unit = unitInput.value.trim();
      const hint = hintInput.value.trim();
      if (unit) draft.unit = unit;
      if (hint) draft.hint = hint;
      const image = imagePicker.get();
      if (image) draft.image = image;

      if (state.mode === 'builtin') {
        const kind = kindSelect.value;
        let params = null;
        const raw = paramsInput.value.trim();
        try {
          params = raw ? JSON.parse(raw) : clone(VISUALISERS[kind].sample);
          if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('settings must be an object { … }');
        } catch (error) {
          errors.push('The picture settings are not valid JSON (' + error.message + ').');
          params = null;
        }
        if (params) draft.visual = { kind, params };
      } else if (state.mode === 'library') {
        if (librarySelect.value) draft.visualiserId = librarySelect.value;
        else errors.push('Choose a visualiser from your library, or pick “No picture”.');
      } else if (state.mode === 'code') {
        const code = codeInput.value.trim();
        if (code) draft.code = code;
        else errors.push('Paste some code for the picture, or pick “No picture”.');
      }
      return { draft, errors };
    }

    function updatePreview() {
      const { draft, errors } = buildDraft();
      if (state.mode === 'builtin') {
        const bad = errors.find(e => e.startsWith('The picture settings'));
        setStatus(paramsStatus, bad || 'Settings look good.', bad ? 'error' : 'ok');
      }
      renderQuestionPreview(draft, preview);
    }
    const schedulePreview = debounce(updatePreview, PREVIEW_DELAY);
    const scheduleSandboxPreview = debounce(updatePreview, SANDBOX_DELAY);

    function hasDraft() {
      return !!(textInput.value.trim() || answersInput.value.trim() || hintInput.value.trim() || imagePicker.get() ||
        (state.mode === 'code' && codeInput.value.trim()));
    }

    function resetForm() {
      state.editingId = null;
      state.keepCreatedAt = null;
      state.keepSource = null;
      textInput.value = '';
      answersInput.value = '';
      unitInput.value = '';
      hintInput.value = '';
      codeInput.value = '';
      paramsInput.value = '';
      imagePicker.set(null);
      saveBtn.textContent = 'Save question';
      cancelBtn.hidden = true;
      editingBanner.hidden = true;
      setStatus(formStatus, '');
      setMode('none');
      showCodeKind();
    }

    function loadIntoForm(q, asCopy) {
      state.editingId = asCopy ? null : q.id;
      state.keepCreatedAt = asCopy ? null : q.createdAt || null;
      state.keepSource = asCopy ? null : q.source || null;
      textInput.value = q.text || '';
      answersInput.value = answersToText(q.answers);
      unitInput.value = q.unit || '';
      hintInput.value = q.hint || '';
      if (q.topic && !topicById(q.topic)) {
        // Keep an imported topic we do not know about rather than silently changing it.
        topicSelect.appendChild(el('option', { value: q.topic, text: q.topic }));
      }
      topicSelect.value = q.topic || topicList()[0].id;
      imagePicker.set(q.image || null);
      codeInput.value = q.code || '';
      if (q.visual && q.visual.kind && VISUALISERS[q.visual.kind]) {
        kindSelect.value = q.visual.kind;
        paramsInput.value = JSON.stringify(q.visual.params || VISUALISERS[q.visual.kind].sample, null, 2);
        describeParams();
        setMode('builtin');
      } else if (q.visualiserId) {
        refreshLibrarySelect();
        librarySelect.value = q.visualiserId;
        if (librarySelect.value !== q.visualiserId) {
          setStatus(formStatus, 'The visualiser this question used is no longer in your library.', 'error');
        }
        describeLibraryChoice();
        setMode('library');
      } else if (q.code) {
        showCodeKind();
        setMode('code');
      } else {
        paramsInput.value = '';
        setMode('none');
      }
      if (!asCopy) {
        saveBtn.textContent = 'Update question';
        cancelBtn.hidden = false;
        editingBanner.hidden = false;
        editingBanner.textContent = '✏️ Editing a saved question — “' + truncate(q.text, 60) + '”';
      } else {
        saveBtn.textContent = 'Save question';
        cancelBtn.hidden = true;
        editingBanner.hidden = true;
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => textInput.focus({ preventScroll: true }), 300);
    }

    function save() {
      const { draft, errors } = buildDraft();
      if (!draft.text && !draft.image) errors.unshift('Type the question (or add a screenshot of it).');
      if (!draft.answers.length) errors.unshift('Add at least one accepted answer.');
      if (errors.length) {
        setStatus(formStatus, errors[0], 'error');
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        showToast(errors[0], 'error');
        return;
      }
      const list = loadQuestions();
      const now = new Date().toISOString();
      const record = Object.assign({}, draft, {
        id: state.editingId || uid('pq'),
        source: state.keepSource || 'parent',
        createdAt: state.keepCreatedAt || now,
      });
      if (state.editingId) record.updatedAt = now;
      let next;
      if (state.editingId) {
        const index = list.findIndex(q => q.id === state.editingId);
        next = list.slice();
        if (index >= 0) next[index] = record; else next.unshift(record);
      } else {
        next = [record].concat(list);
      }
      if (!storeQuestions(next)) {
        setStatus(formStatus, 'Not saved — the browser refused to store it. A smaller screenshot may help.', 'error');
        return;
      }
      const wasEditing = !!state.editingId;
      bounce(saveBtn);
      showToast(wasEditing ? 'Question updated ✓' : 'Question saved — it will appear in the feed ✓', 'ok');
      resetForm();
      setStatus(formStatus, wasEditing ? 'Updated.' : 'Saved. Add another?', 'ok');
      changed();
    }

    function removeQuestion(q) {
      if (!window.confirm('Delete this question?\n\n“' + truncate(q.text || 'Untitled', 120) + '”')) return;
      const next = loadQuestions().filter(item => item.id !== q.id);
      if (!storeQuestions(next)) return;
      if (state.editingId === q.id) resetForm();
      showToast('Question deleted.', 'ok');
      changed();
    }

    function duplicateQuestion(q) {
      const list = loadQuestions();
      const copy = Object.assign(clone(q), { id: uid('pq'), createdAt: new Date().toISOString(), source: 'parent' });
      delete copy.updatedAt;
      const index = list.findIndex(item => item.id === q.id);
      const next = list.slice();
      next.splice(index >= 0 ? index + 1 : 0, 0, copy);
      if (!storeQuestions(next)) return;
      showToast('Copy made — edit it to change the numbers.', 'ok');
      changed();
      loadIntoForm(copy, false);
    }

    function renderList() {
      const all = loadQuestions();
      const term = searchInput.value.trim().toLowerCase();
      const topic = topicFilter.value;
      const shown = all.filter(q => {
        if (topic && q.topic !== topic) return false;
        if (!term) return true;
        return [q.text, q.hint, answersToText(q.answers), q.unit].some(s => String(s || '').toLowerCase().includes(term));
      });
      countLine.textContent = all.length
        ? (shown.length === all.length ? all.length + ' saved' : shown.length + ' of ' + all.length + ' shown')
        : '';
      list.innerHTML = '';
      if (!all.length) {
        list.appendChild(el('div', { class: 'list-empty', text: 'No questions yet. The ones you save appear here and in the feed.' }));
        return;
      }
      if (!shown.length) {
        list.appendChild(el('div', { class: 'list-empty', text: 'Nothing matches that search.' }));
        return;
      }
      for (const q of shown) list.appendChild(questionItem(q));
    }

    function questionItem(q) {
      const previewHolder = el('div', { class: 'preview-box studio-item-preview' });
      previewHolder.hidden = true;
      const previewBtn = button('Preview', 'btn btn-quiet btn-small', () => {
        previewHolder.hidden = !previewHolder.hidden;
        previewBtn.textContent = previewHolder.hidden ? 'Preview' : 'Hide preview';
        previewBtn.setAttribute('aria-expanded', String(!previewHolder.hidden));
        if (!previewHolder.hidden) renderQuestionPreview(q, previewHolder);
        else previewHolder.innerHTML = '';
      }, { 'aria-expanded': 'false' });
      const thumb = q.image ? el('img', { class: 'studio-thumb', src: q.image, alt: '' }) : null;
      return el('div', { class: 'list-item' + (state.editingId === q.id ? ' is-editing' : '') }, [
        thumb,
        el('div', { class: 'list-item-main' }, [
          el('div', { class: 'list-item-title', text: truncate(q.text || '(screenshot only)', 140) }),
          el('div', { class: 'list-item-meta', text: [
            topicLabel(q.topic),
            'answer: ' + truncate(answersToText(q.answers), 40) + (q.unit ? ' ' + q.unit : ''),
            describeVisual(q),
            q.hint ? 'has hint' : null,
            q.createdAt ? formatDate(q.createdAt) : null,
          ].filter(Boolean).join(' · ') }),
          el('div', { class: 'button-row studio-item-actions' }, [
            previewBtn,
            button('Edit', 'btn btn-quiet btn-small', () => loadIntoForm(q, false)),
            button('Duplicate', 'btn btn-quiet btn-small', () => duplicateQuestion(q)),
            button('Delete', 'btn btn-danger btn-small', () => removeQuestion(q)),
          ]),
          previewHolder,
        ]),
      ]);
    }

    refreshers.push(() => {
      refreshLibrarySelect();
      renderList();
    });

    describeParams();
    resetForm();

    return {
      // Called from card 2: start a new question that uses this visualiser.
      startWithVisualiser(visId) {
        // A half-typed new question keeps its text and just gets the picture.
        if (state.editingId &&
          !window.confirm('You are editing a saved question. Press OK to attach this visualiser to it, or Cancel to start a new question.')) {
          resetForm();
        }
        refreshLibrarySelect();
        librarySelect.value = visId;
        describeLibraryChoice();
        setMode('library');
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => textInput.focus({ preventScroll: true }), 300);
        setStatus(formStatus, 'Visualiser attached — now type the question and its answer.', 'ok');
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Paste a visualiser
  // ═══════════════════════════════════════════════════════════════════════
  function buildLibrarySection(card) {
    const state = { editingId: null, editingSource: null, editingCreatedAt: null };

    const nameInput = el('input', { type: 'text', placeholder: 'e.g. Comparing two amounts', autocomplete: 'off', maxlength: '80' });
    const noteInput = el('input', { type: 'text', placeholder: 'Where it came from, or what it is good for', autocomplete: 'off' });
    const codeInput = el('textarea', { class: 'code', spellcheck: 'false', placeholder: '<div id="app"></div>\n<script>\n  // draw something…\n</script>' });
    const kindLine = el('div', { class: 'status-line' });
    const testSelect = el('select', { 'aria-label': 'Test with which question' });
    const preview = el('div', { class: 'preview-box studio-sandbox' });
    const formStatus = el('div', { class: 'status-line' });

    const starterBtn = button('Insert a starter example', 'btn btn-quiet btn-small', () => {
      if (codeInput.value.trim() && !window.confirm('Replace the code in the box with a starter example?')) return;
      codeInput.value = STARTER_SNIPPET;
      if (!nameInput.value.trim()) nameInput.value = 'Bars for each number';
      onCodeInput(true);
    });
    const runBtn = button('Run again', 'btn btn-quiet btn-small', () => runPreview());
    const saveBtn = button('Save to library', 'btn btn-primary', () => save());
    const cancelBtn = button('Cancel editing', 'btn btn-quiet', () => resetForm());
    cancelBtn.hidden = true;
    const editingBanner = el('div', { class: 'studio-editing', hidden: true });

    const form = el('form', { class: 'form-grid', novalidate: true, onsubmit: event => { event.preventDefault(); save(); } }, [
      editingBanner,
      field('Name', nameInput, { help: 'So you can find it again.' }),
      field('Note (optional)', noteInput),
      field('Code', codeInput, { full: true, help: 'A full HTML page, an HTML fragment, or plain JavaScript. It runs in a locked-down frame with no access to this site. It can read window.QUESTION = { text, topic, numbers, params }.' }),
      el('div', { class: 'full button-row' }, [kindLine]),
      field('Test it with', testSelect, { help: 'Fills window.QUESTION so you can check the picture reacts to real numbers.' }),
      el('div', { class: 'field' }, [el('span', { class: 'help', text: 'The preview reloads a moment after you stop typing.' }), el('div', { class: 'button-row' }, [starterBtn, runBtn])]),
      el('div', { class: 'field full' }, [el('label', { text: 'Live preview' }), preview]),
      el('div', { class: 'full button-row' }, [saveBtn, cancelBtn, formStatus]),
    ]);
    card.appendChild(form);

    const countLine = el('span', { class: 'list-item-meta' });
    const list = el('div', { class: 'list' });
    card.appendChild(el('div', { class: 'studio-list-head' }, [el('h3', { text: 'Your visualiser library' }), countLine]));
    card.appendChild(list);

    function testQuestion() {
      const id = testSelect.value;
      if (id && id !== 'sample') {
        const q = loadQuestions().find(item => item.id === id);
        if (q) return q;
      }
      return sampleQuestion();
    }

    function refreshTestSelect() {
      const current = testSelect.value || 'sample';
      const opts = [{ value: 'sample', label: 'Sample: “' + truncate(sampleQuestion().text, 50) + '”' }]
        .concat(loadQuestions().filter(q => q.text).map(q => ({ value: q.id, label: truncate(q.text, 70) })));
      fillSelect(testSelect, opts, current);
    }

    function showKind() {
      const kind = detectSnippetKind(codeInput.value);
      kindLine.innerHTML = '';
      kindLine.className = 'status-line';
      kindLine.appendChild(el('span', { class: 'key-state ' + (kind === 'empty' ? 'off' : 'on'), text: KIND_LABELS[kind] }));
      kindLine.appendChild(document.createTextNode(' ' + KIND_HELP[kind]));
      return kind;
    }

    function runPreview() {
      const code = codeInput.value;
      if (!code.trim()) {
        preview.innerHTML = '';
        preview.appendChild(el('p', { class: 'list-empty', text: 'Paste some code (or insert the starter example) to see it run here.' }));
        return;
      }
      mountSandbox(preview, code, testQuestion());
    }
    const schedulePreview = debounce(runPreview, SANDBOX_DELAY);

    function onCodeInput(immediate) {
      showKind();
      if (immediate) schedulePreview.flush(); else schedulePreview();
    }
    codeInput.addEventListener('input', () => onCodeInput(false));
    testSelect.addEventListener('change', () => runPreview());
    // Tab inserts two spaces instead of leaving the code box.
    codeInput.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.setRangeText('  ', start, end, 'end');
      onCodeInput(false);
    });

    function resetForm() {
      state.editingId = null;
      state.editingSource = null;
      state.editingCreatedAt = null;
      nameInput.value = '';
      noteInput.value = '';
      codeInput.value = '';
      saveBtn.textContent = 'Save to library';
      cancelBtn.hidden = true;
      editingBanner.hidden = true;
      setStatus(formStatus, '');
      onCodeInput(true);
    }

    function loadIntoForm(vis) {
      state.editingId = vis.id;
      state.editingSource = vis.source || 'paste';
      state.editingCreatedAt = vis.createdAt || null;
      nameInput.value = vis.name || '';
      noteInput.value = vis.note || '';
      codeInput.value = vis.code || '';
      saveBtn.textContent = 'Update visualiser';
      cancelBtn.hidden = false;
      editingBanner.hidden = false;
      editingBanner.textContent = '✏️ Editing “' + (vis.name || 'Untitled') + '”' +
        (usageCount(vis.id) ? ' — used by ' + usageCount(vis.id) + ' question(s), they will all get the change.' : '');
      onCodeInput(true);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function usageCount(id) {
      return loadQuestions().filter(q => q.visualiserId === id).length;
    }

    function save() {
      const name = nameInput.value.trim();
      const code = codeInput.value;
      if (!code.trim()) {
        setStatus(formStatus, 'Paste the visualiser code first.', 'error');
        showToast('Paste the visualiser code first.', 'error');
        return;
      }
      const library = loadLibrary();
      const now = new Date().toISOString();
      const record = {
        id: state.editingId || uid('vis'),
        name: name || 'Visualiser ' + (library.length + 1),
        code,
        source: state.editingSource || 'paste',
        createdAt: state.editingCreatedAt || now,
      };
      const note = noteInput.value.trim();
      if (note) record.note = note;
      if (state.editingId) record.updatedAt = now;
      let next;
      if (state.editingId) {
        next = library.map(v => (v.id === state.editingId ? record : v));
        if (!next.some(v => v.id === record.id)) next.unshift(record);
      } else {
        next = [record].concat(library);
      }
      if (!saveLibrary(next)) {
        setStatus(formStatus, 'Not saved — the browser refused to store it.', 'error');
        return;
      }
      const wasEditing = !!state.editingId;
      bounce(saveBtn);
      showToast(wasEditing ? 'Visualiser updated ✓' : 'Saved to your library ✓', 'ok');
      resetForm();
      setStatus(formStatus, wasEditing ? 'Updated.' : 'Saved — use it for a question below, or in card 1.', 'ok');
      changed();
    }

    function removeVisualiser(vis) {
      const users = loadQuestions().filter(q => q.visualiserId === vis.id);
      const message = users.length
        ? 'Delete “' + vis.name + '”?\n\n' + users.length + ' question(s) use it. They will be kept, but without this picture.'
        : 'Delete “' + vis.name + '” from your library?';
      if (!window.confirm(message)) return;
      if (users.length) {
        const questions = loadQuestions().map(q => {
          if (q.visualiserId !== vis.id) return q;
          const copy = Object.assign({}, q);
          delete copy.visualiserId;
          return copy;
        });
        if (!storeQuestions(questions)) return;
      }
      if (!saveLibrary(loadLibrary().filter(v => v.id !== vis.id))) return;
      if (state.editingId === vis.id) resetForm();
      showToast('Visualiser deleted.', 'ok');
      changed();
    }

    function duplicateVisualiser(vis) {
      const library = loadLibrary();
      const copy = Object.assign(clone(vis), { id: uid('vis'), name: vis.name + ' (copy)', createdAt: new Date().toISOString() });
      delete copy.updatedAt;
      const index = library.findIndex(v => v.id === vis.id);
      library.splice(index >= 0 ? index + 1 : 0, 0, copy);
      if (!saveLibrary(library)) return;
      showToast('Copy made.', 'ok');
      changed();
    }

    function renderList() {
      const library = loadLibrary();
      const questions = loadQuestions();
      countLine.textContent = library.length ? library.length + ' saved' : '';
      list.innerHTML = '';
      if (!library.length) {
        list.appendChild(el('div', { class: 'list-empty', text: 'Your library is empty. Paste a visualiser above, or let the AI make one from a screenshot in card 3.' }));
        return;
      }
      for (const vis of library) {
        const used = questions.filter(q => q.visualiserId === vis.id).length;
        const previewHolder = el('div', { class: 'preview-box studio-item-preview' });
        previewHolder.hidden = true;
        const previewBtn = button('Preview', 'btn btn-quiet btn-small', () => {
          previewHolder.hidden = !previewHolder.hidden;
          previewBtn.textContent = previewHolder.hidden ? 'Preview' : 'Hide preview';
          previewBtn.setAttribute('aria-expanded', String(!previewHolder.hidden));
          if (previewHolder.hidden) { previewHolder.innerHTML = ''; return; }
          const linked = questions.find(q => q.visualiserId === vis.id);
          mountSandbox(previewHolder, vis.code, linked || sampleQuestion());
        }, { 'aria-expanded': 'false' });
        const peek = el('details', { class: 'code-peek' }, [
          el('summary', { text: 'Show code (' + vis.code.length.toLocaleString('en-SG') + ' characters)' }),
          el('pre', { text: vis.code }),
        ]);
        list.appendChild(el('div', { class: 'list-item' + (state.editingId === vis.id ? ' is-editing' : '') }, [
          el('div', { class: 'list-item-main' }, [
            el('div', { class: 'list-item-title' }, [
              vis.name || 'Untitled',
              ' ',
              el('span', { class: 'topic-tag ' + (vis.source === 'ai' ? 'from-ai' : 'from-parent'), text: vis.source === 'ai' ? '✨ AI' : '📋 pasted' }),
            ]),
            el('div', { class: 'list-item-meta', text: [
              KIND_LABELS[detectSnippetKind(vis.code)],
              used ? 'used by ' + used + ' question' + (used === 1 ? '' : 's') : 'not used yet',
              vis.createdAt ? formatDate(vis.createdAt) : null,
              vis.note ? truncate(vis.note, 80) : null,
            ].filter(Boolean).join(' · ') }),
            el('div', { class: 'button-row studio-item-actions' }, [
              previewBtn,
              button('Use for a new question', 'btn btn-primary btn-small', () => questionApi.startWithVisualiser(vis.id)),
              button('Edit', 'btn btn-quiet btn-small', () => loadIntoForm(vis)),
              button('Duplicate', 'btn btn-quiet btn-small', () => duplicateVisualiser(vis)),
              button('Delete', 'btn btn-danger btn-small', () => removeVisualiser(vis)),
            ]),
            peek,
            previewHolder,
          ]),
        ]));
      }
    }

    refreshers.push(() => {
      refreshTestSelect();
      renderList();
    });
    refreshTestSelect();
    resetForm();
    return { loadIntoForm };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Screenshot → visualiser (AI)
  // ═══════════════════════════════════════════════════════════════════════
  function buildAiSection(card) {
    const state = { run: 0, result: null, startedAt: 0, timer: null, sourceImage: null, sourceNote: '' };

    // ── AI settings panel ────────────────────────────────────────────────
    const readyBadge = el('span', { class: 'key-state' });
    const proxyInput = el('input', { type: 'url', placeholder: 'https://…/api/visualise', autocomplete: 'off', spellcheck: 'false' });
    const keyInput = el('input', { type: 'password', placeholder: 'sk-… (optional)', autocomplete: 'off', spellcheck: 'false' });
    const showKeyBtn = button('Show', 'btn btn-quiet btn-small', () => {
      const showing = keyInput.type === 'text';
      keyInput.type = showing ? 'password' : 'text';
      showKeyBtn.textContent = showing ? 'Show' : 'Hide';
      showKeyBtn.setAttribute('aria-pressed', String(!showing));
    }, { 'aria-pressed': 'false' });
    const saveSettingsBtn = button('Save AI settings', 'btn btn-small', () => saveConfig());
    const forgetKeyBtn = button('Forget my key', 'btn btn-danger btn-small', () => {
      if (!window.confirm('Remove your OpenAI key from this browser?')) return;
      keyInput.value = '';
      applyConfig({ apiKey: '' });
      showToast('Key removed from this browser.', 'ok');
    });
    const settingsStatus = el('div', { class: 'status-line' });

    const settingsPanel = el('details', { class: 'studio-ai-settings' }, [
      el('summary', {}, [el('strong', { text: '⚙️ AI settings ' }), readyBadge]),
      el('div', { class: 'form-grid studio-ai-settings-body' }, [
        field('Proxy URL', proxyInput, { help: 'The address of the small server that talks to the AI for you. Leave as set up by whoever built this site.' }),
        field('Personal OpenAI key (optional)', [keyInput, el('div', { class: 'button-row' }, [showKeyBtn])], {
          help: 'Only needed if there is no proxy, or the proxy asks for your own key.',
        }),
        el('p', { class: 'full help studio-key-note' }, [
          el('strong', { text: '🔒 About your key: ' }),
          'it is stored only in this browser (localStorage), never in your exports or backups, and is sent only when you press Generate. ' +
          'Do not save a key on a shared or school computer. You can remove it at any time with “Forget my key”.',
        ]),
        el('p', { class: 'full help', text: 'Model: ' + AI_MODEL_LABEL + '. Screenshots are shrunk before sending; nothing else from this site is sent.' }),
        el('div', { class: 'full button-row' }, [saveSettingsBtn, forgetKeyBtn, settingsStatus]),
      ]),
    ]);

    function readConfig() {
      try { return getAiConfig() || {}; } catch (error) { return {}; }
    }

    function configProxy(cfg) { return cfg.proxyUrl || cfg.proxy || cfg.endpoint || ''; }
    function configKey(cfg) { return cfg.apiKey || cfg.openaiKey || cfg.key || ''; }

    function isReady() {
      try { return !!aiReady(); } catch (error) { return false; }
    }

    function refreshReady() {
      const ready = isReady();
      const cfg = readConfig();
      readyBadge.className = 'key-state ' + (ready ? 'on' : 'off');
      readyBadge.textContent = ready
        ? '● Ready — ' + (cfg.model || AI_MODEL_LABEL) + (configKey(cfg) ? ' (your key)' : ' (via proxy)')
        : '● Not set up';
      generateBtn.disabled = !ready && !state.timer;
      generateBtn.title = ready ? '' : 'Open AI settings and add a proxy URL or key first.';
      if (!ready) settingsPanel.open = true;
      return ready;
    }

    function fillConfigInputs() {
      const cfg = readConfig();
      proxyInput.value = configProxy(cfg);
      keyInput.value = configKey(cfg);
    }

    function applyConfig(patch) {
      try {
        saveAiConfig(patch);
      } catch (error) {
        setStatus(settingsStatus, 'Could not save: ' + (error && error.message || 'unknown error'), 'error');
        return false;
      }
      refreshReady();
      return true;
    }

    function saveConfig() {
      const proxyUrl = proxyInput.value.trim();
      if (proxyUrl && !/^https?:\/\//i.test(proxyUrl)) {
        setStatus(settingsStatus, 'The proxy URL should start with https://', 'error');
        return;
      }
      const apiKey = keyInput.value.trim();
      if (apiKey && !/^sk-/.test(apiKey)) {
        if (!window.confirm('That key does not look like an OpenAI key (they start with “sk-”). Save it anyway?')) return;
      }
      if (applyConfig({ proxyUrl, apiKey })) {
        setStatus(settingsStatus, isReady() ? 'Saved — the AI is ready.' : 'Saved, but the AI still needs a proxy URL or key.', isReady() ? 'ok' : 'error');
        bounce(saveSettingsBtn);
      }
    }

    // ── input: picture + note ────────────────────────────────────────────
    const picker = createImagePicker(pickerRegistry, {
      icon: '📸',
      label: 'Paste, drop or choose a screenshot of the question',
      help: 'Tip: take a screenshot (Win + Shift + S, or ⌘ + Shift + 4), then press Ctrl/⌘ + V anywhere on this card.',
      maxSide: AI_IMAGE_MAX_SIDE,
      onChange: value => {
        generateBtn.classList.toggle('btn-primary', !!value);
      },
    });
    const noteInput = el('textarea', { rows: '2', placeholder: 'Optional: e.g. “Use a bar model”, “Only the second question”, “Answer is in cm”.' });
    const generateBtn = button('✨ Generate visualiser', 'btn', () => generate());
    const cancelRunBtn = button('Cancel', 'btn btn-quiet', () => cancelRun());
    cancelRunBtn.hidden = true;
    const runStatus = el('div', { class: 'status-line', 'aria-live': 'polite' });
    // Inline key box, shown when the AI service is off or the key is missing/wrong.
    const runKeyInput = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-…' });
    const runKeySave = button('Save key and try again', 'btn btn-primary', () => saveRunKeyAndRetry());
    runKeyInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); saveRunKeyAndRetry(); }
    });
    runKeyInput.id = uid('runkey');
    const runKeyBox = el('div', { class: 'field full studio-ai-keybox' }, [
      el('label', { for: runKeyInput.id, text: 'OpenAI key' }),
      el('div', { class: 'button-row' }, [runKeyInput, runKeySave]),
      el('span', { class: 'help', text: 'The key is kept only in this browser.' }),
    ]);
    runKeyBox.hidden = true;

    function saveRunKeyAndRetry() {
      const apiKey = runKeyInput.value.trim();
      if (!apiKey) {
        setStatus(runStatus, 'Paste an OpenAI key first.', 'error');
        runKeyInput.focus();
        return;
      }
      if (!applyConfig({ apiKey })) return;
      runKeyInput.value = '';
      fillConfigInputs();
      runKeyBox.hidden = true;
      generate();
    }

    card.appendChild(settingsPanel);
    card.appendChild(el('div', { class: 'form-grid studio-ai-input' }, [
      el('div', { class: 'field full' }, [el('label', { text: 'Screenshot' }), picker.element]),
      field('Note for the AI (optional)', noteInput, { full: true }),
      el('div', { class: 'full button-row' }, [generateBtn, cancelRunBtn, runStatus]),
      runKeyBox,
    ]));
    // Make the whole card a paste target for the AI picker.
    card.addEventListener('pointerenter', () => { pickerRegistry.active = picker; });
    card.addEventListener('focusin', event => {
      if (!event.target.closest || !event.target.closest('.studio-ai-result')) pickerRegistry.active = picker;
    });

    // ── result ───────────────────────────────────────────────────────────
    const resultName = el('input', { type: 'text', autocomplete: 'off', maxlength: '80' });
    const resultText = el('textarea', { rows: '3' });
    const resultAnswers = el('input', { type: 'text', autocomplete: 'off' });
    const resultUnit = el('input', { type: 'text', autocomplete: 'off', placeholder: 'optional' });
    const resultHint = el('textarea', { rows: '2' });
    const resultTopic = makeSelect(topicOptions(), topicList()[0].id);
    const resultCode = el('textarea', { class: 'code', spellcheck: 'false' });
    const resultKind = el('div', { class: 'status-line' });
    const resultPreview = el('div', { class: 'preview-box studio-sandbox' });
    const keepImage = el('input', { type: 'checkbox', id: uid('keepimg') });
    keepImage.checked = true;
    const resultStatus = el('div', { class: 'status-line' });
    const saveQuestionBtn = button('Save as question', 'btn btn-primary', () => saveAsQuestion());
    const saveVisBtn = button('Save visualiser only', 'btn', () => saveVisualiserOnly());
    const rerunBtn = button('Try again', 'btn btn-quiet', () => generate());
    const discardBtn = button('Discard', 'btn btn-quiet', () => {
      if (!window.confirm('Throw away this result?')) return;
      hideResult();
    });
    const sourceThumb = el('img', { class: 'studio-thumb studio-ai-source', alt: 'The screenshot this came from' });

    const result = el('div', { class: 'studio-ai-result', hidden: true, 'aria-live': 'polite' }, [
      el('h3', { text: '✨ What the AI made' }),
      el('p', { class: 'help', text: 'Check everything — the AI can misread a screenshot. You can change any of it before saving.' }),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'field full studio-ai-question' }, [
          el('label', { for: 'aiResultText', text: 'Transcribed question' }),
          el('div', { class: 'studio-ai-question-row' }, [sourceThumb, Object.assign(resultText, { id: 'aiResultText' })]),
        ]),
        field('Accepted answers', resultAnswers, { help: 'Comma separated.' }),
        field('Unit', resultUnit),
        field('Hint', resultHint, { full: true }),
        field('Topic', resultTopic),
        field('Visualiser name', resultName),
        el('div', { class: 'field full' }, [el('label', { text: 'Live preview' }), resultPreview]),
        el('details', { class: 'full code-peek studio-ai-code' }, [
          el('summary', { text: 'Edit the code' }),
          field('Visualiser code', resultCode, { help: 'Changes re-run the preview after a moment.' }),
          resultKind,
        ]),
        el('label', { class: 'full inline-field', for: keepImage.id }, [keepImage, 'Show the screenshot with the question']),
        el('div', { class: 'full button-row' }, [saveQuestionBtn, saveVisBtn, rerunBtn, discardBtn, resultStatus]),
      ]),
    ]);
    card.appendChild(result);

    function resultQuestionData() {
      return {
        id: 'ai-preview',
        source: 'parent',
        topic: resultTopic.value,
        text: resultText.value.trim(),
        answers: parseAnswers(resultAnswers.value),
        unit: resultUnit.value.trim() || undefined,
        hint: resultHint.value.trim() || undefined,
      };
    }

    function runResultPreview() {
      const code = resultCode.value;
      resultKind.textContent = 'Detected: ' + KIND_LABELS[detectSnippetKind(code)];
      if (!code.trim()) {
        resultPreview.innerHTML = '';
        resultPreview.appendChild(el('p', { class: 'list-empty', text: 'The AI did not return any picture code. You can still save the question.' }));
        return;
      }
      mountSandbox(resultPreview, code, resultQuestionData());
    }
    const scheduleResultPreview = debounce(runResultPreview, SANDBOX_DELAY);
    resultCode.addEventListener('input', () => scheduleResultPreview());
    resultText.addEventListener('input', () => scheduleResultPreview());

    function guessTopic(text) {
      const t = String(text || '').toLowerCase();
      const rules = [
        [/fraction|\d+\s*\/\s*\d+|half|quarter|eighth/, ['fractions', 'fraction']],
        [/clock|a\.m\.|p\.m\.|minutes?|hours?|o'clock|time/, ['time']],
        [/\$|cents?|dollars?|money|cost|price|change/, ['money']],
        [/area|perimeter|square units|cm²|m²/, ['area', 'areaPerimeter', 'area-perimeter', 'geometry']],
        [/\b(ml|litres?|ℓ|kg|grams?|g|cm|metres?|km)\b|mass|volume|length/, ['measurement', 'measure', 'length', 'mass', 'volume']],
        [/times|each|every|groups? of|rows?|share|equally|divide|multiply/, ['multiplication', 'multiplyDivide', 'multiply-divide', 'division', 'times']],
        [/more than|fewer|less than|altogether|total|left|difference/, ['wordProblems', 'word-problems', 'addSubtract', 'add-subtract', 'addition']],
        [/thousands|hundreds|place value|digit/, ['placeValue', 'place-value', 'numbers']],
      ];
      for (const [pattern, ids] of rules) {
        if (!pattern.test(t)) continue;
        const match = topicList().find(topic => ids.some(id => topic.id.toLowerCase() === id.toLowerCase() ||
          topic.name.toLowerCase().includes(id.toLowerCase())));
        if (match) return match.id;
      }
      return resultTopic.value || topicList()[0].id;
    }

    function showResult(data) {
      state.result = data;
      resultName.value = data.name || 'AI visualiser';
      resultText.value = data.questionText || '';
      resultAnswers.value = answersToText(data.answers);
      resultUnit.value = data.unit || '';
      resultHint.value = data.hint || '';
      resultCode.value = data.code || '';
      resultTopic.value = data.topic && topicById(data.topic) ? data.topic : guessTopic(data.questionText);
      if (state.sourceImage) {
        sourceThumb.src = state.sourceImage;
        sourceThumb.hidden = false;
      } else {
        sourceThumb.hidden = true;
      }
      setStatus(resultStatus, '');
      result.hidden = false;
      runResultPreview();
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function hideResult() {
      state.result = null;
      result.hidden = true;
      resultPreview.innerHTML = '';
    }

    function stopTimer() {
      clearInterval(state.timer);
      state.timer = null;
    }

    function cancelRun() {
      state.run += 1; // any late answer is ignored
      stopTimer();
      setLoading(generateBtn, false);
      cancelRunBtn.hidden = true;
      setStatus(runStatus, 'Cancelled.');
      refreshReady();
    }

    async function generate() {
      const image = picker.get();
      if (!image) {
        setStatus(runStatus, 'Add a screenshot first — paste, drop or choose one above.', 'error');
        picker.zone.focus();
        return;
      }
      if (!refreshReady()) {
        setStatus(runStatus, 'Set up the AI first (open “AI settings”).', 'error');
        settingsPanel.open = true;
        proxyInput.focus();
        return;
      }
      if (state.result && !result.hidden && !window.confirm('Replace the current result with a new one?')) return;

      const run = ++state.run;
      runKeyBox.hidden = true;
      state.sourceImage = image;
      state.sourceNote = noteInput.value.trim();
      state.startedAt = Date.now();
      setLoading(generateBtn, true, 'Generating…');
      cancelRunBtn.hidden = false;
      const phases = ['Reading the screenshot', 'Working out the question', 'Drawing a picture for it', 'Checking the picture'];
      const tick = () => {
        const seconds = Math.round((Date.now() - state.startedAt) / 1000);
        const phase = phases[Math.min(phases.length - 1, Math.floor(seconds / 8))];
        setStatus(runStatus, phase + '… ' + seconds + 's (usually under a minute)');
      };
      tick();
      stopTimer();
      state.timer = setInterval(tick, 1000);

      try {
        const data = await generateVisualiser({ imageDataUrl: image, note: state.sourceNote });
        if (run !== state.run) return;
        if (!data || (!data.code && !data.questionText)) throw new Error('The AI sent back an empty answer. Try again, or add a note.');
        const seconds = Math.round((Date.now() - state.startedAt) / 1000);
        setStatus(runStatus, 'Done in ' + seconds + 's. Check the result below.', 'ok');
        showResult(data);
      } catch (error) {
        if (run !== state.run) return;
        const message = error && error.message ? error.message : String(error || 'unknown error');
        setStatus(runStatus, 'The AI could not do it: ' + message, 'error');
        if (error && ['proxy-unreachable', 'no-key', 'bad-key'].includes(error.code)) {
          runKeyBox.hidden = false;
          runKeyInput.focus();
        }
        showToast('AI error: ' + truncate(message, 140), 'error');
      } finally {
        if (run === state.run) {
          stopTimer();
          setLoading(generateBtn, false);
          cancelRunBtn.hidden = true;
          refreshReady();
        }
      }
    }

    function buildVisualiserRecord() {
      const code = resultCode.value;
      if (!code.trim()) return null;
      const record = {
        id: uid('vis'),
        name: resultName.value.trim() || 'AI visualiser',
        code,
        source: 'ai',
        createdAt: new Date().toISOString(),
      };
      const note = [state.sourceNote, truncate(resultText.value, 160)].filter(Boolean).join(' — ');
      if (note) record.note = note;
      return record;
    }

    function saveVisualiserOnly() {
      const record = buildVisualiserRecord();
      if (!record) {
        setStatus(resultStatus, 'There is no code to save.', 'error');
        return;
      }
      if (!saveLibrary([record].concat(loadLibrary()))) {
        setStatus(resultStatus, 'Not saved — the browser refused to store it.', 'error');
        return;
      }
      bounce(saveVisBtn);
      showToast('Visualiser saved to your library ✓', 'ok');
      setStatus(resultStatus, 'Saved to the library (card 2).', 'ok');
      changed();
    }

    function saveAsQuestion() {
      const q = resultQuestionData();
      if (!q.text) {
        setStatus(resultStatus, 'The question text is empty — type it in first.', 'error');
        resultText.focus();
        return;
      }
      if (!q.answers.length) {
        setStatus(resultStatus, 'Add at least one accepted answer.', 'error');
        resultAnswers.focus();
        return;
      }
      const vis = buildVisualiserRecord();
      const library = loadLibrary();
      if (vis && !saveLibrary([vis].concat(library))) {
        setStatus(resultStatus, 'Not saved — the browser refused to store the visualiser.', 'error');
        return;
      }
      const record = {
        id: uid('pq'),
        source: 'parent',
        topic: q.topic,
        text: q.text,
        answers: q.answers,
        createdAt: new Date().toISOString(),
      };
      if (q.unit) record.unit = q.unit;
      if (q.hint) record.hint = q.hint;
      if (vis) record.visualiserId = vis.id;
      if (keepImage.checked && state.sourceImage) record.image = state.sourceImage;
      if (!storeQuestions([record].concat(loadQuestions()))) {
        // Roll back the visualiser so the library does not collect orphans.
        if (vis) saveLibrary(library);
        setStatus(resultStatus, 'Not saved — the browser is out of space. Untick the screenshot and try again.', 'error');
        return;
      }
      bounce(saveQuestionBtn);
      showToast('Question and picture saved — they are in the feed now ✓', 'ok');
      changed();
      hideResult();
      picker.set(null);
      noteInput.value = '';
      setStatus(runStatus, 'Saved. Paste the next screenshot whenever you are ready.', 'ok');
    }

    refreshers.push(() => {
      fillSelect(resultTopic, topicOptions(), resultTopic.value);
      refreshReady();
    });
    fillConfigInputs();
    refreshReady();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Settings & backup
  // ═══════════════════════════════════════════════════════════════════════
  function buildSettingsSection(card) {
    const settings = getSettings();

    const visualFirst = el('input', { type: 'checkbox', id: uid('vf') });
    visualFirst.checked = !!settings.requireVisualFirst;
    const shareInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', id: uid('share') });
    shareInput.value = String(settings.parentShare != null ? settings.parentShare : DEFAULT_SETTINGS.parentShare);
    const shareReadout = el('output', { class: 'studio-readout', for: shareInput.id });
    const difficulty = makeSelect([
      { value: 'warmup', label: '🌱 Warm-up — smaller numbers, one step' },
      { value: 'core', label: '🌿 Core — P3 standard' },
      { value: 'stretch', label: '🌳 Stretch — bigger numbers, two steps' },
    ], settings.difficulty || DEFAULT_SETTINGS.difficulty);
    const topicChips = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Topics in the feed' });
    const settingsStatus = el('div', { class: 'status-line' });

    function describeShare() {
      const value = Number(shareInput.value);
      const pct = Math.round(value * 100);
      shareReadout.textContent = pct + '%';
      const count = loadQuestions().length;
      const sentence = pct === 0
        ? 'Your questions are never shown — the feed only uses generated ones.'
        : pct === 100
          ? 'Every card is one of your questions (when you have some).'
          : 'About ' + Math.max(1, Math.round(value * 10)) + ' in every 10 cards is one of your questions.';
      setStatus(settingsStatus, sentence + (count ? '' : ' (You have none saved yet.)'));
    }

    function persist(patch, message) {
      saveSettings(patch);
      if (message) showToast(message, 'ok');
      notify();
    }

    visualFirst.addEventListener('change', () => persist({ requireVisualFirst: visualFirst.checked },
      visualFirst.checked ? 'Answer box now waits for the picture.' : 'Answer box is open straight away.'));
    shareInput.addEventListener('input', describeShare);
    shareInput.addEventListener('change', () => persist({ parentShare: Number(shareInput.value) }));
    difficulty.addEventListener('change', () => persist({ difficulty: difficulty.value }, 'Difficulty saved.'));

    function renderTopicChips() {
      const current = getSettings().topics;
      const on = Array.isArray(current) ? new Set(current) : null;
      topicChips.innerHTML = '';
      const allChip = button('All topics', 'chip', () => persistTopics(null), { 'aria-pressed': String(!on) });
      topicChips.appendChild(allChip);
      for (const topic of topicList()) {
        const active = !on || on.has(topic.id);
        topicChips.appendChild(button(topicLabel(topic.id), 'chip', () => {
          // From "all", the first tap means "only this one"; after that taps toggle.
          const set = on ? new Set(on) : new Set();
          if (set.has(topic.id)) set.delete(topic.id); else set.add(topic.id);
          if (!set.size) { showToast('Keep at least one topic switched on.', 'error'); return; }
          persistTopics(set.size === topicList().length ? null : Array.from(set));
        }, { 'aria-pressed': String(active && !!on) }));
      }
    }

    function persistTopics(list) {
      persist({ topics: list });
      renderTopicChips();
    }

    card.appendChild(el('div', { class: 'form-grid' }, [
      el('div', { class: 'field full' }, [
        el('label', { class: 'inline-field', for: visualFirst.id }, [visualFirst, 'Picture first: keep the answer box locked until the picture has been opened']),
        el('span', { class: 'help', text: 'Recommended. It builds the habit of drawing a problem before solving it.' }),
      ]),
      el('div', { class: 'field full' }, [
        el('label', { for: shareInput.id }, ['How often your own questions appear: ', shareReadout]),
        shareInput,
        settingsStatus,
      ]),
      field('Difficulty of generated questions', difficulty),
      el('div', { class: 'field' }, [el('span', { class: 'help', text: 'Your own questions are shown exactly as you wrote them, whatever the difficulty.' })]),
      el('div', { class: 'field full' }, [
        el('label', { text: 'Topics for generated questions' }),
        topicChips,
        el('span', { class: 'help', text: 'Tap a topic to show only the ones you pick. “All topics” switches everything back on.' }),
      ]),
    ]));

    // ── backup ───────────────────────────────────────────────────────────
    const usageLine = el('p', { class: 'list-item-meta' });
    const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', tabindex: '-1' });
    const importSettings = el('input', { type: 'checkbox', id: uid('impset') });
    const backupStatus = el('div', { class: 'status-line' });
    const exportBtn = button('⬇️ Export everything', 'btn btn-primary', () => exportAll());
    const importBtn = button('⬆️ Import a backup', 'btn', () => importInput.click());
    const clearBtn = button('🗑 Clear everything', 'btn btn-danger', () => clearAll());

    card.appendChild(el('h3', { text: 'Backup' }));
    card.appendChild(el('p', { class: 'help', text: 'Everything lives in this browser only. Export a file to keep it safe or to move it to another device, then import it there. Imports are merged: items with the same id are updated, new ones are added, nothing is deleted. Your AI key is never exported.' }));
    card.appendChild(usageLine);
    card.appendChild(el('div', { class: 'button-row' }, [exportBtn, importBtn, importInput]));
    card.appendChild(el('label', { class: 'inline-field studio-import-option', for: importSettings.id }, [importSettings, 'Also take the settings from the imported file']));
    card.appendChild(backupStatus);
    card.appendChild(el('h3', { text: 'Start again' }));
    card.appendChild(el('p', { class: 'help', text: 'Deletes all your questions, visualisers and settings from this browser. Export first if you might want them back.' }));
    card.appendChild(el('div', { class: 'button-row' }, [clearBtn]));

    function describeUsage() {
      const questions = loadQuestions();
      const library = loadLibrary();
      const bytes = byteSize(STORE_KEYS.questions) + byteSize(STORE_KEYS.visualisers) + byteSize(STORE_KEYS.settings);
      usageLine.textContent = questions.length + ' question' + (questions.length === 1 ? '' : 's') + ' · ' +
        library.length + ' visualiser' + (library.length === 1 ? '' : 's') + ' · about ' + formatBytes(bytes) +
        ' used (browsers allow roughly 5 MB; screenshots take the most room).';
    }

    function exportAll() {
      const settingsCopy = Object.assign({}, getSettings());
      const data = {
        app: 'p3-visualise',
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        questions: loadQuestions(),
        visualisers: loadLibrary(),
        settings: settingsCopy,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = el('a', { href: url, download: 'p3-maths-backup-' + stamp + '.json' });
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      bounce(exportBtn);
      setStatus(backupStatus, 'Exported ' + data.questions.length + ' questions and ' + data.visualisers.length + ' visualisers.', 'ok');
      showToast('Backup downloaded ✓', 'ok');
    }

    function cleanQuestion(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const text = typeof raw.text === 'string' ? raw.text : '';
      const answers = Array.isArray(raw.answers) ? raw.answers.map(a => String(a).trim()).filter(Boolean)
        : typeof raw.answers === 'string' ? parseAnswers(raw.answers)
          : raw.answer != null ? parseAnswers(String(raw.answer)) : [];
      if (!text && !raw.image) return null;
      if (!answers.length) return null;
      const q = Object.assign({}, raw, {
        id: typeof raw.id === 'string' && raw.id ? raw.id : uid('pq'),
        source: 'parent',
        topic: raw.topic || topicList()[0].id,
        text,
        answers,
      });
      delete q.answer;
      if (q.visual && (typeof q.visual !== 'object' || !q.visual.kind)) delete q.visual;
      if (q.image && !/^data:image\//.test(String(q.image))) delete q.image;
      return q;
    }

    function cleanVisualiser(raw) {
      if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code.trim()) return null;
      return Object.assign({}, raw, {
        id: typeof raw.id === 'string' && raw.id ? raw.id : uid('vis'),
        name: raw.name ? String(raw.name) : 'Imported visualiser',
        source: raw.source === 'ai' ? 'ai' : 'paste',
        createdAt: raw.createdAt || new Date().toISOString(),
      });
    }

    function mergeById(existing, incoming) {
      const map = new Map(existing.map(item => [item.id, item]));
      let added = 0;
      let updated = 0;
      for (const item of incoming) {
        if (map.has(item.id)) updated += 1; else added += 1;
        map.set(item.id, Object.assign({}, map.get(item.id) || {}, item));
      }
      // Keep existing order, new items at the front.
      const existingIds = new Set(existing.map(item => item.id));
      const fresh = incoming.filter(item => !existingIds.has(item.id)).map(item => map.get(item.id));
      const kept = existing.map(item => map.get(item.id));
      const seen = new Set();
      const list = fresh.concat(kept).filter(item => (seen.has(item.id) ? false : seen.add(item.id)));
      return { list, added, updated };
    }

    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (!file) return;
      setLoading(importBtn, true);
      try {
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch (error) { throw new Error('That file is not valid JSON.'); }
        const rawQuestions = Array.isArray(data) ? data : Array.isArray(data && data.questions) ? data.questions : [];
        const rawVisualisers = Array.isArray(data && data.visualisers) ? data.visualisers : [];
        const questions = rawQuestions.map(cleanQuestion).filter(Boolean);
        const visualisers = rawVisualisers.map(cleanVisualiser).filter(Boolean);
        const skipped = (rawQuestions.length - questions.length) + (rawVisualisers.length - visualisers.length);
        if (!questions.length && !visualisers.length && !(importSettings.checked && data && data.settings)) {
          throw new Error('No questions or visualisers found in that file.');
        }
        const message = 'Import ' + questions.length + ' question(s) and ' + visualisers.length + ' visualiser(s)' +
          (importSettings.checked && data && data.settings ? ' and the settings' : '') +
          ' from “' + file.name + '”?' + (skipped ? '\n\n' + skipped + ' item(s) look broken and will be skipped.' : '');
        if (!window.confirm(message)) { setStatus(backupStatus, 'Import cancelled.'); return; }

        const libraryBefore = loadLibrary();
        const visMerge = mergeById(libraryBefore, visualisers);
        if (visualisers.length && !saveLibrary(visMerge.list)) throw new Error('The browser refused to store the visualisers.');
        const qMerge = mergeById(loadQuestions(), questions);
        if (questions.length && !storeQuestions(qMerge.list)) {
          if (visualisers.length) saveLibrary(libraryBefore);
          throw new Error('The browser refused to store the questions (probably out of space).');
        }
        if (importSettings.checked && data && data.settings && typeof data.settings === 'object') {
          const allowed = {};
          for (const key of Object.keys(DEFAULT_SETTINGS)) if (key in data.settings) allowed[key] = data.settings[key];
          saveSettings(allowed);
          syncSettingsInputs();
        }
        const summary = 'Imported: ' + qMerge.added + ' new and ' + qMerge.updated + ' updated question(s), ' +
          visMerge.added + ' new and ' + visMerge.updated + ' updated visualiser(s).' + (skipped ? ' Skipped ' + skipped + '.' : '');
        setStatus(backupStatus, summary, 'ok');
        showToast('Import done ✓', 'ok');
        changed();
      } catch (error) {
        setStatus(backupStatus, 'Import failed: ' + (error && error.message || 'unknown error'), 'error');
        showToast('Import failed.', 'error');
      } finally {
        setLoading(importBtn, false);
      }
    });

    function clearAll() {
      const questions = loadQuestions().length;
      const library = loadLibrary().length;
      if (!window.confirm('Delete ALL ' + questions + ' question(s), ' + library + ' visualiser(s) and your settings from this browser?\n\nThis cannot be undone. (Your AI key is kept.)')) return;
      if (!window.confirm('Really delete everything? Press OK to confirm.')) return;
      storeQuestions([]);
      saveLibrary([]);
      writeStore(STORE_KEYS.settings, Object.assign({}, DEFAULT_SETTINGS));
      syncSettingsInputs();
      setStatus(backupStatus, 'Everything has been cleared.', 'ok');
      showToast('All cleared.', 'ok');
      changed();
    }

    function syncSettingsInputs() {
      const s = getSettings();
      visualFirst.checked = !!s.requireVisualFirst;
      shareInput.value = String(s.parentShare != null ? s.parentShare : DEFAULT_SETTINGS.parentShare);
      difficulty.value = s.difficulty || DEFAULT_SETTINGS.difficulty;
      describeShare();
      renderTopicChips();
    }

    refreshers.push(() => {
      describeUsage();
      describeShare();
    });
    syncSettingsInputs();
    describeUsage();
  }

  return {
    refresh: refreshAll,
    destroy() {
      document.removeEventListener('paste', onPaste);
      rootEl.innerHTML = '';
    },
    editVisualiser: id => {
      const vis = findVisualiser(id);
      if (vis) libraryApi.loadIntoForm(vis);
    },
  };
}
