// ai.js — turn a screenshot of a P3 maths question into an interactive visualiser.
//
// Route 1 (default): the Firebase proxy `visualiseAi` in project mathgen--app,
//   which holds the OpenAI key as a server-side secret.
// Route 2 (optional fallback): if the proxy cannot be reached (network, CORS,
//   404 …) and the parent saved their own OpenAI key in THIS browser, call
//   OpenAI chat/completions directly. That key is stored only in localStorage
//   on this device and is never sent anywhere except api.openai.com.
//
// SYSTEM_PROMPT and the reply cleaning below duplicate functions/prompt.js.
// Keep them in step when editing either copy.

import { readStore, writeStore, shrinkImageDataUrl } from './core.js?v=1.4.0';

export const AI_STORE_KEY = 'vis_ai';
export const DEFAULT_PROXY_URL = 'https://us-central1-mathgen--app.cloudfunctions.net/visualiseAi';
export const DEFAULT_MODEL = 'gpt-6-luna';
export const AI_DEFAULTS = Object.freeze({
  proxyUrl: DEFAULT_PROXY_URL,
  apiKey: '',
  model: DEFAULT_MODEL,
});

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 90000;
const WEBAPP_TIMEOUT_MS = 180000;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;
const MAX_NOTE_CHARS = 2000;

// ─────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────

function sanitiseConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = Object.assign({}, AI_DEFAULTS);
  if (typeof src.proxyUrl === 'string') out.proxyUrl = src.proxyUrl.trim();
  if (typeof src.apiKey === 'string') out.apiKey = src.apiKey.trim();
  if (typeof src.model === 'string' && src.model.trim()) out.model = src.model.trim();
  return out;
}

/** Current AI config: {proxyUrl, apiKey, model}. */
export function getAiConfig() {
  return sanitiseConfig(readStore(AI_STORE_KEY, {}));
}

/**
 * Merge a patch into the stored config. Pass proxyUrl: null to restore the
 * default proxy, apiKey: '' to forget the browser key. Returns the new config.
 */
export function saveAiConfig(patch) {
  const current = getAiConfig();
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = Object.assign({}, current);
  if ('proxyUrl' in p) next.proxyUrl = p.proxyUrl == null ? DEFAULT_PROXY_URL : String(p.proxyUrl).trim();
  if ('apiKey' in p) next.apiKey = p.apiKey == null ? '' : String(p.apiKey).trim();
  if ('model' in p) next.model = p.model == null || !String(p.model).trim() ? DEFAULT_MODEL : String(p.model).trim();
  if (next.proxyUrl && !/^https:\/\//i.test(next.proxyUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(next.proxyUrl)) {
    throw new Error('The proxy address must start with https://');
  }
  writeStore(AI_STORE_KEY, next);
  return sanitiseConfig(next);
}

/** True when at least one route (proxy or browser key) is configured. */
export function aiReady() {
  const cfg = getAiConfig();
  return Boolean(cfg.proxyUrl || cfg.apiKey);
}

