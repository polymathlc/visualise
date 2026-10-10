// feed.js — the endless "Picture it first" question feed.
//
// The feed is a column of question cards that never runs out. A sentinel
// below the last card is watched by an IntersectionObserver; whenever it
// comes near the viewport another batch of cards is appended. To keep a
// long session light, cards far above the viewport are removed again and
// replaced by a single "tidied away" note, with the scroll position held
// steady so nothing jumps under the child's finger.
//
// The child this was built for likes to answer "blindly" — typing a number
// before thinking about what the question means. So, when
// settings.requireVisualFirst is on, each card's answer box stays locked
// until the child has:
//   1. opened the card's picture ("Picture it"), AND
//   2. interacted with it:
//        - a built-in visualiser (q.visual) reports its first touch through
//          renderVisual's onInteract callback;
//        - a sandboxed snippet (q.code, or q.visualiserId looked up in the
//          visualiser library) cannot report touches across the sandbox,
//          so it unlocks after a short look (or as soon as the child clicks
//          into the frame, which we can see as the frame taking focus);
//        - a question with no picture at all gets a little scratch pad:
//          drawing on it counts as interacting.
//
// Wrong answers get a gentle "draw it first" nudge; after two tries the
// child may reveal the answer. Answered / correct / streak are kept in
// STORE_KEYS.progress.
//
// Public API (see CONTRACT): initFeed({feedEl, sentinelEl, chipsEl, statsEl})
// and refreshFeed().

import {
  STORE_KEYS,
  readStore,
  writeStore,
  getSettings,
  saveSettings,
  uid,
  pick,
  el,
  answerMatches,
  showToast,
  feedbackMarkSvg,
  burstConfetti,
  extractNumbers,
  mountSandbox,
} from './core.js?v=1.1.0';
import { renderVisual } from './visualisers.js?v=1.1.0';
import { TOPICS, nextQuestion, generateQuestion } from './questions.js?v=1.1.0';

// ─────────────────────────────────────────────────────────────────────────
// Tunables.
// ─────────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 5;            // cards appended per sentinel hit
const MAX_CARDS = 60;            // cards kept in the DOM at once
const INITIAL_BATCHES = 2;       // first paint: 10 cards
const SENTINEL_MARGIN = '800px'; // start loading well before the end
const SANDBOX_LOOK_MS = 4000;    // how long a snippet must be looked at
const TRIES_BEFORE_REVEAL = 2;   // wrong tries before "Show me the answer"
const MAX_AUTO_FILLS = 6;        // guard against runaway fill loops
const STREAK_MILESTONES = [3, 5, 10, 15, 20, 30, 50, 75, 100];

const PRAISE = [
  'Yes! Spot on.',
  'Correct — great picturing!',
  'You got it!',
  'Brilliant. The picture paid off.',
  'Exactly right!',
  'Nailed it.',
];

const RETRY_PRAISE = [
  'Got it on the second look — that is how mathematicians work!',
  'Yes! Looking again was the right move.',
  'Correct! The picture helped, didn’t it?',
];

const WRONG_FIRST = [
  'Not quite. Try drawing it first — what is the whole, and what are the parts?',
  'Hmm, not yet. Picture it: draw the bars or dots, then count again.',
  'Close your eyes and picture it — or better, draw it! Then try once more.',
];

const WRONG_AGAIN = [
  'Still not it — that’s okay. Look carefully at your picture: which part is the question asking for?',
  'Not yet. Point at each part of your drawing and say what it stands for.',
];

const GENERIC_HINTS = [
  'Draw it! Use bars for amounts, a number line for jumps, or dots for groups.',
  'What do you know? What are you looking for? Find both in your picture.',
  'Is the question joining things, taking away, making equal groups, or sharing?',
  'Underline the numbers in the question, then put each one in your picture.',
];

// ─────────────────────────────────────────────────────────────────────────
// Module state.
// ─────────────────────────────────────────────────────────────────────────
const state = {
  feedEl: null,
  sentinelEl: null,
  chipsEl: null,
  statsEl: null,
  observer: null,
  scrollFallback: null,
  cardCount: 0,       // running number shown on each card ("#12")
  trimmedCount: 0,    // cards removed from the top so far
  lastQuestionText: '',
  recentTexts: [],    // short memory to avoid near-repeats in one session
  filling: false,
  autoFills: 0,
  failures: 0,
  initialised: false,
};

// ─────────────────────────────────────────────────────────────────────────
// Progress (answered / correct / streak).
// ─────────────────────────────────────────────────────────────────────────
const EMPTY_PROGRESS = {
  answered: 0,
  correct: 0,
  firstTry: 0,
  revealed: 0,
  streak: 0,
  bestStreak: 0,
  byTopic: {},
  lastAt: null,
};

