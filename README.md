# Finance Feud

A survey-style team game for the Canada Life Finance event: all four teams play a qualifier, the bottom two are out, and the top two play the final.

- `dist/artifact/finance-feud.html` — classic edition (keyword matching), published as a Claude artifact
- `dist/artifact/finance-feud-ai.html` — AI edition (Claude Sonnet judges answers and writes host quips), published as a Claude artifact
- `dist/standalone/finance-feud.html` — the classic edition as a normal web page; double-click to run it offline
- `HOST-GUIDE.md` / `host-answer-key.pdf` — rules, run-of-show and every answer

Edit questions in `src/questions.js`, then run `node build.mjs`. The brand red is one value, `--red`, at the top of `src/styles.css`.

## Hosting the classic edition (GitHub Pages)

`docs/index.html` is the classic edition as a normal web page. It is marked so search engines skip it.

1. Make the repository public: **Settings > General > Danger Zone > Change visibility**. (Pages on a private repository needs a paid GitHub plan.)
2. **Settings > Pages > Build and deployment**: Source **Deploy from a branch**, branch `claude/trusting-hopper-8udutr`, folder `/docs`, then **Save**.
3. After a minute or two the game is at `https://shikharhub26.github.io/family-feud/`.

Anyone with the link can open it, including the answer key at `#answer-key`.

## Moving the AI edition to another Claude account

The AI edition only reaches Claude when it runs as a Claude artifact, so it cannot be hosted on GitHub Pages. Publish it from the other account instead: open Claude Code in that account with this repository, and ask:

> Publish `dist/artifact/finance-feud-ai.html` as an artifact with the `sample` capability (`capabilities: {"sample": {}}`). Don't change the file.

The new artifact belongs to that account, so nothing needs sharing.
