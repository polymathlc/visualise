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