function loadProgress() {
  const stored = readStore(STORE_KEYS.progress, {});
  const progress = Object.assign({}, EMPTY_PROGRESS, stored && typeof stored === 'object' ? stored : {});
  if (!progress.byTopic || typeof progress.byTopic !== 'object') progress.byTopic = {};
  for (const key of ['answered', 'correct', 'firstTry', 'revealed', 'streak', 'bestStreak']) {
    progress[key] = Math.max(0, Math.floor(Number(progress[key]) || 0));
  }
  return progress;
}

function saveProgress(progress) {
  progress.lastAt = new Date().toISOString();
  writeStore(STORE_KEYS.progress, progress);
}

// outcome: 'correct' | 'revealed'; tries: wrong tries before the outcome
function recordOutcome(question, outcome, tries) {
  const progress = loadProgress();
  progress.answered += 1;
  const topicKey = question.topic || 'other';
  const topic = progress.byTopic[topicKey] || { answered: 0, correct: 0 };
  topic.answered += 1;
  if (outcome === 'correct') {
    progress.correct += 1;
    topic.correct += 1;
    if (tries === 0) progress.firstTry += 1;
    progress.streak += 1;
    progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
  } else {
    progress.revealed += 1;
    progress.streak = 0;
  }
  progress.byTopic[topicKey] = topic;
  saveProgress(progress);
  renderStats();
  return progress;
}

