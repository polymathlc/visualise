// Shared prompt and reply-cleaning logic for the Visualise AI generator.
//
// The browser module (../ai.js) carries a duplicate of SYSTEM_PROMPT and the
// cleaning helpers so the static site can fall back to calling OpenAI
// directly. Keep the two copies in step when editing.

export const DEFAULT_MODEL = 'gpt-6-luna';

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

/** Build the user-turn text from an optional parent note. */
export function buildUserText(note) {
  const clean = String(note || '').trim().slice(0, 2000);
  return [
    'Here is a screenshot of a P3 maths question. Read it, then follow the steps and return the JSON object.',
    clean ? `Note from the parent (follow it if sensible): ${clean}` : 'There is no parent note.',
  ].join('\n');
}

/** Build the OpenAI chat/completions body. */
export function buildChatBody({ imageDataUrl, note, model }) {
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

/** Remove ```lang ... ``` fences around a string, if present. */
export function stripFences(text) {
  let s = String(text == null ? '' : text).trim();
  const fenced = s.match(/^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) s = fenced[1].trim();
  return s;
}

/** Parse a JSON object from model text, tolerating fences and leading chatter. */
export function parseJsonLoose(text) {
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

/**
 * Validate and normalise a parsed reply into
 * {name, questionText, answers:[string], hint, code}. Throws on unusable data.
 */
export function cleanVisualiserReply(raw) {
  const obj = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('The AI reply was not a JSON object.');
  }
  let code = stripFences(obj.code == null ? '' : String(obj.code));
  // Drop any external script/link tags: the sandbox has no network anyway.
  code = code
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .trim();
  if (!code) throw new Error('The AI reply did not include any visualiser code.');
  if (code.length > 200000) throw new Error('The AI visualiser code was too long.');

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

  return {
    name,
    questionText,
    answers,
    hint: cleanString(obj.hint, 600),
    code,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Snap & Play: a whole standalone web app built from one screenshot.
// (Duplicated in ../ai.js — keep the two copies in step.)
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
  "html": "the complete HTML document as one string"
}`;

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
  };
}
