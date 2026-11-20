/* AI judge add-on (AI edition only). Asks Claude Sonnet to decide whether a
   spoken answer means the same thing as a board answer, and to suggest a
   one-line quip for the host. The game works without it. */
(function () {
  'use strict';
  const X = Feud.X, esc = Feud.esc;
  const MODEL = 'claude-sonnet-5-5';
  const OFF = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  const A = { fn: null, status: 'starting', named: true, ctl: null, note: '' };
  const opts = extra => Object.assign({ model: MODEL, modelTier: 'quick', effort: 'low' }, extra || {});

  function card() {
    let body, on = false;
    if (A.status === 'starting') body = '<p class="note">Connecting to Claude.</p>';
    else if (A.status === 'idle') body = `<p class="note">Claude Sonnet listens for meaning, so “RMT” counts as “Massage” and a typo never costs a team a strike. It also suggests a one-line quip after each answer. Switch it on before the room arrives: Claude asks for your permission once.</p>
      ${A.note ? `<p class="note"><b>${esc(A.note)}</b></p>` : ''}
      <div><button class="btn btn--go" data-act="ai-on">Switch on the AI judge</button></div>`;
    else if (A.status === 'checking') body = '<p class="note">Waiting for Claude. If a permission box appears, choose Allow.</p>';
    else if (A.status === 'ready') { on = true; body = `<p class="note">${A.named ? 'Claude Sonnet is judging answers and writing host lines.' : 'Claude is judging answers and writing host lines. A faster Claude model is standing in for Sonnet in this view.'} You can still click any tile or press Strike to overrule it.</p>`; }
    else body = '<p class="note">The AI judge is not available in this view, so answers are matched by keyword instead. Open this page from your Claude artifacts, signed in, to use it.</p>';
    return `<div class="assist ${on ? 'is-on' : ''}" id="assist"><h3>AI judge${on ? ' is on' : ''}</h3>${body}</div>`;
  }
  function chip() {
    const on = A.status === 'ready';
    return `<span class="chip-x ${on ? 'is-on' : ''}" id="assist-chip"><i></i>${on ? 'AI judge on' : A.status === 'checking' ? 'AI judge starting' : 'AI judge off'}</span>`;
  }
  function refresh() {
    const c = document.getElementById('assist'), h = document.getElementById('assist-chip');
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (typing && (c || h)) { if (c) c.outerHTML = card(); if (h) h.outerHTML = chip(); }
    else Feud.render();
  }
  function fail(e) {
    const code = e && e.code;
    if (code === 'cancelled') return;
    if (OFF.includes(code)) { A.status = 'off'; return; }
    if (A.status === 'checking') A.status = 'idle';
    A.note = code === 'rate_limited' ? 'Claude is busy right now. Try again in a minute.'
      : code === 'session_expired' ? 'Sign in to Claude again, then try once more.'
      : 'Claude did not answer. Try again.';
  }
  async function warm() {
    if (!A.fn || A.status === 'checking' || A.status === 'ready') return;
    A.status = 'checking'; A.note = ''; refresh();
    try {
      const r = await A.fn('Reply with the single word: ready', opts());
      A.named = !r || r.modelApplied === undefined || r.modelApplied === MODEL;
      A.status = 'ready';
      Feud.toast('AI judge is on');
    } catch (e) { fail(e); }
    refresh();
  }

  const boardText = (q, shown) => q.a.map((a, i) =>
    `${i + 1}. ${a[0]} (also said as: ${String(a[2]).split('|').slice(0, 14).join(', ')}) [${shown[i] ? 'already revealed' : 'hidden'}]`).join('\n');
  const LINE_RULES = 'one short quip (at most 14 words) the host can read aloud about this answer. Warm, playful and office-safe; dry Canadian politeness welcome. Tease the answer, never the person. No profanity, and nothing about anyone\'s appearance, age or job performance.';
  const INTRO = 'You are the judge on "Finance Feud", a live game show at a Canadian insurance company\'s finance team event. Teams try to guess the most popular answers to a question.';

  async function judge(ctx) {
    if (A.status !== 'ready') return null;
    const prompt = `${INTRO} The host typed what a player said out loud; decide whether it counts.

Question: ${ctx.q.q}

Answers on the board:
${boardText(ctx.q, ctx.shown)}

Team "${ctx.team}" answered: "${ctx.text}"

Judging rules:
- Match the answer to the ONE board answer it means the same thing as. Be as generous as a friendly TV host: accept synonyms, slang, brand names, a specific example of a general answer, a general term for a specific answer, and typos (the host types fast).
- Do not match an answer that is only loosely related or means something different.
- If nothing fits, the match is 0.

Also write "line": ${LINE_RULES}

Reply with only JSON like {"match": 3, "line": "..."} where match is the board number, or 0 for no match.`;
    A.ctl = new AbortController();
    try {
      const out = await A.fn.json(prompt, opts({ signal: A.ctl.signal }));
      const n = Math.round(Number(out && out.match));
      const idx = Number.isFinite(n) && n >= 1 && n <= ctx.q.a.length ? n - 1 : -1;
      return { idx, line: out && typeof out.line === 'string' ? out.line.slice(0, 160) : '' };
    } catch (e) {
      fail(e);
      if (!(e && e.code === 'cancelled')) Feud.toast(A.status === 'off' ? 'AI judge switched off. Matching by keyword.' : 'AI judge missed that one. Matched by keyword instead.');
      return null;
    } finally { A.ctl = null; }
  }
  async function after(ctx) {
    if (A.status !== 'ready') return;
    const ruling = ctx.dup ? 'that answer is already on the board'
      : ctx.idx >= 0 ? `correct. It is answer number ${ctx.idx + 1}, "${ctx.q.a[ctx.idx][0]}", worth ${ctx.q.a[ctx.idx][1]} points${ctx.idx === 0 ? ' (the top answer)' : ''}`
      : 'not on the board';
    const prompt = `${INTRO}

Question: ${ctx.q.q}
Team "${ctx.team}" answered: "${ctx.text}"
The ruling: ${ruling}.

Write ${LINE_RULES}

Reply with only JSON like {"line": "..."}.`;
    try {
      const out = await A.fn.json(prompt, opts());
      if (out && typeof out.line === 'string') Feud.setLine(out.line.slice(0, 160), ctx.token);
    } catch (e) { fail(e); }
  }

  X.setup = card;
  X.chip = chip;
  X.menu = () => (A.status === 'idle' ? '<button data-act="ai-on">Switch on the AI judge</button>' : '');
  X.click = a => { if (a === 'ai-on') warm(); };
  X.ready = () => A.status === 'ready';
  X.judge = judge;
  X.after = after;
  X.cancel = () => { if (A.ctl) { try { A.ctl.abort(); } catch (e) { /* ignore */ } } };
  X.boot = async () => {
    let fn = null;
    try { if (window.claude && typeof window.claude.use === 'function') fn = await window.claude.use('sample'); } catch (e) { fn = null; }
    if (fn) { A.fn = fn; A.status = 'idle'; } else A.status = 'off';
    refresh();
  };
})();