function renderStats() {
  const statsEl = state.statsEl;
  if (!statsEl) return;
  const p = loadProgress();
  statsEl.innerHTML = '';
  const stat = (label, value, title) => el('span', { class: 'feed-stat', title }, [
    el('b', { text: String(value) }), ' ' + label,
  ]);
  statsEl.appendChild(stat('answered', p.answered, 'Questions finished'));
  statsEl.appendChild(stat('correct', p.correct, p.firstTry + ' right on the first try'));
  const streak = stat('streak', p.streak, 'Best streak: ' + p.bestStreak);
  if (p.streak >= 3) streak.classList.add('is-hot');
  streak.insertBefore(document.createTextNode(p.streak >= 3 ? '🔥 ' : ''), streak.firstChild);
  statsEl.appendChild(streak);
  if (p.answered > 0) {
    statsEl.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-quiet btn-small feed-stats-reset',
      text: 'Reset',
      'aria-label': 'Reset answered, correct and streak counts',
      onclick: () => {
        if (!window.confirm('Reset the answered, correct and streak counts to zero?')) return;
        writeStore(STORE_KEYS.progress, Object.assign({}, EMPTY_PROGRESS, { byTopic: {} }));
        renderStats();
        showToast('Counts reset. Fresh start!', 'ok');
      },
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Topics and chips.
// ─────────────────────────────────────────────────────────────────────────
function topicList() {
  return Array.isArray(TOPICS) ? TOPICS : [];
}

function topicInfo(topicId) {
  const found = topicList().find(t => t.id === topicId);
  if (found) return found;
  return { id: topicId || 'other', name: topicId ? String(topicId) : 'Mixed', emoji: '🧩' };
}

function activeTopics() {
  const settings = getSettings();
  const ids = topicList().map(t => t.id);
  if (!Array.isArray(settings.topics) || !settings.topics.length) return null;
  const valid = settings.topics.filter(id => ids.includes(id));
  return valid.length && valid.length < ids.length ? valid : null;
}

function renderChips() {
  const chipsEl = state.chipsEl;
  if (!chipsEl) return;
  chipsEl.innerHTML = '';
  const active = activeTopics();
  chipsEl.appendChild(el('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': active ? 'false' : 'true',
    text: '✨ All topics',
    onclick: () => setTopics(null, null),
  }));
  for (const topic of topicList()) {
    const on = !!active && active.includes(topic.id);
    chipsEl.appendChild(el('button', {
      type: 'button',
      class: 'chip',
      'data-topic': topic.id,
      'aria-pressed': on ? 'true' : 'false',
      title: on ? 'Tap to turn ' + topic.name + ' off' : 'Tap to practise ' + topic.name,
      text: (topic.emoji ? topic.emoji + ' ' : '') + topic.name,
      onclick: () => toggleTopic(topic.id),
    }));
  }
}

function toggleTopic(topicId) {
  const active = activeTopics();
  let next;
  if (!active) {
    // From "everything", tapping one chip means "just this one".
    next = [topicId];
  } else if (active.includes(topicId)) {
    next = active.filter(id => id !== topicId);
  } else {
    next = active.concat(topicId);
  }
  const all = topicList().map(t => t.id);
  if (!next.length || next.length >= all.length) next = null;
  setTopics(next, topicId);
}

function setTopics(topics, focusId) {
  saveSettings({ topics });
  refreshFeed(); // also re-renders the chips
  // Re-rendering replaced the buttons; put focus back on the one tapped.
  if (!state.chipsEl) return;
  const selector = focusId ? '[data-topic="' + cssEscape(focusId) + '"]' : '.chip:not([data-topic])';
  const target = state.chipsEl.querySelector(selector);
  if (target) target.focus({ preventScroll: true });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────
// Getting questions.
// ─────────────────────────────────────────────────────────────────────────
function isUsable(q) {
  return q && typeof q === 'object' && typeof q.text === 'string' && q.text.trim() &&
    (Array.isArray(q.answers) ? q.answers.length > 0 : q.answers != null);
}

function fetchQuestion() {
  const settings = getSettings();
  const topics = activeTopics();
  const effective = Object.assign({}, settings, { topics });
  for (let attempt = 0; attempt < 4; attempt++) {
    let q = null;
    try {
      q = nextQuestion(effective);
    } catch (error) {
      console.error('nextQuestion failed', error);
    }
    if (!isUsable(q)) {
      try {
        const topicId = topics ? pick(topics) : undefined;
        q = generateQuestion(topicId, settings.difficulty);
      } catch (error) {
        console.error('generateQuestion failed', error);
        q = null;
      }
    }
    if (!isUsable(q)) continue;
    // Avoid showing the very same wording twice in a short span (the
    // generator already avoids immediate repeats; this is belt and braces).
    if (attempt < 3 && state.recentTexts.includes(q.text)) continue;
    state.recentTexts.push(q.text);
    if (state.recentTexts.length > 12) state.recentTexts.shift();
    state.lastQuestionText = q.text;
    return normaliseQuestion(q);
  }
  return null;
}

function normaliseQuestion(q) {
  const copy = Object.assign({}, q);
  copy.id = copy.id || uid('q');
  copy.answers = Array.isArray(copy.answers) ? copy.answers.map(String) : String(copy.answers).split('|');
  copy.text = String(copy.text).trim();
  return copy;
}

function lookupVisualiserCode(q) {
  if (q.code && String(q.code).trim()) return { code: String(q.code), name: 'Picture' };
  if (q.visualiserId) {
    const library = readStore(STORE_KEYS.visualisers, []);
    const entry = Array.isArray(library) ? library.find(v => v && v.id === q.visualiserId) : null;
    if (entry && entry.code) return { code: String(entry.code), name: entry.name || 'Picture', source: entry.source };
    return { missing: true };
  }
  return null;
}

// What a sandboxed snippet sees as window.QUESTION. Deliberately no answers:
// the picture is for thinking, not for reading off the result.
function sandboxData(q) {
  return {
    id: q.id,
    topic: q.topic || null,
    text: q.text,
    unit: q.unit || null,
    numbers: extractNumbers(q.text),
    params: q.visual && q.visual.params ? q.visual.params : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// One card.
// ─────────────────────────────────────────────────────────────────────────
function buildCard(q) {
  state.cardCount += 1;
  const number = state.cardCount;
  const settings = getSettings();
  const gated = settings.requireVisualFirst !== false;
  const cardId = uid('card');
  const topic = topicInfo(q.topic);
  const snippet = lookupVisualiserCode(q);

  const card = {
    q,
    number,
    gated,
    opened: false,
    interacted: false,
    unlocked: !gated,
    rendered: false,
    tries: 0,
    done: false,
    lookTimer: null,
    countdownTimer: null,
  };

  const root = el('article', {
    class: 'card question-card',
    id: cardId,
    'data-qid': q.id,
    'aria-labelledby': cardId + '-text',
  });
  root._feedCard = card;
  card.root = root;

  // Head: number + topic tag (+ "from parent" tag).
  const head = el('div', { class: 'card-head' }, [
    el('span', { class: 'card-number', text: '#' + number }),
    el('span', { class: 'topic-tag', text: (topic.emoji ? topic.emoji + ' ' : '') + topic.name }),
  ]);
  if (q.source === 'parent') {
    head.appendChild(el('span', { class: 'topic-tag from-parent', text: '⭐ From your parent' }));
  }
  if (snippet && snippet.source === 'ai') {
    head.appendChild(el('span', { class: 'topic-tag from-ai', text: 'AI picture' }));
  }
  root.appendChild(head);

  // Question text and optional screenshot.
  root.appendChild(el('p', { class: 'question-text', id: cardId + '-text', text: q.text }));
  if (q.image) {
    root.appendChild(el('img', {
      class: 'question-image',
      src: q.image,
      alt: 'Picture of the original question',
      loading: 'lazy',
      decoding: 'async',
    }));
  }

  // The "Picture it" gate + panel.
  const panelId = cardId + '-picture';
  const toggle = el('button', {
    type: 'button',
    class: 'btn btn-primary feed-picture-toggle',
    'aria-expanded': 'false',
    'aria-controls': panelId,
    text: '🎨 Picture it',
  });
  const gateText = el('p', {
    text: gated
      ? 'Before you answer, picture it! Open the picture and play with it — then the answer box unlocks.'
      : 'Want to see it? Open the picture and build it.',
  });
  const gate = el('div', { class: 'visual-gate' }, [gateText, toggle]);
  const stage = el('div', { class: 'visual-stage' });
  const panelStatus = el('p', { class: 'vis-caption feed-picture-status', 'aria-live': 'polite' });
  const hideButton = el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-small',
    'aria-controls': panelId,
    text: 'Hide picture',
  });
  const panel = el('div', { class: 'visual-panel', id: panelId, hidden: true, role: 'region', 'aria-label': 'Picture for question ' + number }, [
    el('div', { class: 'visual-panel-head' }, [
      el('span', { class: 'visual-panel-title', text: '🎨 Picture it' }),
      hideButton,
    ]),
    stage,
    panelStatus,
  ]);
  root.appendChild(gate);
  root.appendChild(panel);
  Object.assign(card, { toggle, gate, gateText, panel, stage, panelStatus, hideButton, snippet });

  toggle.addEventListener('click', () => (card.opened && !panel.hidden ? closePicture(card) : openPicture(card)));
  hideButton.addEventListener('click', () => closePicture(card));

  // Answer form.
  const inputId = cardId + '-answer';
  const input = el('input', {
    class: 'answer-input',
    id: inputId,
    type: 'text',
    inputmode: guessInputMode(q),
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    placeholder: gated ? 'Picture it first…' : 'Your answer',
    'aria-describedby': cardId + '-lock ' + cardId + '-feedback',
  });
  const checkButton = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Check' });
  const answerRow = el('div', { class: 'answer-row' }, [
    el('label', { class: 'visually-hidden', for: inputId, text: 'Your answer to question ' + number }),
    input,
    q.unit ? el('span', { class: 'answer-unit', text: q.unit }) : null,
    checkButton,
  ]);
  const lockNote = el('p', { class: 'locked-note', id: cardId + '-lock', 'aria-live': 'polite' });
  const form = el('form', { class: 'feed-answer-form', novalidate: true, autocomplete: 'off' }, [answerRow, lockNote]);
  form.addEventListener('submit', event => {
    event.preventDefault();
    checkAnswer(card);
  });
  root.appendChild(form);

  const feedback = el('div', { class: 'feedback', id: cardId + '-feedback', 'aria-live': 'polite' });
  root.appendChild(feedback);
  const extras = el('div', { class: 'feed-card-extras' });
  root.appendChild(extras);

  // Foot: hint, reveal, next.
  const hintButton = el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-small',
    'aria-expanded': 'false',
    text: '💡 Hint',
  });
  const revealButton = el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-small',
    hidden: true,
    text: '👀 Show me the answer',
  });
  const nextButton = el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-small',
    hidden: true,
    text: 'Next question ↓',
  });
  const foot = el('div', { class: 'card-foot' }, [hintButton, revealButton, nextButton]);
  root.appendChild(foot);

  hintButton.addEventListener('click', () => toggleHint(card));
  revealButton.addEventListener('click', () => revealAnswer(card));
  nextButton.addEventListener('click', () => goToNext(card));

  Object.assign(card, { input, checkButton, lockNote, form, feedback, extras, hintButton, revealButton, nextButton });
  applyLock(card);
  return root;
}

