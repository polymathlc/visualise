// Firebase Cloud Function: visualiseAi
//
// POST {imageDataUrl, note, mode?} ->
//   mode 'visualiser' (default): {ok:true, result:{name, questionText, answers, hint, code}}
//   mode 'webapp' (Snap & Play): {ok:true, result:{title, questionText, answers, hint, html}}
// The OpenAI key lives only in the Firebase secret OPENAI_API_KEY
// (firebase functions:secrets:set OPENAI_API_KEY). It is never sent to the browser.

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import {
  DEFAULT_MODEL, buildChatBody, cleanVisualiserReply,
  buildWebappChatBody, cleanWebappReply,
} from './prompt.js';

const openaiKey = defineSecret('OPENAI_API_KEY');
const openaiModel = defineString('VISUALISE_OPENAI_MODEL', { default: DEFAULT_MODEL });

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_TIMEOUT_MS = 100000;
const OPENAI_WEBAPP_TIMEOUT_MS = 170000;   // a whole web app is a much longer reply
const MODES = {
  visualiser: { build: buildChatBody, clean: cleanVisualiserReply, timeoutMs: OPENAI_TIMEOUT_MS },
  webapp: { build: buildWebappChatBody, clean: cleanWebappReply, timeoutMs: OPENAI_WEBAPP_TIMEOUT_MS },
};
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;   // ~5 MB of base64 image data
const MAX_NOTE_CHARS = 2000;
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

const ALLOWED_ORIGINS = [
  'https://polymathlc.github.io',
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

function originAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((o) => (typeof o === 'string' ? o === origin : o.test(origin)));
}

// Small per-instance rate limit: enough to stop an accidental loop, not a
// substitute for App Check. maxInstances caps total spend as well.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  }
  return list.length > RATE_MAX;
}

function fail(res, status, error, extra) {
  res.status(status).json({ ok: false, error, ...(extra || {}) });
}

async function callOpenAI({ imageDataUrl, note, mode }) {
  const spec = MODES[mode] || MODES.visualiser;
  const key = openaiKey.value();
  if (!key) {
    const err = new Error('The server has no OpenAI key configured.');
    err.status = 500;
    throw err;
  }
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(spec.timeoutMs),
      body: JSON.stringify(spec.build({ imageDataUrl, note, model: openaiModel.value() })),
    });
  } catch (cause) {
    const timedOut = cause && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    const err = new Error(timedOut ? 'OpenAI took too long to answer. Please try again.' : 'Could not reach OpenAI.');
    err.status = timedOut ? 504 : 502;
    throw err;
  }

  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* non-JSON error page */ }

  if (!response.ok) {
    const upstream = (data && data.error && data.error.message) || raw.slice(0, 300);
    logger.warn('OpenAI error', { status: response.status, upstream });
    const err = new Error(
      response.status === 401 ? 'The server OpenAI key was rejected (401). Ask the admin to reset the secret.'
        : response.status === 429 ? 'OpenAI is rate limited or out of credit (429). Please wait a minute and try again.'
          : response.status === 400 ? 'OpenAI could not read this request (400): ' + upstream
            : 'OpenAI error ' + response.status + '.'
    );
    err.status = response.status === 429 ? 429 : response.status === 400 ? 400 : 502;
    throw err;
  }

  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) {
    const err = new Error(choice && choice.finish_reason === 'length'
      ? 'The AI ran out of room before finishing. Try a simpler or cropped screenshot.'
      : choice && choice.message && choice.message.refusal ? 'The AI declined: ' + choice.message.refusal
        : 'The AI returned an empty reply.');
    err.status = 502;
    throw err;
  }
  try {
    return spec.clean(content);
  } catch (cause) {
    const err = new Error(cause.message || 'The AI reply could not be used.');
    err.status = 502;
    throw err;
  }
}

export const visualiseAi = onRequest(
  {
    region: 'us-central1',
    secrets: [openaiKey],
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 200,
    memory: '256MiB',
    maxInstances: 3,
    concurrency: 20,
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { fail(res, 405, 'Use POST.'); return; }

    const origin = req.get('origin') || '';
    if (!originAllowed(origin)) { fail(res, 403, 'This origin is not allowed.'); return; }

    const ip = String(req.get('x-forwarded-for') || req.ip || 'unknown').split(',')[0].trim();
    if (rateLimited(ip)) { fail(res, 429, 'Too many requests. Please wait a few minutes.'); return; }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
    if (!body || typeof body !== 'object') { fail(res, 400, 'Send a JSON body {imageDataUrl, note}.'); return; }

    const imageDataUrl = typeof body.imageDataUrl === 'string' ? body.imageDataUrl.trim() : '';
    const note = typeof body.note === 'string' ? body.note.slice(0, MAX_NOTE_CHARS) : '';
    const mode = body.mode == null || body.mode === '' ? 'visualiser' : String(body.mode);
    if (!Object.prototype.hasOwnProperty.call(MODES, mode)) { fail(res, 400, 'Unknown mode "' + mode.slice(0, 20) + '".'); return; }
    if (!imageDataUrl) { fail(res, 400, 'Add a screenshot of the question first.'); return; }
    if (imageDataUrl.length > MAX_IMAGE_CHARS) { fail(res, 413, 'The screenshot is too large. Crop or shrink it and try again.'); return; }
    if (!IMAGE_DATA_URL.test(imageDataUrl.slice(0, 64)) || !/^data:image\/[a-z]+;base64,/.test(imageDataUrl)) {
      fail(res, 400, 'The screenshot must be a PNG, JPEG, WebP or GIF data URL.');
      return;
    }

    const started = Date.now();
    try {
      const result = await callOpenAI({ imageDataUrl, note, mode });
      logger.info('visualiseAi ok', { mode, ms: Date.now() - started, codeChars: (result.code || result.html || '').length });
      res.status(200).json({ ok: true, result });
    } catch (err) {
      logger.error('visualiseAi failed', { mode, ms: Date.now() - started, message: err.message });
      fail(res, err.status || 500, err.message || 'Something went wrong.');
    }
  }
);
