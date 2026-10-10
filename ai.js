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

import { readStore, writeStore, shrinkImageDataUrl } from './core.js';

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

// ─────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────

class AiError extends Error {
  constructor(message, { status = 0, kind = 'error', fallback = false } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.kind = kind;          // 'network' | 'timeout' | 'http' | 'format' | 'input'
    this.fallback = fallback;  // true: worth trying the other route
  }
}

/** fetch with a hard timeout; maps abort/network failures to AiError. */
async function fetchWithTimeout(url, init, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AiError(label + ' took longer than ' + Math.round(timeoutMs / 1000) +
        ' seconds. Try again, or crop the screenshot to just the question.', { kind: 'timeout' });
    }
    // TypeError here covers offline, DNS failure and CORS rejection alike.
    throw new AiError('Could not reach ' + label + ' (offline or blocked).', { kind: 'network', fallback: true });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  try { return { data: JSON.parse(text), text }; } catch (_) { return { data: null, text }; }
}

async function callProxy(proxyUrl, payload) {
  const response = await fetchWithTimeout(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, REQUEST_TIMEOUT_MS, 'The AI server');

  const { data } = await readJson(response);
  if (!response.ok || !data || data.ok === false) {
    const status = response.status;
    const serverMsg = data && typeof data.error === 'string' ? data.error : '';
    if (status === 400 || status === 413) {
      throw new AiError(serverMsg || 'The AI server could not use this screenshot.', { status, kind: 'input' });
    }
    if (status === 429) {
      throw new AiError(serverMsg || 'The AI server is busy (429). Please wait a minute and try again.', { status, kind: 'http', fallback: true });
    }
    if (status === 504) {
      throw new AiError(serverMsg || 'The AI took too long to answer. Please try again.', { status, kind: 'timeout' });
    }
    if (status === 404 || status === 405) {
      throw new AiError('The AI server is not deployed at this address (' + status + ').', { status, kind: 'http', fallback: true });
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
    return cleanVisualiserReply(data.result || data);
  } catch (err) {
    throw new AiError(err.message, { kind: 'format' });
  }
}

async function callOpenAiDirect(apiKey, model, payload) {
  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatBody({ imageDataUrl: payload.imageDataUrl, note: payload.note, model })),
  }, REQUEST_TIMEOUT_MS, 'OpenAI');

  const { data, text } = await readJson(response);
  if (!response.ok) {
    const upstream = (data && data.error && data.error.message) || text.slice(0, 200);
    const status = response.status;
    if (status === 401) {
      throw new AiError('OpenAI rejected the key saved in this browser (401). Check it in AI settings.', { status, kind: 'http' });
    }
    if (status === 429) {
      throw new AiError('OpenAI says too many requests or no credit left (429). Wait a minute, or check billing.', { status, kind: 'http' });
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
    return cleanVisualiserReply(content);
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
  if (typeof imageDataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
    throw new Error('Add a screenshot of the question first.');
  }
  const cfg = getAiConfig();
  if (!cfg.proxyUrl && !cfg.apiKey) {
    throw new Error('AI is not set up. Add the server address or an OpenAI key in AI settings.');
  }

  let image = imageDataUrl;
  try { image = await shrinkImageDataUrl(imageDataUrl, 1600); } catch (_) { /* keep original */ }
  if (image.length > MAX_IMAGE_CHARS) {
    throw new Error('The screenshot is too large. Crop it to just the question and try again.');
  }
  const payload = { imageDataUrl: image, note: String(note || '').slice(0, MAX_NOTE_CHARS) };

  let proxyError = null;
  if (cfg.proxyUrl) {
    try {
      return await callProxy(cfg.proxyUrl, payload);
    } catch (err) {
      proxyError = err;
      const canFallback = cfg.apiKey && err instanceof AiError && err.fallback;
      if (!canFallback) throw toPlainError(err);
      try { console.warn('[ai] proxy failed, using browser key:', err.message); } catch (_) { /* ignore */ }
    }
  }

  try {
    return await callOpenAiDirect(cfg.apiKey, cfg.model, payload);
  } catch (err) {
    if (proxyError) {
      throw toPlainError(new AiError(proxyError.message + ' Backup with this browser\'s key also failed: ' + err.message));
    }
    throw toPlainError(err);
  }
}

function toPlainError(err) {
  if (err instanceof Error) return err;
  return new Error(String(err || 'Something went wrong with the AI.'));
}