function guessInputMode(q) {
  // Plain whole-number answers get the number pad on phones; anything with
  // a fraction, time, money or words keeps the full keyboard.
  const all = q.answers.every(a => /^-?\d+(\.\d+)?$/.test(String(a).trim()));
  if (all) return q.answers.some(a => String(a).includes('.')) ? 'decimal' : 'numeric';
  return 'text';
}

// ─────────────────────────────────────────────────────────────────────────
// Locking.
// ─────────────────────────────────────────────────────────────────────────
function applyLock(card) {
  const locked = !card.unlocked && !card.done;
  card.input.disabled = locked || card.done;
  card.checkButton.disabled = locked || card.done;
  card.root.classList.toggle('is-locked', locked);
  if (card.done) {
    card.lockNote.textContent = '';
    card.lockNote.hidden = true;
    return;
  }
  card.lockNote.hidden = false;
  if (!locked) {
    card.lockNote.textContent = card.gated ? '🔓 Unlocked — type your answer and press Enter.' : '';
    card.lockNote.hidden = !card.gated;
    card.input.placeholder = 'Your answer';
    return;
  }
  card.input.placeholder = 'Picture it first…';
  if (!card.opened) {
    card.lockNote.textContent = '🔒 Open the picture first. The answer box unlocks once you have played with it.';
  } else if (card.pictureKind === 'sandbox') {
    card.lockNote.textContent = '🔒 Have a good look at the picture… (or tap inside it)';
  } else if (card.pictureKind === 'scratch') {
    card.lockNote.textContent = '🔒 Draw the question on the scratch pad to unlock.';
  } else {
    card.lockNote.textContent = '🔒 Now touch the picture — drag, tap or slide something.';
  }
}