/** Short human description of which routes are configured. */
export function describeAiRoute() {
  const cfg = getAiConfig();
  if (cfg.proxyUrl && cfg.apiKey) return 'Server proxy, with this browser\'s key as a backup';
  if (cfg.proxyUrl) return 'Server proxy';
  if (cfg.apiKey) return 'This browser\'s OpenAI key';
  return 'Not set up';
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt (duplicate of functions/prompt.js)
// ─────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert Singapore Primary 3 (P3) mathematics teacher and a careful front-end engineer.
You receive a screenshot (or photo) of ONE P3 maths question, plus an optional note from a parent.
Your job is to help an 8-9 year old child SEE the structure of the problem before solving it.

STEP 1 - READ THE IMAGE
- Transcribe the question text exactly as printed (keep numbers, units, names, line breaks as single spaces).
- If the question has several parts, transcribe all parts and treat the LAST unanswered part as the main one.
- If something is unreadable, make the most likely reading and say so briefly in the hint. Never invent extra data.

STEP 2 - SOLVE IT YOURSELF (privately) AND LIST ACCEPTED ANSWERS
- Work the problem carefully, double-check the arithmetic.
- "answers" is an array of strings a child might type that should be marked correct, e.g. ["45", "45 cm", "45cm"].
  Include the bare number, the number with its unit, and common equivalent forms (e.g. "$4.50", "4.50", "4.5";
  "1/2", "0.5" only if P3-appropriate; times like "3:15", "3.15 pm"). Never include wrong answers.

STEP 3 - WRITE A HINT
- One or two short sentences a parent can read aloud, telling the child WHAT TO DRAW (e.g. "Draw one bar for Ali and a
  longer bar for Ben. The extra part is 12."). Do NOT state the final answer.

STEP 4 - WRITE ONE INTERACTIVE VISUALISER ("code")
Write ONE self-contained HTML snippet (a fragment: <style>, markup, and one <script>; no <html>/<head>/<body> needed).
Hard rules:
- NO external network at all: no <script src>, no <link>, no fonts, no images by URL, no fetch/XMLHttpRequest, no import.
  Use inline SVG or <canvas> only. Emoji are allowed.
- It runs in a sandboxed iframe. Do not use localStorage, cookies, alert/prompt/confirm, window.open, or top/parent navigation.
- Read the question data from window.QUESTION if present. It may contain {text, answers, unit, hint, topic}. Fall back to
  the numbers you extracted if it is missing. Never display window.QUESTION.answers.
- Layout must fit any width from 320px to 720px: use width:100%, max-width:720px, box-sizing:border-box, SVG viewBox with
  width="100%", no fixed widths over 320px, no horizontal scrolling. Keep total height under about 520px.
- Child-friendly look: white background, rounded cards (border-radius 14-18px), soft mint accent #A5D6A7, dark text #1f2937,
  system-ui font, large tap targets (min 44px), font-size at least 16px, gentle colours, plenty of spacing.
- MUST be interactive: sliders, + / - buttons, step buttons ("Show next step"), drag handles, or tap-to-reveal. Every control
  must visibly change the drawing. Support both mouse and touch (pointer events).
- Build the model that matches THIS question: a bar model (part-whole or comparison) for word problems, a number line for
  adding/subtracting/counting on, equal groups or arrays for multiplication/division, place-value blocks for numbers,
  fraction bars for fractions, a clock face for time, coins/notes for money, grids for area/perimeter, scales/beakers for
  measurement. Label the bars/parts with the names and numbers from the question.
- DO NOT REVEAL THE FINAL ANSWER. The unknown must be shown as "?" (or an empty box) until the child works it out.
  Do not compute and print the answer anywhere in the visible output, not even after all steps, not in comments
  shown to the user, not in titles. Intermediate given values are fine.
- Wrap all script in an IIFE, use 'use strict', no global leaks except reading window.QUESTION. No console errors.
- Accessible: buttons have text labels, SVG has role="img" and an aria-label, sufficient contrast.
- Keep it robust: guard against missing data, clamp slider ranges, no infinite loops, no timers faster than 30ms.

OUTPUT FORMAT
Reply with ONE JSON object only, no markdown, no code fences, exactly these keys:
{
  "name": "short title for the visualiser, max 60 chars, e.g. 'Ali and Ben - comparison bars'",
  "questionText": "the transcribed question",
  "answers": ["accepted answer strings"],
  "hint": "what to draw, without the answer",
  "code": "the full HTML+JS snippet as one string"
}`;

function buildUserText(note) {
  const clean = String(note || '').trim().slice(0, MAX_NOTE_CHARS);
  return [
    'Here is a screenshot of a P3 maths question. Read it, then follow the steps and return the JSON object.',
    clean ? `Note from the parent (follow it if sensible): ${clean}` : 'There is no parent note.',
  ].join('\n');
}

function buildChatBody({ imageDataUrl, note, model }) {
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserText(note) },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Reply cleaning (duplicate of functions/prompt.js)
// ─────────────────────────────────────────────────────────────────────────

export function stripFences(text) {
  let s = String(text == null ? '' : text).trim();
  const fenced = s.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) s = fenced[1].trim();
  return s;
}

function parseJsonLoose(text) {
  const s = stripFences(text);
  try { return JSON.parse(s); } catch (_) { /* fall through */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { /* fall through */ }
  }
  return null;
}

function cleanString(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Validate and normalise a model or proxy reply. Throws a readable Error. */
export function cleanVisualiserReply(raw) {
  const obj = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('The AI reply was not in the expected format. Please try again.');
  }
  let code = stripFences(obj.code == null ? '' : String(obj.code));
  code = code
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .trim();
  if (!code) throw new Error('The AI did not write any visualiser code. Please try again.');
  if (code.length > 200000) throw new Error('The AI visualiser code was too long to use.');

  let answers = obj.answers;
  if (typeof answers === 'string' || typeof answers === 'number') answers = [answers];
  if (!Array.isArray(answers)) answers = [];
  const seen = new Set();
  answers = answers
    .map((a) => cleanString(a, 80))
    .filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
    .slice(0, 12);

  const questionText = cleanString(obj.questionText || obj.question || obj.text, 4000);
  const name = cleanString(obj.name || obj.title, 60) ||
    (questionText ? questionText.slice(0, 48) + (questionText.length > 48 ? '...' : '') : 'AI visualiser');

  return { name, questionText, answers, hint: cleanString(obj.hint, 600), code };
}

// ═════════════════════════════════════════════════════════════════════════
// Snap & Play: a whole standalone web app built from one screenshot.
// (Duplicate of functions/prompt.js — keep the two copies in step.)
// ═════════════════════════════════════════════════════════════════════════

export const WEBAPP_MAX_HTML_CHARS = 400000;

export const WEBAPP_SYSTEM_PROMPT = `You are an expert Singapore Primary 3 (P3) mathematics teacher AND a senior front-end engineer who builds
Brilliant.org-style interactive explorables for children aged 8-9.
You receive a screenshot (or photo) of ONE P3 maths question, plus an optional note from a parent.
Build ONE complete, self-contained interactive web app that lets the child PLAY with the question until they
understand its structure, then try the answer themselves.

STEP 1 - READ THE IMAGE CAREFULLY
- Transcribe the question exactly (numbers, units, names, all parts). Join lines with single spaces.
- If there are several parts (a), (b) ..., build the app around ALL parts, one step or tab per part.
- If a diagram, table, picture graph, clock, ruler, number line or shape is shown, rebuild it faithfully in SVG.
- Work out the correct answer(s) privately. Double-check the arithmetic twice. P3 scope only: whole numbers
  to 10 000, the four operations, times tables 6-9, simple fractions (equivalent, compare, add/subtract like
  denominators), money, length/mass/volume, time (24h not needed), angles, perpendicular/parallel lines,
  area and perimeter of rectangles and squares in square units, bar graphs. Use the model method (bar models)
  the way Singapore schools teach it.

STEP 2 - DESIGN THE PLAY
Choose the 2-4 most helpful interactions for THIS question. Ideas:
- Bar model the child builds: draggable / resizable bars, units that snap together, a "?" bracket for the unknown,
  labels that appear when tapped. Comparison questions show the difference as a separate highlighted segment.
- Manipulatives: counters, base-ten blocks (thousands, hundreds, tens, ones) that can be regrouped by tapping,
  coins and notes for money, fraction strips/pies that can be split and shaded, a clock with draggable hands,
  a number line with a draggable jump arrow, a grid for area that the child paints square by square.
- Sliders or +/- steppers to change a number and SEE how the model changes ("what if Ali had 10 more?").
  Always allow resetting to the question's own numbers.
- Step-by-step reveal: "Step 1: What do we know?" -> "Step 2: What are we finding?" -> "Step 3: Draw it" ->
  "Step 4: Which operation?" Each step is unlocked by a button; earlier steps stay visible.
- "Check my thinking": small multiple-choice or fill-in prompts about the STRUCTURE (e.g. "Is the total bigger or
  smaller than 345?", "Which bar is longer?", "Should we add or subtract?") with kind, specific feedback.
- A final answer box: the child types an answer and taps "Check". Accept equivalent forms (e.g. "1/2" and "0.5",
  "$4.50" and "4.50", "450 cents" when sensible, with or without units, spaces and commas). Correct -> a cheerful
  animated tick and a short "why it works" explanation. Wrong -> gentle, specific nudge (e.g. "Close! Check the
  tens"), never the answer.
- The answer is NEVER shown automatically. Only after at least one attempt, offer a "Show me the answer" button
  that the child must press (ask "Are you sure? Try once more first?" and require a second tap). Then reveal the
  worked solution step by step, matched to the bar model.
- A "Hint" button that gives up to 3 increasingly specific hints, one per tap, none of which states the answer.

STEP 3 - BUILD IT (technical rules, all mandatory)
- Output ONE complete HTML document: <!doctype html><html lang="en"><head>...</head><body>...</body></html>.
- Include <meta charset="utf-8"> and <meta name="viewport" content="width=device-width,initial-scale=1">.
- ALL CSS in one <style> tag, ALL JavaScript in <script> tags in the same document. No external files at all:
  no CDN, no fonts, no images by URL, no fetch/XMLHttpRequest/WebSocket, no import(). Draw pictures with inline SVG
  or CSS; emoji are fine.
- Do NOT use localStorage, sessionStorage, IndexedDB, cookies, alert(), confirm(), prompt(), window.open() or
  parent/top navigation. The app runs in a sandboxed iframe (allow-scripts only), so these would break. Keep state
  in plain JS variables.
- Vanilla JS only, wrapped in an IIFE with 'use strict'. No console errors. Guard every DOM lookup.
- Pointer Events for every drag (pointerdown/move/up with setPointerCapture), so mouse, pen and touch all work.
  Set touch-action: none on draggable areas only, so the page still scrolls elsewhere. Also support keyboard:
  every draggable or slider-like control must be operable with arrow keys or have +/- buttons.
- Layout must work from 320px wide phones to desktops: fluid widths, SVG with viewBox and width:100%,
  flex-wrap, no horizontal scrolling, no fixed pixel widths above 300px. Text at least 16px, touch targets at
  least 44x44px.
- Accessible: real <button> elements with text, aria-live="polite" region for feedback, SVG role="img" with
  aria-label, visible focus rings, colour is never the only signal, contrast at least 4.5:1 for text.
- Respect prefers-reduced-motion (turn off non-essential animation).

STEP 4 - VISUAL STYLE (Polymath / Brilliant style)
- White background (#FFFFFF), text #1A1A1A, secondary text #4A4A4A, borders #ECECEC.
- Mint accent #A5D6A7 (lighter #C8E6C9, wash #F1F8F1, deep ink #1B5E20 for text on mint).
  Supporting soft colours for different quantities: peach #FFE0B2, sky #BBDEFB, lavender #D1C4E9, rose #FFCDD2.
- font-family: 'Century Gothic', CenturyGothic, AppleGothic, 'Segoe UI', sans-serif.
- Rounded everything (cards 20px, buttons pill-shaped), soft layered shadows, generous whitespace, one idea per card.
- Smooth, springy micro-animations (transform/opacity, 200-400ms). Celebrate success with a small confetti or
  bounce made in CSS/JS (no libraries).
- A clear header: a friendly title, the question text in a calm card, then the play area, then the answer area.
- Speak to the child warmly and simply ("Let's find out!", "Drag the bar to show Ben's stickers"). Short sentences.
  British/Singapore spelling.

STEP 5 - CHECK YOURSELF BEFORE REPLYING
- The numbers in the app match the question exactly. The answer you accept is correct (re-compute it).
- The answer text does not appear anywhere visible before the child asks for it (it may live in a JS variable).
- All brackets/tags are closed; the document would run as-is when saved as an .html file and opened offline.

OUTPUT FORMAT
Reply with ONE JSON object only, no markdown, no code fences, exactly these keys:
{
  "title": "short friendly title for the app, max 60 chars, e.g. 'Ali and Ben's marbles'",
  "questionText": "the transcribed question",
  "answers": ["every accepted final answer string, e.g. '245', '245 marbles'"],
  "hint": "one sentence for a parent: what the model looks like, without the answer",
  "html": "the complete HTML document as one string",
  "diagram": {"box_2d": [ymin, xmin, ymax, xmax]} or null
}
"diagram": if the screenshot contains a figure, diagram, table, graph or picture the child needs to read the
question, give its bounding box as integers 0-1000 (fraction of the screenshot height/width x 1000), covering the
whole figure with its labels but not the question sentences. Use null when there is no figure.`;

/** User-turn text for the web app mode. */
export function buildWebappUserText(note) {
  const clean = String(note || '').trim().slice(0, 2000);
  return [
    'Here is a screenshot of a P3 maths question. Read it, then build the interactive web app and return the JSON object.',
    clean ? `Note from the parent (follow it if sensible): ${clean}` : 'There is no parent note.',
  ].join('\n');
}

/** OpenAI chat/completions body for the web app mode (bigger budget). */
export function buildWebappChatBody({ imageDataUrl, note, model }) {
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 48000,
    messages: [
      { role: 'system', content: WEBAPP_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildWebappUserText(note) },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
        ],
      },
    ],
  };
}

// Models the browser may ask for. Anything else falls back to the default, so
// a caller can never name an expensive model on the centre's bill.
// ---------------------------------------------------------------------------
export const MODEL_ALLOWLIST = ['gpt-6-luna', 'gpt-6.1-sol'];
/** The models a parent can pick per question (the server allows exactly these). */
export const MODEL_CHOICES = Object.freeze([
  Object.freeze({ id: 'gpt-6-luna', label: 'ChatGPT 6 Luna (fast)' }),
  Object.freeze({ id: 'gpt-6.1-sol', label: 'ChatGPT Sol 6.1 (harder questions, slower)' }),
]);

/** The model to use: the caller's pick when it is on the allowlist, else the fallback. */
export function pickModel(requested, fallback) {
  const want = String(requested || '').trim();
  return MODEL_ALLOWLIST.includes(want) ? want : (fallback || DEFAULT_MODEL);
}

// ---------------------------------------------------------------------------
// TWEAK mode: the parent types an instruction and the existing app is rewritten.
// No screenshot is needed: the current app HTML is the whole brief.
// ---------------------------------------------------------------------------
export const TWEAK_MAX_INSTRUCTION_CHARS = 2000;

export const TWEAK_SYSTEM_PROMPT = `You are a senior front-end engineer and an expert Singapore Primary 3 (P3) mathematics teacher.
You are given a complete single-file HTML web app that helps a P3 child understand ONE maths question, plus an
instruction from the child's parent saying how to change it.

Apply the parent's instruction to the app. Rules:
- Change only what the instruction asks for; keep everything else (the question, the maths, the layout, the
  working buttons) exactly as it was unless the instruction says otherwise.
- The maths must stay correct. If the instruction would make the maths wrong, keep the maths right and make the
  closest sensible change instead.
- The result must still be ONE self-contained HTML document: inline <style> and <script> only, no external
  scripts, stylesheets, fonts or network requests, no localStorage, no alert/prompt/confirm.
- Keep it friendly for a 9-year-old: large tap targets, plain words, works on a phone and a laptop.
- Never reveal the final answer before the child has tried, unless the parent explicitly asks for that.

Return ONLY a JSON object with exactly these keys:
{
  "title": "short friendly title for the app, max 60 chars",
  "questionText": "the question, as before (update only if the instruction changes it)",
  "answers": ["every accepted final answer string"],
  "hint": "one sentence for a parent: what the model looks like, without the answer",
  "html": "the complete updated HTML document as one string"
}`;

/** User-turn text for tweak mode. */
export function buildTweakUserText({ html, instruction, questionText, answers }) {
  const clean = String(instruction || '').trim().slice(0, TWEAK_MAX_INSTRUCTION_CHARS);
  const lines = [
    'The parent\'s instruction:',
    clean,
    '',
  ];
  if (questionText) lines.push('The question the app is about: ' + String(questionText).slice(0, 4000), '');
  if (Array.isArray(answers) && answers.length) lines.push('Accepted answers so far: ' + answers.slice(0, 12).map(String).join(', '), '');
  lines.push('The current app HTML:', String(html || ''));
  return lines.join('\n');
}

/** OpenAI chat/completions body for tweak mode. */
export function buildTweakChatBody({ html, instruction, questionText, answers, model }) {
  return {
    model: model || DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 48000,
    messages: [
      { role: 'system', content: TWEAK_SYSTEM_PROMPT },
      { role: 'user', content: buildTweakUserText({ html, instruction, questionText, answers }) },
    ],
  };
}

/** Make sure an HTML string is a full document with charset and viewport. */
export function ensureFullDocument(html, title) {
  let doc = String(html || '').trim();
  const safeTitle = String(title || 'Snap & Play').replace(/[<>&"]/g, '');
  if (!/<html[\s>]/i.test(doc)) {
    let headExtra = '';
    let body = doc;
    // A fragment may still carry its own <head> or <body>; peel them.
    const headMatch = body.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch) { headExtra = headMatch[1]; body = body.replace(headMatch[0], ''); }
    const bodyMatch = body.match(/<body[^>]*>([\s\S]*?)(<\/body>|$)/i);
    if (bodyMatch) body = bodyMatch[1];
    doc = '<!doctype html><html lang="en"><head><title>' + safeTitle + '</title>' + headExtra +
      '</head><body>' + body + '</body></html>';
  }
  if (!/^<!doctype/i.test(doc)) doc = '<!doctype html>\n' + doc;
  if (!/<head[\s>]/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => m + '<head></head>');
  // Viewport first, then charset, so charset ends up as the very first tag.
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(doc)) {
    doc = doc.replace(/<head[^>]*>/i, (m) => m + '<meta name="viewport" content="width=device-width,initial-scale=1">');
  }
  if (!/<meta[^>]+charset/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => m + '<meta charset="utf-8">');
  return doc;
}

/**
 * Validate a web app reply into {title, questionText, answers, hint, html}.
 * Accepts `code` instead of `html` (older proxies answer in visualiser shape).
 */
export function cleanWebappReply(raw) {
  const obj = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('The AI reply was not a JSON object.');
  }
  let html = stripFences(obj.html != null ? String(obj.html) : obj.code != null ? String(obj.code) : '');
  html = html
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*["']?(stylesheet|preload|modulepreload|import)[^>]*>/gi, '')
    .trim();
  if (!html) throw new Error('The AI reply did not include the web app.');
  if (html.length > WEBAPP_MAX_HTML_CHARS) throw new Error('The AI web app was too long to use.');

  let answers = obj.answers;
  if (typeof answers === 'string' || typeof answers === 'number') answers = [answers];
  if (!Array.isArray(answers)) answers = [];
  const seen = new Set();
  answers = answers
    .map((a) => cleanString(a, 80))
    .filter((a) => a && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()))
    .slice(0, 12);

  const questionText = cleanString(obj.questionText || obj.question || obj.text, 4000);
  const title = cleanString(obj.title || obj.name, 60) ||
    (questionText ? questionText.slice(0, 48) + (questionText.length > 48 ? '...' : '') : 'Snap & Play app');

  return {
    title,
    questionText,
    answers,
    hint: cleanString(obj.hint, 600),
    html: ensureFullDocument(html, title),
    diagram: cleanDiagram(obj.diagram),
  };
}

/**
 * Validate the figure box the AI found: {box_2d:[ymin,xmin,ymax,xmax]} on a
 * 0-1000 scale. Values are clamped; max must exceed min; a box under 2% of the
 * screenshot is dropped (it is a speck, not a figure). Returns null otherwise.
 */
export function cleanDiagram(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const box = Array.isArray(raw) ? raw : raw.box_2d;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const n = box.map((v) => Number(v));
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = n.map((v) => Math.max(0, Math.min(1000, Math.round(v))));
  if (ymax <= ymin || xmax <= xmin) return null;
  if ((ymax - ymin) * (xmax - xmin) < 0.02 * 1000 * 1000) return null;
  return { box_2d: [ymin, xmin, ymax, xmax] };
}

// ─────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────

class AiError extends Error {
  constructor(message, { status = 0, kind = 'error', fallback = false, code = '' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    // Machine-readable: 'proxy-unreachable' | 'no-key' | 'bad-key' | 'rate-limited'
    // | 'timeout' | 'network' | 'input' | 'format' | 'http' | 'cancelled'
    this.code = code || kind;
    this.kind = kind;          // 'network' | 'timeout' | 'http' | 'format' | 'input'
    this.fallback = fallback;  // true: worth trying the other route
  }
}

/** fetch with a hard timeout; maps abort/network failures to AiError. */
/** Upper-case the first letter, so a mid-sentence label can also start one. */
function capitalise(text) {
  const t = String(text || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * `label` is written as it reads mid-sentence (e.g. 'the AI server');
 * `unreachableCode` is the error code used when the host cannot be reached.
 */
async function fetchWithTimeout(url, init, timeoutMs, label, outerSignal, unreachableCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let cancelledByCaller = false;
  const onOuterAbort = () => { cancelledByCaller = true; controller.abort(); };
  if (outerSignal) {
    if (outerSignal.aborted) onOuterAbort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } catch (err) {
    if (cancelledByCaller) {
      throw new AiError('Cancelled.', { kind: 'cancelled' });
    }
    if (err && err.name === 'AbortError') {
      throw new AiError(capitalise(label) + ' took longer than ' + Math.round(timeoutMs / 1000) +
        ' seconds. Try again, or crop the screenshot to just the question.', { kind: 'timeout', code: 'timeout' });
    }
    // TypeError here covers offline, DNS failure and CORS rejection alike.
    throw new AiError('Could not reach ' + label + ' (offline or blocked).',
      { kind: 'network', fallback: true, code: unreachableCode || 'network' });
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

async function readJson(response) {
  const text = await response.text();
  try { return { data: JSON.parse(text), text }; } catch (_) { return { data: null, text }; }
}

// A "route spec" says how one kind of request is built and cleaned, so the
// visualiser and the Snap & Play web app share every transport rule.
const VISUALISER_SPEC = Object.freeze({
  buildBody: (args) => buildChatBody(args),
  clean: (raw) => cleanVisualiserReply(raw),
  timeoutMs: REQUEST_TIMEOUT_MS,
  proxyExtra: null,
});

async function callProxy(proxyUrl, payload, spec, signal) {
  const s = spec || VISUALISER_SPEC;
  const body = s.proxyExtra ? Object.assign({}, s.proxyExtra, payload) : payload;
  const response = await fetchWithTimeout(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, s.timeoutMs, 'the AI server', signal, 'proxy-unreachable');

  const { data } = await readJson(response);
  if (!response.ok || !data || data.ok === false) {
    const status = response.status;
    const serverMsg = data && typeof data.error === 'string' ? data.error : '';
    if (status === 400 || status === 413) {
      throw new AiError(serverMsg || 'The AI server could not use this screenshot.', { status, kind: 'input' });
    }
    if (status === 429) {
      throw new AiError(serverMsg || 'The AI server is busy (429). Please wait a minute and try again.', { status, kind: 'http', fallback: true, code: 'rate-limited' });
    }
    if (status === 504) {
      throw new AiError(serverMsg || 'The AI took too long to answer. Please try again.', { status, kind: 'timeout', code: 'timeout' });
    }
    if (status === 404 || status === 405) {
      throw new AiError('The AI server is not deployed at this address (' + status + ').', { status, kind: 'http', fallback: true, code: 'proxy-unreachable' });
    }
    if (status === 403) {
      throw new AiError(serverMsg || 'The AI server does not accept requests from this site (403).', { status, kind: 'http', fallback: true });
    }
    if (response.ok && !data) {
      throw new AiError('The AI server sent an unreadable reply.', { status, kind: 'format', fallback: true });
    }
    throw new AiError(serverMsg || ('The AI server failed (' + status + ').'), { status, kind: 'http', fallback: true });
  }
  try {
    return s.clean(data.result || data);
  } catch (err) {
    throw new AiError(err.message, { kind: 'format' });
  }
}

async function callOpenAiDirect(apiKey, model, payload, spec, signal) {
  const s = spec || VISUALISER_SPEC;
  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(s.buildBody(Object.assign({}, payload, { model }))),
  }, s.timeoutMs, 'OpenAI', signal, 'network');

  const { data, text } = await readJson(response);
  if (!response.ok) {
    const upstream = (data && data.error && data.error.message) || text.slice(0, 200);
    const status = response.status;
    if (status === 401) {
      throw new AiError('OpenAI rejected the key saved in this browser (401). Check it in AI settings.', { status, kind: 'http', code: 'bad-key' });
    }
    if (status === 429) {
      throw new AiError('OpenAI says too many requests or no credit left (429). Wait a minute, or check billing.', { status, kind: 'http', code: 'rate-limited' });
    }
    if (status === 404) {
      throw new AiError('OpenAI does not know the model "' + model + '" for this key (404).', { status, kind: 'http' });
    }
    if (status === 400) {
      throw new AiError('OpenAI could not read this request (400): ' + upstream, { status, kind: 'input' });
    }
    throw new AiError('OpenAI error ' + status + (upstream ? ': ' + upstream : '.'), { status, kind: 'http' });
  }

  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) {
    if (choice && choice.message && choice.message.refusal) {
      throw new AiError('The AI declined: ' + choice.message.refusal, { kind: 'format' });
    }
    if (choice && choice.finish_reason === 'length') {
      throw new AiError('The AI ran out of room before finishing. Try a simpler or cropped screenshot.', { kind: 'format' });
    }
    throw new AiError('OpenAI returned an empty reply. Please try again.', { kind: 'format' });
  }
  try {
    return s.clean(content);
  } catch (err) {
    throw new AiError(err.message, { kind: 'format' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read a screenshot and return {name, code, questionText, answers:[string], hint}.
 * Rejects with an Error whose message is safe to show to a parent.
 */
export async function generateVisualiser({ imageDataUrl, note } = {}) {
  return runWithRoutes({ imageDataUrl, note }, VISUALISER_SPEC);
}

/**
 * Snap & Play: read a screenshot and build a whole standalone web app.
 * Resolves {title, questionText, answers:[string], hint, html} where html is
 * one complete self-contained HTML document. `onStatus(text)` hears progress;
 * `signal` (an AbortSignal) cancels. A cancel rejects with err.cancelled = true.
 */
export async function generateWebapp({ imageDataUrl, note, model, onStatus, signal } = {}) {
  return runWithRoutes({ imageDataUrl, note, model }, WEBAPP_SPEC, { onStatus, signal });
}

/**
 * Tweak an existing app from a typed instruction ("make the bars bigger").
 * Resolves the same shape as generateWebapp. No screenshot is needed.
 */
export async function tweakWebapp({ html, instruction, questionText, answers, model, onStatus, signal } = {}) {
  const ins = String(instruction || '').trim().slice(0, TWEAK_MAX_INSTRUCTION_CHARS);
  if (!ins) throw new Error('Type what you want changed first.');
  if (typeof html !== 'string' || !html.trim()) throw new Error('There is no app to change yet.');
  if (html.length > WEBAPP_MAX_HTML_CHARS) throw new Error('This app is too large to change.');
  return runWithRoutes({
    model, html, instruction: ins,
    questionText: String(questionText || '').slice(0, 4000),
    answers: Array.isArray(answers) ? answers.slice(0, 12).map((a) => String(a).slice(0, 80)) : [],
  }, TWEAK_SPEC, { onStatus, signal, noImage: true });
}

const TWEAK_SPEC = Object.freeze({
  buildBody: (args) => buildTweakChatBody(args),
  clean: (raw) => cleanWebappReply(raw),
  timeoutMs: WEBAPP_TIMEOUT_MS,
  proxyExtra: { mode: 'tweak' },
});

const WEBAPP_SPEC = Object.freeze({
  buildBody: (args) => buildWebappChatBody(args),
  clean: (raw) => cleanWebappReply(raw),
  timeoutMs: WEBAPP_TIMEOUT_MS,
  proxyExtra: { mode: 'webapp' },
});

const SERVICE_OFF_MESSAGE = 'The AI service isn\'t switched on yet. Paste an OpenAI key to use it now, or try again later.';

/** Proxy first, then (when allowed) this browser's own key. */
async function runWithRoutes(input, spec, opts) {
  const { imageDataUrl, note } = input || {};
  const o = opts || {};
  const status = (text) => {
    if (typeof o.onStatus !== 'function') return;
    try { o.onStatus(text); } catch (_) { /* a broken listener must not break the call */ }
  };
  if (!o.noImage && (typeof imageDataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl))) {
    throw new Error('Add a screenshot of the question first.');
  }
  const cfg = getAiConfig();
  if (!cfg.proxyUrl && !cfg.apiKey) {
    throw new AiError(SERVICE_OFF_MESSAGE, { kind: 'input', code: 'no-key' });
  }

  // A chosen model is only ever one the server also allows.
  const model = MODEL_ALLOWLIST.includes(String(input.model || '')) ? String(input.model) : '';
  let payload;
  if (o.noImage) {
    payload = { html: input.html, instruction: input.instruction, questionText: input.questionText, answers: input.answers };
  } else {
    status('Getting the screenshot ready…');
    let image = imageDataUrl;
    try { image = await shrinkImageDataUrl(imageDataUrl, 1600); } catch (_) { /* keep original */ }
    if (image.length > MAX_IMAGE_CHARS) {
      throw new Error('The screenshot is too large. Crop it to just the question and try again.');
    }
    payload = { imageDataUrl: image, note: String(note || '').slice(0, MAX_NOTE_CHARS) };
  }
  if (model) payload.model = model;
  if (o.signal && o.signal.aborted) throw cancelledError();

  let proxyError = null;
  if (cfg.proxyUrl) {
    try {
      status('Sending it to the AI server…');
      return await callProxy(cfg.proxyUrl, payload, spec, o.signal);
    } catch (err) {
      if (err instanceof AiError && err.kind === 'cancelled') throw cancelledError();
      proxyError = err;
      const canFallback = cfg.apiKey && err instanceof AiError && err.fallback;
      if (!canFallback) {
        if (!cfg.apiKey && err instanceof AiError && err.code === 'proxy-unreachable') {
          throw new AiError(SERVICE_OFF_MESSAGE, { status: err.status, kind: err.kind, code: 'proxy-unreachable' });
        }
        throw toPlainError(err);
      }
      try { console.warn('[ai] proxy failed, using browser key:', err.message); } catch (_) { /* ignore */ }
      status('The server did not answer — trying this browser\'s own key…');
    }
  } else {
    status('Sending it to OpenAI with this browser\'s key…');
  }

  try {
    return await callOpenAiDirect(cfg.apiKey, model || cfg.model, payload, spec, o.signal);
  } catch (err) {
    if (err instanceof AiError && err.kind === 'cancelled') throw cancelledError();
    if (proxyError) {
      throw toPlainError(new AiError(proxyError.message + ' Backup with this browser\'s key also failed: ' + err.message,
        { status: err.status || 0, kind: err.kind || 'error', code: err.code || '' }));
    }
    throw toPlainError(err);
  }
}

const ENHANCE_TIMEOUT_MS = 170000;

/**
 * Ask the proxy to redraw a cropped figure as a clean diagram. Resolves the
 * new image as a data URL (data:image/...). Throws on any failure, so the
 * caller can fall back to a local clean-up.
 */
export async function enhanceDiagram({ imageDataUrl, signal } = {}) {
  if (typeof imageDataUrl !== 'string' || !/^data:image\//.test(imageDataUrl)) {
    throw new AiError('There is no picture to clean up.', { kind: 'input' });
  }
  const proxyUrl = getAiConfig().proxyUrl || DEFAULT_PROXY_URL;
  let response;
  try {
    response = await fetchWithTimeout(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'enhance', imageDataUrl }),
    }, ENHANCE_TIMEOUT_MS, 'the AI server', signal, 'proxy-unreachable');
  } catch (err) {
    if (err instanceof AiError && err.kind === 'cancelled') throw cancelledError();
    throw toPlainError(err);
  }
  const { data } = await readJson(response);
  if (!response.ok || !data || data.ok === false) {
    const serverMsg = data && typeof data.error === 'string' ? data.error : '';
    throw new AiError(serverMsg || ('The diagram clean-up failed (' + response.status + ').'),
      { status: response.status, kind: 'http' });
  }
  const result = data.result && typeof data.result === 'object' ? data.result : data;
  const url = result && result.imageDataUrl;
  if (typeof url !== 'string' || !/^data:image\//.test(url)) {
    throw new AiError('The diagram clean-up did not return a picture.', { kind: 'format' });
  }
  return url;
}

function cancelledError() {
  const err = new Error('Cancelled.');
  err.cancelled = true;
  return err;
}

function toPlainError(err) {
  if (err instanceof Error) return err;
  return new Error(String(err || 'Something went wrong with the AI.'));
}
