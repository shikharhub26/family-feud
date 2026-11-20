# Finance Feud

A survey-style team game for the Canada Life Finance event: four teams, two semi-finals, one final.

- `dist/artifact/finance-feud.html` — classic edition (keyword matching), published as a Claude artifact
- `dist/artifact/finance-feud-ai.html` — AI edition (Claude Sonnet judges answers and writes host quips), published as a Claude artifact
- `dist/standalone/finance-feud.html` — the classic edition as a normal web page; double-click to run it offline
- `HOST-GUIDE.md` / `host-answer-key.pdf` — rules, run-of-show and every answer

Edit questions in `src/questions.js`, then run `node build.mjs`. The brand red is one value, `--red`, at the top of `src/styles.css`.