function unlock(card, reason) {
  if (card.unlocked) return;
  card.unlocked = true;
  card.interacted = true;
  clearTimeout(card.lookTimer);
  clearInterval(card.countdownTimer);
  card.root.classList.add('is-unlocked');
  applyLock(card);
  if (card.panelStatus) {
    card.panelStatus.textContent = reason === 'look'
      ? 'Great looking! The answer box is open.'
      : 'Nice — you built it. The answer box is open.';
  }
  // Focus the input only if the child is not mid-drag on a phone; a short
  // delay lets the visualiser finish handling its own pointer event.
  setTimeout(() => {
    if (!card.root.isConnected || card.done) return;
    const active = document.activeElement;
    const insidePicture = active && card.panel.contains(active) && active.tagName !== 'BUTTON';
    if (!insidePicture && !isCoarsePointer()) card.input.focus({ preventScroll: true });
  }, 350);
}

function isCoarsePointer() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// ─────────────────────────────────────────────────────────────────────────
// The picture.
// ─────────────────────────────────────────────────────────────────────────
function openPicture(card) {
  card.opened = true;
  card.panel.hidden = false;
  card.toggle.setAttribute('aria-expanded', 'true');
  card.toggle.textContent = '🙈 Hide picture';
  card.gate.classList.add('is-open');
  card.gateText.textContent = card.unlocked
    ? 'Here is your picture. Use it to check your thinking.'
    : 'Play with the picture below until the question makes sense.';
  if (!card.rendered) {
    card.rendered = true;
    renderPicture(card);
  } else if (card.pictureKind === 'sandbox' && !card.unlocked) {
    startLookTimer(card);
  }
  applyLock(card);
}

function closePicture(card) {
  card.panel.hidden = true;
  card.toggle.setAttribute('aria-expanded', 'false');
  card.toggle.textContent = '🎨 Picture it';
  card.gate.classList.remove('is-open');
  card.gateText.textContent = card.unlocked
    ? 'Need to see it again? Open the picture.'
    : 'Open the picture and play with it — then the answer box unlocks.';
  // A sandbox look only counts while the picture is actually showing.
  if (!card.unlocked) {
    clearTimeout(card.lookTimer);
    clearInterval(card.countdownTimer);
  }
  card.toggle.focus({ preventScroll: true });
}

function renderPicture(card) {
  const { q, stage } = card;
  stage.innerHTML = '';

  // 1. Built-in visualiser.
  if (q.visual && q.visual.kind) {
    card.pictureKind = 'builtin';
    const ok = renderVisual(q.visual.kind, q.visual.params, stage, {
      onInteract: () => {
        if (!card.root.isConnected) return;
        unlock(card, 'touch');
      },
    });
    if (ok) {
      card.panelStatus.textContent = card.unlocked ? '' : 'Touch the picture to build the question.';
      return;
    }
    // Unknown kind or failure: fall through to snippet / scratch pad.
    stage.innerHTML = '';
  }

  // 2. Sandboxed snippet (inline code, or from the visualiser library).
  const snippet = card.snippet;
  if (snippet && snippet.code) {
    card.pictureKind = 'sandbox';
    try {
      const frame = mountSandbox(stage, snippet.code, sandboxData(q));
      frame.setAttribute('title', 'Picture for question ' + card.number);
      card.frame = frame;
      watchFrameFocus(card, frame);
      startLookTimer(card);
      return;
    } catch (error) {
      console.error('Sandbox failed', error);
      stage.innerHTML = '';
    }
  }

  // 3. Nothing to show (or it broke): draw it yourself.
  card.pictureKind = 'scratch';
  if (snippet && snippet.missing) {
    stage.appendChild(el('p', { class: 'vis-caption', text: 'The saved picture for this question is missing, so draw your own!' }));
  }
  stage.appendChild(buildScratchPad(card));
  card.panelStatus.textContent = card.unlocked ? '' : 'Draw bars, dots or a number line — anything that shows the question.';
}

function startLookTimer(card) {
  if (card.unlocked) return;
  clearTimeout(card.lookTimer);
  clearInterval(card.countdownTimer);
  const endAt = Date.now() + SANDBOX_LOOK_MS;
  const tick = () => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    card.panelStatus.textContent = left > 0
      ? 'Look closely at the picture… the answer box opens in ' + left + 's.'
      : '';
  };
  tick();
  card.countdownTimer = setInterval(tick, 500);
  card.lookTimer = setTimeout(() => {
    clearInterval(card.countdownTimer);
    if (card.root.isConnected && !card.panel.hidden) unlock(card, 'look');
  }, SANDBOX_LOOK_MS);
}

// A sandboxed iframe can't tell us about clicks, but when the child clicks
// into it the top window loses focus to the frame — that counts as a touch.
const watchedFrames = new Set();
let frameBlurBound = false;
function watchFrameFocus(card, frame) {
  watchedFrames.add(card);
  if (frameBlurBound) return;
  frameBlurBound = true;
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const active = document.activeElement;
      for (const c of Array.from(watchedFrames)) {
        if (!c.root.isConnected || c.unlocked) { watchedFrames.delete(c); continue; }
        if (active === c.frame && !c.panel.hidden) {
          watchedFrames.delete(c);
          unlock(c, 'touch');
        }
      }
    }, 0);
  });
}

