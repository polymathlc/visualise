# visualiseAi (Firebase Cloud Function)

Server-side proxy for `ai.js`. Reads a P3 maths screenshot with OpenAI (`gpt-6-luna`) and returns
`{ok, result:{name, questionText, answers, hint, code}}`. The OpenAI key is a Firebase secret and never reaches the browser.

- Project: `mathgen--app` (see `../.firebaserc`), codebase `visualise` (keeps the cer functions untouched)
- URL: https://us-central1-mathgen--app.cloudfunctions.net/visualiseAi
- CORS: https://polymathlc.github.io and localhost / 127.0.0.1
- Limits: image data URL up to ~7 MB, note up to 2000 chars, 20 requests per IP per 10 minutes per instance

## Deploy

```sh
cd functions && npm install && cd ..
firebase functions:secrets:set OPENAI_API_KEY   # paste the key when prompted; never commit it
firebase deploy --only functions:visualiseAi
```

Optional model override: set the param `VISUALISE_OPENAI_MODEL` (default `gpt-6-luna`).
The system prompt lives in `prompt.js` and is duplicated in `../ai.js` for the browser-key fallback.
