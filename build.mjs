// Builds the two editions from src/. Run: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');
const css = read('styles.css'), questions = read('questions.js'), game = read('game.js'), ai = read('ai.js');

// sanity-check the question bank
const QUESTIONS = vm.runInNewContext(`${questions}; QUESTIONS`);
const ids = new Set();
for (const q of QUESTIONS) {
  if (ids.has(q.id)) throw new Error(`duplicate id ${q.id}`);
  ids.add(q.id);
  const pts = q.a.map(a => a[1]);
  if (pts.reduce((s, n) => s + n, 0) > 100) throw new Error(`${q.id}: points add up to more than 100`);
  if (pts.some((p, i) => i && p > pts[i - 1])) throw new Error(`${q.id}: points must go from high to low`);
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Figtree:wght@400..700&display=swap';
const page = (title, scripts) => `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS}">
<style>
${css}</style>
<div id="app"></div>
<div id="strike" class="strike-ov" hidden></div>
<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
<canvas id="confetti" hidden></canvas>
<script>
${scripts.join('\n')}
Feud.boot();
</script>
`;
const standalone = body => `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
</head>
<body>
${body}</body>
</html>
`;

const classic = page('Finance Feud', [questions, game]);
const aiPage = page('Finance Feud AI Edition', [questions, game, ai]);
if (/\bAI\b|Claude|Sonnet/.test(classic.replace(/Canada Life/g, ''))) throw new Error('classic edition must not mention AI');

mkdirSync(new URL('./dist/artifact/', import.meta.url), { recursive: true });
mkdirSync(new URL('./dist/standalone/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/artifact/finance-feud.html', import.meta.url), classic);
writeFileSync(new URL('./dist/artifact/finance-feud-ai.html', import.meta.url), aiPage);
writeFileSync(new URL('./dist/standalone/finance-feud.html', import.meta.url), standalone(classic));
writeFileSync(new URL('./dist/standalone/finance-feud-ai.html', import.meta.url), standalone(aiPage));

// answer key for the host guide
const CATS = { canada: 'True North', office: 'Office life', finance: 'Canada Life and Finance', wild: 'Wild cards' };
const block = (q, i) => `**${i + 1}. ${q.q}** _(${CATS[q.cat]})_\n\n${q.a.map((a, n) => `${n + 1}. ${a[0]} — ${a[1]}`).join('\n')}\n`;
const section = (title, from, to) => `### ${title}\n\n${QUESTIONS.slice(from, to).map((q, i) => block(q, from + i)).join('\n')}`;
const key = `${section('Semi-final 1', 0, 3)}\n${section('Semi-final 2', 3, 6)}\n${section('The Final', 6, 9)}\n${section('Spare questions', 9, QUESTIONS.length)}`;
const guide = readFileSync(new URL('./HOST-GUIDE.template.md', import.meta.url), 'utf8').replace('{{ANSWER_KEY}}', key);
writeFileSync(new URL('./HOST-GUIDE.md', import.meta.url), guide);
console.log(`Built ${QUESTIONS.length} questions into dist/`);