function buildScratchPad(card) {
  const wrap = el('div', { class: 'feed-scratch' });
  const canvas = el('canvas', {
    class: 'feed-scratch-canvas',
    role: 'img',
    'aria-label': 'Scratch pad. Draw the question here with your finger or mouse.',
    tabindex: '0',
  });
  const clear = el('button', { type: 'button', class: 'btn btn-quiet btn-small', text: 'Clear' });
  const done = el('button', {
    type: 'button',
    class: 'btn btn-quiet btn-small',
    text: 'I drew it on paper',
    title: 'Use this if you drew the picture on real paper',
  });
  wrap.appendChild(canvas);
  wrap.appendChild(el('div', { class: 'button-row feed-scratch-tools' }, [clear, done]));

  let ctx = null;
  let drawing = false;
  let strokes = 0;
  let inkLength = 0;
  let last = null;

  const size = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(240, Math.round(rect.width || 480));
    const height = Math.round(Math.min(260, Math.max(180, width * 0.45)));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = height + 'px';
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2E7D32';
  };
  requestAnimationFrame(size);

  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener('pointerdown', event => {
    if (!ctx) size();
    if (!ctx) return;
    drawing = true;
    last = point(event);
    try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* older browsers */ }
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing || !ctx) return;
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inkLength += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
    event.preventDefault();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    strokes += 1;
    // A real drawing, not one accidental tap: a little ink is enough.
    if (inkLength > 60 || strokes >= 3) unlock(card, 'touch');
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
  clear.addEventListener('click', () => {
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  });
  done.addEventListener('click', () => {
    unlock(card, 'touch');
    done.hidden = true;
  });
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────
// Checking, hints and revealing.
// ─────────────────────────────────────────────────────────────────────────
function checkAnswer(card) {
  if (card.done) return;
  if (!card.unlocked) {
    applyLock(card);
    card.toggle.focus();
    showToast('Picture it first — open the picture and play with it.', 'error');
    return;
  }
  const given = card.input.value.trim();
  if (!given) {
    setFeedback(card, false, 'Type your answer first, then press Check.', { noMark: true });
    card.input.focus();
    return;
  }

  if (answerMatches(given, card.q.answers)) {
    card.done = true;
    const tries = card.tries;
    const progress = recordOutcome(card.q, 'correct', tries);
    setFeedback(card, true, tries === 0 ? pick(PRAISE) : pick(RETRY_PRAISE));
    card.root.classList.add('is-solved');
    card.root.classList.remove('is-wrong');
    applyLock(card);
    card.revealButton.hidden = true;
    card.nextButton.hidden = false;
    const mark = card.feedback.querySelector('.mark') || card.checkButton;
    burstConfetti(mark);
    if (STREAK_MILESTONES.includes(progress.streak)) {
      showToast('🔥 ' + progress.streak + ' in a row! Keep picturing!', 'ok');
    } else if (progress.answered > 0 && progress.answered % 25 === 0) {
      showToast('🎉 ' + progress.answered + ' questions finished!', 'ok');
    }
    return;
  }

  card.tries += 1;
  card.root.classList.add('is-wrong');
  shake(card.root);
  const message = card.tries === 1 ? pick(WRONG_FIRST) : pick(WRONG_AGAIN);
  setFeedback(card, false, message);
  showDrawItFirst(card);
  if (card.tries >= TRIES_BEFORE_REVEAL) card.revealButton.hidden = false;
  card.input.select();
}

function setFeedback(card, correct, message, options) {
  const feedback = card.feedback;
  feedback.innerHTML = '';
  if (!(options && options.noMark)) feedback.insertAdjacentHTML('beforeend', feedbackMarkSvg(correct));
  feedback.appendChild(el('span', { class: 'feedback-message ' + (correct ? 'ok' : 'bad'), text: message }));
}

// The gentle nudge: after a wrong answer, steer back to the picture.
function showDrawItFirst(card) {
  let nudge = card.extras.querySelector('.feed-nudge');
  if (!nudge) {
    const openButton = el('button', {
      type: 'button',
      class: 'btn btn-quiet btn-small',
      text: '🎨 Open the picture',
      onclick: () => {
        openPicture(card);
        card.panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      },
    });
    nudge = el('div', { class: 'hint-box feed-nudge', role: 'note' }, [
      el('p', { class: 'feed-nudge-text' }),
      openButton,
    ]);
    card.extras.prepend(nudge);
    card.nudgeOpenButton = openButton;
  }
  const text = nudge.querySelector('.feed-nudge-text');
  if (!card.opened || card.panel.hidden) {
    text.textContent = '✏️ Draw it first! Open the picture, build the question, then try again.';
    card.nudgeOpenButton.hidden = false;
  } else {
    text.textContent = '✏️ Look at your picture again. Point at the part the question asks about — is it a part, or the whole?';
    card.nudgeOpenButton.hidden = true;
  }
}

