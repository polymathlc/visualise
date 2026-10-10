# Picture It · P3 Maths

An endless, scrolling feed of Primary 3 maths questions. Every question comes with a
picture the child has to open and play with before the answer box unlocks, so they
stop doing sums blindly.

Live site: https://polymathlc.github.io/visualise/

## For the child
- **Questions** tab: scroll forever. 15 P3 topics (add/subtract to 10 000, times
  tables, bar-model word problems, fractions, money, time, length/mass/volume, area
  and perimeter and more), each in warm-up, core and stretch levels.
- Tap **Picture it**, touch the bar model / number line / groups, then answer.
- Topic chips filter the feed; the strip shows answered, correct and streak.

## Snap & Play tab
Paste (Ctrl/Cmd+V), drop or pick a screenshot of any question. `gpt-6-luna` builds a
whole interactive mini app for it, shown large with full screen, rebuild with a tweak,
edit code, download as .html, and save to the library and feed. Past builds stay in
this browser.

## For the parent (Parent Studio tab)
1. **Add a question**: question text, accepted answers, unit, hint, topic, optional
   screenshot, and a picture (built-in visualiser, one from your library, or its own code).
2. **Paste a visualiser**: paste any HTML/JS snippet, preview it live in a safe
   sandbox (it can read `window.QUESTION`), save it to your library.
3. **Screenshot → visualiser (AI)**: paste or drop a screenshot of a question;
   `gpt-6-luna` transcribes it, gives the answer and a hint, and writes an interactive
   visualiser you can edit and save.
4. **Settings & backup**: picture-first lock, how often your questions appear,
   difficulty, export/import JSON.

Everything you add is saved in this browser (`vis_` keys in localStorage). Use
export/import to move it to another device.

## AI setup (same approach as the cer app)
The OpenAI key never lives in this repo. Like cer, it is a Firebase secret
(`OPENAI_API_KEY`) in the `mathgen--app` project, used by a small cloud function:

```bash
cd functions && npm install
firebase functions:secrets:set OPENAI_API_KEY
firebase deploy --only functions:visualiseAi
```

The site calls `https://us-central1-mathgen--app.cloudfunctions.net/visualiseAi`.
Until that is deployed, a parent can paste a personal OpenAI key under
**AI settings** in the studio; it stays in that browser only.

## Files
`index.html` page · `app.js` wiring · `core.js` storage, answers, sandbox ·
`visualisers.js` 10 built-in pictures · `questions.js` generator · `feed.js` endless
feed · `studio.js` Parent Studio · `ai.js` AI client · `functions/` cloud function.
No build step: GitHub Pages serves the files as they are.