function toggleHint(card) {
  let box = card.extras.querySelector('.feed-hint');
  if (box) {
    const show = box.hidden;
    box.hidden = !show;
    card.hintButton.setAttribute('aria-expanded', String(show));
    card.hintButton.textContent = show ? '💡 Hide hint' : '💡 Hint';
    return;
  }
  const text = card.q.hint && String(card.q.hint).trim() ? String(card.q.hint) : pick(GENERIC_HINTS);
  box = el('div', { class: 'hint-box feed-hint', id: card.root.id + '-hint', role: 'note' }, [
    el('strong', { text: 'Hint: ' }), text,
  ]);
  card.extras.appendChild(box);
  card.hintButton.setAttribute('aria-expanded', 'true');
  card.hintButton.setAttribute('aria-controls', box.id);
  card.hintButton.textContent = '💡 Hide hint';
}

function revealAnswer(card) {
  if (card.done) return;
  card.done = true;
  recordOutcome(card.q, 'revealed', card.tries);
  const answer = card.q.answers[0] + (card.q.unit ? ' ' + card.q.unit : '');
  card.feedback.innerHTML = '';
  card.feedback.appendChild(el('span', { class: 'feedback-message', text: 'That’s okay — every mathematician gets stuck sometimes.' }));
  card.extras.appendChild(el('div', { class: 'solution-box feed-solution', role: 'note' }, [
    el('strong', { text: 'The answer is ' + answer + '.' }),
    card.q.answers.length > 1 ? el('div', { class: 'feed-also', text: 'Also accepted: ' + card.q.answers.slice(1).join(', ') }) : null,
    el('p', { class: 'feed-solution-tip', text: 'Open the picture and see if you can find ' + answer + ' in it.' }),
  ]));
  card.root.classList.add('is-revealed');
  card.root.classList.remove('is-wrong');
  card.revealButton.hidden = true;
  card.nextButton.hidden = false;
  applyLock(card);
  card.nextButton.focus({ preventScroll: true });
}

function goToNext(card) {
  let next = card.root.nextElementSibling;
  while (next && !next._feedCard) next = next.nextElementSibling;
  if (!next) {
    appendBatch();
    next = card.root.nextElementSibling;
    while (next && !next._feedCard) next = next.nextElementSibling;
  }
  if (!next) return;
  next.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const target = next._feedCard.unlocked ? next._feedCard.input : next._feedCard.toggle;
  setTimeout(() => target.focus({ preventScroll: true }), prefersReducedMotion() ? 0 : 400);
}

function shake(node) {
  node.classList.remove('shake');
  // Force a reflow so the animation can restart.
  void node.offsetWidth;
  node.classList.add('shake');
  setTimeout(() => node.classList.remove('shake'), 500);
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ─────────────────────────────────────────────────────────────────────────
// Batches, the sentinel and keeping the DOM bounded.
// ─────────────────────────────────────────────────────────────────────────
function appendBatch() {
  if (!state.feedEl) return 0;
  const fragment = document.createDocumentFragment();
  let added = 0;
  for (let i = 0; i < BATCH_SIZE; i++) {
    const q = fetchQuestion();
    if (!q) continue;
    try {
      fragment.appendChild(buildCard(q));
      added += 1;
    } catch (error) {
      console.error('Could not build card', error, q);
    }
  }
  if (added) {
    state.feedEl.appendChild(fragment);
    state.failures = 0;
    removeEmptyNote();
  } else {
    state.failures += 1;
    if (state.failures >= 2) showEmptyNote();
  }
  trimTop();
  return added;
}

function cards() {
  return Array.from(state.feedEl.children).filter(node => node._feedCard);
}

function trimTop() {
  const list = cards();
  const excess = list.length - MAX_CARDS;
  if (excess <= 0) return;
  const anchor = list[excess];
  const before = anchor.getBoundingClientRect().top;
  const viewportHeight = window.innerHeight || 800;
  let removed = 0;
  for (let i = 0; i < excess; i++) {
    const node = list[i];
    // Never pull a card out from under the child: only cards that are well
    // above the viewport and hold no focus are tidied away.
    if (node.getBoundingClientRect().bottom > -viewportHeight) break;
    if (node.contains(document.activeElement)) break;
    cleanupCard(node._feedCard);
    node.remove();
    removed += 1;
  }
  if (!removed) return;
  state.trimmedCount += removed;
  updateTrimmedNote();
  // Keep the anchor card exactly where it was on screen. Browsers with
  // scroll anchoring may already have done this; then the delta is 0.
  const after = anchor.getBoundingClientRect().top;
  const delta = after - before;
  if (Math.abs(delta) > 1) window.scrollBy(0, delta);
}

function cleanupCard(card) {
  if (!card) return;
  clearTimeout(card.lookTimer);
  clearInterval(card.countdownTimer);
  watchedFrames.delete(card);
  if (card.frame) {
    try { card.frame.srcdoc = ''; } catch (err) { /* ignore */ }
    card.frame = null;
  }
}

function updateTrimmedNote() {
  let note = state.feedEl.querySelector(':scope > .feed-trimmed');
  if (!state.trimmedCount) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = el('p', { class: 'feed-trimmed', role: 'note' });
    state.feedEl.prepend(note);
  }
  note.textContent = '🧹 ' + state.trimmedCount + ' earlier question' + (state.trimmedCount === 1 ? '' : 's') +
    ' tidied away to keep things quick. Your scores are saved.';
}

function showEmptyNote() {
  if (state.feedEl.querySelector('.feed-empty')) return;
  state.feedEl.appendChild(el('div', { class: 'card feed-empty', role: 'status' }, [
    el('p', { text: 'No questions could be made just now. Try turning on more topics, or ask a parent to add some in Parent Studio.' }),
    el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Try again', onclick: () => refreshFeed() }),
  ]));
}

function removeEmptyNote() {
  const note = state.feedEl.querySelector('.feed-empty');
  if (note) note.remove();
}

function sentinelNearViewport() {
  if (!state.sentinelEl || !state.sentinelEl.isConnected) return false;
  const rect = state.sentinelEl.getBoundingClientRect();
  const margin = parseInt(SENTINEL_MARGIN, 10) || 0;
  const visible = state.sentinelEl.offsetParent !== null || rect.height > 0;
  return visible && rect.top < (window.innerHeight || 800) + margin;
}

// Called whenever the sentinel may be near. Appends a batch, then — because
// an IntersectionObserver only fires on *changes* — checks again on the next
// frame in case the sentinel is still in range (tall screens, fast flings).
function fill() {
  if (state.filling) return;
  state.filling = true;
  try {
    appendBatch();
  } finally {
    state.filling = false;
  }
  requestAnimationFrame(() => {
    if (sentinelNearViewport() && state.autoFills < MAX_AUTO_FILLS && state.failures < 2) {
      state.autoFills += 1;
      fill();
    } else {
      state.autoFills = 0;
    }
  });
}

function watchSentinel() {
  if (state.observer) state.observer.disconnect();
  if (state.scrollFallback) {
    window.removeEventListener('scroll', state.scrollFallback);
    window.removeEventListener('resize', state.scrollFallback);
    state.scrollFallback = null;
  }
  if (!state.sentinelEl) return;
  if ('IntersectionObserver' in window) {
    state.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) fill();
    }, { rootMargin: '0px 0px ' + SENTINEL_MARGIN + ' 0px' });
    state.observer.observe(state.sentinelEl);
  } else {
    let queued = false;
    state.scrollFallback = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (sentinelNearViewport()) fill();
      });
    };
    window.addEventListener('scroll', state.scrollFallback, { passive: true });
    window.addEventListener('resize', state.scrollFallback);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API.
// ─────────────────────────────────────────────────────────────────────────
export function initFeed({ feedEl, sentinelEl, chipsEl, statsEl } = {}) {
  state.feedEl = feedEl || document.getElementById('feed');
  state.sentinelEl = sentinelEl || document.getElementById('feedSentinel');
  state.chipsEl = chipsEl || document.getElementById('topicChips');
  state.statsEl = statsEl || document.getElementById('statsStrip');
  if (!state.feedEl) {
    console.error('initFeed: no feed element');
    return;
  }
  state.feedEl.setAttribute('aria-busy', 'false');
  // The feed itself announcing every new card would be noisy for screen
  // readers; each card's feedback region is live instead.
  state.feedEl.setAttribute('aria-live', 'off');

  renderChips();
  renderStats();

  if (!state.initialised) {
    state.initialised = true;
    // Another tab (or Parent Studio) changed progress or settings.
    window.addEventListener('storage', event => {
      if (event.key === STORE_KEYS.progress) renderStats();
      if (event.key === STORE_KEYS.settings) renderChips();
      if (event.key === STORE_KEYS.questions || event.key === STORE_KEYS.visualisers) refreshFeed();
    });
    // Enter inside the feed but outside a form (e.g. on a focused card) moves
    // nothing; forms already submit on Enter. Escape closes an open picture.
    state.feedEl.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const cardNode = event.target.closest && event.target.closest('.question-card');
      const card = cardNode && cardNode._feedCard;
      if (card && !card.panel.hidden) {
        event.preventDefault();
        closePicture(card);
      }
    });
  }

  refreshFeed();
  watchSentinel();
}

export function refreshFeed() {
  if (!state.feedEl) return;
  state.feedEl.setAttribute('aria-busy', 'true');
  for (const node of cards()) cleanupCard(node._feedCard);
  state.feedEl.innerHTML = '';
  state.cardCount = 0;
  state.trimmedCount = 0;
  state.recentTexts = [];
  state.failures = 0;
  state.autoFills = 0;
  renderChips();
  renderStats();
  for (let i = 0; i < INITIAL_BATCHES; i++) {
    if (!appendBatch()) break;
  }
  state.feedEl.setAttribute('aria-busy', 'false');
  // If the screen is very tall the sentinel may already be in range; the
  // observer would not fire again for an unchanged intersection.
  requestAnimationFrame(() => {
    if (sentinelNearViewport()) fill();
  });
}
