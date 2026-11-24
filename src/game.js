/* Finance Feud: game engine and screens. Plain DOM, no libraries.
   Stage 1, the qualifier: all four teams play the same boards, taking turns.
   Stage 2, the final: the top two play head-to-head with face-off, strikes and steal. */
const Feud = (() => {
  'use strict';

  const CATS = { canada: 'True North', office: 'Office life', finance: 'Canada Life and Finance', wild: 'Wild cards' };
  const NAMES = { q: 'Qualifier', f: 'The Final' };
  const STORE = 'finance-feud-state-v2';
  const ORDER = SCHEDULE.q.concat(SCHEDULE.f);
  QUESTIONS.forEach(q => { if (!ORDER.includes(q.id)) ORDER.push(q.id); });
  const SPARES = ORDER.slice(SCHEDULE.q.length + SCHEDULE.f.length);
  const QMAP = {};
  QUESTIONS.forEach(q => { QMAP[q.id] = Object.assign({ no: ORDER.indexOf(q.id) + 1 }, q); });

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const other = t => (t === 0 ? 1 : 0);

  /* ---------------- state ---------------- */
  const fresh = () => ({
    v: 2, screen: 'setup', org: 'Canada Life Finance',
    teams: ['The Accrual World', 'Ledger Legends', 'Fiscal Cliffhangers', 'Margin Callers'],
    order: [0, 1, 2, 3], roundsQ: 4, roundsF: 3, sound: true,
    stages: {
      q: { done: false, rank: null, score: [0, 0, 0, 0] },
      f: { t: [null, null], score: [0, 0], winner: null },
    },
    used: [], match: null,
  });
  let S = fresh();
  const ui = { modal: null, menu: false, pending: null, token: 0, line: '', just: null, resumed: false };
  const hist = [];
  const X = {}; // optional add-on hooks, filled in by an add-on script when present

  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* storage is optional */ } }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (d && d.v === 2 && Array.isArray(d.teams) && d.stages) { S = d; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }
  function commit(fn) {
    hist.push(JSON.stringify(S));
    if (hist.length > 80) hist.shift();
    fn();
    save();
    render();
  }
  function undo() {
    if (!hist.length) { toast('Nothing to undo'); return; }
    cancelPending();
    S = JSON.parse(hist.pop());
    ui.line = '';
    save(); render();
    toast('Last step undone');
  }

  /* ---------------- sound ---------------- */
  let actx = null;
  function audio() {
    if (!S.sound) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { return null; }
    return actx;
  }
  function tone(f, at, dur, type, vol) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type || 'triangle'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  const sfx = {
    ding() { tone(988, 0, 0.18); tone(1319, 0.1, 0.6); },
    top() { tone(784, 0, 0.16); tone(988, 0.1, 0.16); tone(1319, 0.2, 0.16); tone(1568, 0.3, 0.8); },
    buzz() { tone(116, 0, 0.7, 'sawtooth', 0.2); tone(110, 0, 0.7, 'square', 0.12); },
    pop() { tone(520, 0, 0.12, 'sine', 0.15); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.3)); tone(1319, 0.55, 1.1); },
    fanfare() { [523, 523, 523, 698, 880, 784, 1047].forEach((f, i) => tone(f, i * 0.16, 0.34, 'triangle', 0.25)); },
  };

  /* ---------------- answer matching ---------------- */
  const STOP = new Set(('a an the my your their our his her to of for it its is are was be being some that this you we they them ' +
    'with and or really very just so i im me when by at from they their theyre were').split(' '));
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function stem(w) {
    if (w.length > 4) {
      if (/ies$/.test(w)) w = w.slice(0, -3) + 'y';
      else if (/(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
      else if (/s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    } else if (w.length === 4 && /[^s]s$/.test(w)) w = w.slice(0, -1);
    if (w.length > 5 && /ing$/.test(w)) {
      w = w.slice(0, -3);
      if (/([bdgmnprt])\1$/.test(w)) w = w.slice(0, -1);
    } else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    if (w.length >= 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  const toks = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).map(stem);
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function near(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    if (n < 5) return false;
    const max = n >= 8 ? 2 : 1;
    return lev(a, b, max) <= max;
  }
  function keysOf(ans) { return [ans[0]].concat(String(ans[2] || '').split('|')).filter(Boolean); }
  /* strict = the typed words are exactly one accepted wording.
     loose  = every word of an accepted wording appears in what was typed (small typos allowed). */
  function matchLocal(text, q, strict) {
    const it = toks(text), joined = norm(text).replace(/ /g, '');
    if (!it.length && !joined) return { idx: -1 };
    let best = -1, bestScore = 0;
    q.a.forEach((ans, i) => {
      keysOf(ans).forEach(k => {
        const kt = toks(k);
        if (!kt.length) return;
        let ok, score = kt.join('').length;
        if (norm(k).replace(/ /g, '') === joined) { ok = true; score += 100; }
        else if (strict) ok = kt.length === it.length && kt.every(a => it.includes(a));
        else ok = kt.every(a => it.some(b => near(a, b)));
        if (ok && score > bestScore) { bestScore = score; best = i; }
      });
    });
    return { idx: best };
  }

  /* ---------------- tournament flow ---------------- */
  const multFor = (key, i, total) => {
    if (key === 'f') return i === total - 1 ? 3 : (i === total - 2 && total >= 3 ? 2 : 1);
    return i === total - 1 ? 2 : 1;
  };
  function pickQuestion(key, i, total, tiebreak) {
    const plan = SCHEDULE[key];
    const want = tiebreak ? null : i === total - 1 ? plan[plan.length - 1] : i < plan.length - 1 ? plan[i] : null;
    if (want && !S.used.includes(want)) return want;
    const spare = SPARES.find(id => !S.used.includes(id));
    if (spare) return spare;
    const any = ORDER.find(id => !S.used.includes(id));
    return any || ORDER[0];
  }
  function newRound(m, tiebreak) {
    const qid = pickQuestion(m.key, m.round, m.total, tiebreak);
    const q = QMAP[qid];
    m.r = {
      qid, mult: tiebreak ? 1 : multFor(m.key, m.round, m.total), tiebreak: !!tiebreak, phase: 'intro',
      shown: q.a.map(() => false), by: q.a.map(() => null), pot: 0, strikes: 0, control: null,
      fo: { turn: null, first: null, hit: null, n: 0, fresh: false }, winner: null, award: 0,
    };
    if (m.mode === 'all') {
      m.r.out = m.t.map(() => 0);      // strikes per team this round
      m.r.earned = m.t.map(() => 0);   // points banked per team this round
      m.r.turn = m.players[m.round % m.players.length];
    }
  }
  function startMatch(key) {
    commit(() => {
      if (key === 'q') {
        S.match = { key, mode: 'all', t: S.order.slice(), score: [0, 0, 0, 0], tb: [0, 0, 0, 0], players: [0, 1, 2, 3], round: 0, total: S.roundsQ, done: false };
      } else {
        S.match = { key, mode: 'duel', t: S.stages.f.t.slice(), score: [0, 0], round: 0, total: S.roundsF, done: false };
      }
      newRound(S.match, false);
      S.screen = 'match';
    });
    ui.line = '';
  }
  function setQuestion(qid) {
    commit(() => {
      const r = S.match.r, q = QMAP[qid];
      r.qid = qid; r.shown = q.a.map(() => false); r.by = q.a.map(() => null);
    });
  }
  function showQuestion() {
    sfx.pop();
    commit(() => {
      const m = S.match, r = m.r;
      r.phase = m.mode === 'all' ? 'turns' : 'faceoff';
      if (!S.used.includes(r.qid)) S.used.push(r.qid);
    });
  }
  function buzz(team) { commit(() => { const fo = S.match.r.fo; fo.turn = team; fo.first = team; fo.n = 0; fo.fresh = false; }); }
  function actingTeam() {
    const r = S.match.r;
    if (r.phase === 'turns') return r.turn;
    if (r.phase === 'faceoff') return r.fo.turn;
    if (r.phase === 'play') return r.control;
    if (r.phase === 'steal') return other(r.control);
    return null;
  }
  function endRound(r, m, w) {
    r.winner = w; r.award = r.pot * r.mult; m.score[w] += r.award; r.phase = 'reveal';
  }
  /* qualifier helpers */
  const rankKey = (m, s) => m.score[s] * 100000 + m.tb[s];
  const ranked = m => m.t.map((_, s) => s).sort((a, b) => rankKey(m, b) - rankKey(m, a));
  const cutTied = m => { const o = ranked(m); return rankKey(m, o[1]) === rankKey(m, o[2]); };
  function advance(m, r) { // next team that still has a strike left, or end the round
    const n = m.players.length, at = m.players.indexOf(r.turn);
    for (let k = 1; k <= n; k++) {
      const seat = m.players[(at + k) % n];
      if (r.out[seat] < 2) { r.turn = seat; return true; }
    }
    r.phase = 'reveal';
    return false;
  }

  function hit(idx) {
    const m = S.match, r = m.r, q = QMAP[r.qid];
    if (r.shown[idx]) return;
    const team = actingTeam();
    if (r.phase === 'reveal') { // showing what nobody found
      sfx.pop(); ui.just = idx;
      commit(() => { r.shown[idx] = true; r.by[idx] = 'late'; });
      return;
    }
    if (team == null) return;
    ui.just = idx;
    let finished = false;
    commit(() => {
      r.shown[idx] = true; r.by[idx] = team; r.pot += q.a[idx][1];
      if (r.phase === 'turns') {
        const pts = q.a[idx][1] * r.mult;
        r.earned[team] += pts;
        if (r.tiebreak) m.tb[team] += pts; else m.score[team] += pts;
        if (r.shown.every(Boolean)) { r.phase = 'reveal'; finished = true; } else advance(m, r);
      } else if (r.phase === 'faceoff') {
        const fo = r.fo;
        fo.fresh = false;
        if (idx === 0) { fo.winner = team; r.phase = 'choose'; }
        else if (fo.n === 0) { fo.hit = { team, idx }; fo.n = 1; fo.turn = other(team); }
        else { fo.winner = fo.hit && fo.hit.idx < idx ? fo.hit.team : team; r.phase = 'choose'; }
      } else if (r.phase === 'play') {
        if (r.shown.every(Boolean)) { endRound(r, m, r.control); finished = true; }
      } else if (r.phase === 'steal') { endRound(r, m, team); finished = true; }
    });
    if (finished) sfx.win(); else if (idx === 0) sfx.top(); else sfx.ding();
  }
  function miss() {
    const m = S.match, r = m.r;
    if (!['turns', 'faceoff', 'play', 'steal'].includes(r.phase) || actingTeam() == null) return;
    sfx.buzz();
    let count = 1, ended = false;
    commit(() => {
      if (r.phase === 'turns') {
        r.out[r.turn] += 1; count = r.out[r.turn];
        ended = !advance(m, r);
      } else if (r.phase === 'faceoff') {
        const fo = r.fo;
        if (fo.n === 0) { fo.n = 1; fo.turn = other(fo.turn); fo.fresh = false; }
        else if (fo.hit) { fo.winner = fo.hit.team; r.phase = 'choose'; }
        else { fo.n = 0; fo.turn = null; fo.first = null; fo.hit = null; fo.fresh = true; }
      } else if (r.phase === 'play') {
        r.strikes += 1; count = r.strikes;
        if (r.strikes >= 3) r.phase = 'steal';
      } else { endRound(r, m, r.control); ended = true; }
    });
    strikeOverlay(count);
    if (ended) setTimeout(() => sfx.win(), 900);
  }
  function choose(play) {
    commit(() => { const r = S.match.r; r.control = play ? r.fo.winner : other(r.fo.winner); r.strikes = 0; r.phase = 'play'; });
  }
  function revealNext() {
    const r = S.match.r;
    for (let i = r.shown.length - 1; i >= 0; i--) if (!r.shown[i]) { hit(i); return; }
  }
  function nextRound() {
    ui.line = '';
    const m = S.match;
    const last = m.round >= m.total - 1;
    if (!last) { commit(() => { m.round += 1; newRound(m, false); }); return; }
    if (m.mode === 'all') {
      if (cutTied(m)) {
        commit(() => {
          const o = ranked(m), k = rankKey(m, o[1]);
          m.players = m.t.map((_, s) => s).filter(s => rankKey(m, s) === k);
          m.round += 1; m.total += 1; newRound(m, true);
        });
        return;
      }
      sfx.fanfare();
      commit(() => {
        const o = ranked(m);
        m.done = true; m.rank = o;
        const score = [0, 0, 0, 0];
        m.t.forEach((ti, s) => { score[ti] = m.score[s]; });
        S.stages.q = { done: true, rank: o.map(s => m.t[s]), score };
        S.stages.f.t = [m.t[o[0]], m.t[o[1]]];
      });
      return;
    }
    if (m.score[0] === m.score[1]) { commit(() => { m.round += 1; m.total += 1; newRound(m, true); }); return; }
    sfx.fanfare();
    commit(() => {
      const w = m.score[0] > m.score[1] ? 0 : 1;
      S.stages.f.score = m.score.slice(); S.stages.f.winner = m.t[w]; m.done = true; m.won = w;
      S.screen = 'champion';
    });
    confetti();
  }

  /* typed answers */
  function cancelPending() { ui.token += 1; if (ui.pending) { ui.pending = null; if (X.cancel) X.cancel(); } }
  async function submit(text) {
    text = String(text || '').trim();
    if (!text || ui.pending || actingTeam() == null) return;
    const r = S.match.r, q = QMAP[r.qid], team = actingTeam();
    const token = ++ui.token;
    ui.line = '';
    let res = matchLocal(text, q, true), judged = false;
    if (res.idx < 0 && X.judge && X.ready && X.ready()) {
      ui.pending = { text }; render();
      const out = await X.judge({ q, shown: r.shown.slice(), text, team: S.teams[S.match.t[team]] });
      if (token !== ui.token) return;
      ui.pending = null;
      if (out) { res = out; judged = true; if (out.line) ui.line = out.line; }
    }
    if (res.idx < 0 && !judged) res = matchLocal(text, q, false);
    const dup = res.idx >= 0 && r.shown[res.idx];
    if (dup) { toast('Already on the board. Ask for another answer.'); render(); }
    else if (res.idx >= 0) hit(res.idx);
    else miss();
    if (!judged && X.after && X.ready && X.ready()) {
      X.after({ q, text, idx: dup ? -1 : res.idx, dup, team: S.teams[S.match.t[team]], token });
    }
  }
  function setLine(text, token) { if (token === ui.token && S.screen === 'match') { ui.line = text; render(); } }

  /* ---------------- overlays ---------------- */
  let strikeTimer = 0, toastTimer = 0;
  function strikeOverlay(n) {
    const el = document.getElementById('strike');
    el.innerHTML = '<div>' + '<span>✕</span>'.repeat(Math.max(1, Math.min(3, n))) + '</div>';
    el.hidden = false;
    clearTimeout(strikeTimer);
    strikeTimer = setTimeout(() => { el.hidden = true; }, 1150);
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  function confetti() {
    const cv = document.getElementById('confetti');
    if (!cv || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const ctx = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
    const cols = ['#D02927', '#FFFFFF', '#F4B740', '#A31C1E', '#FFD98A'];
    const bits = Array.from({ length: 170 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.6, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
      vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
      c: cols[(Math.random() * cols.length) | 0],
    }));
    cv.hidden = false;
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      bits.forEach(b => {
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      });
      if (t - t0 < 7000 && S.screen === 'champion') requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, W, H); cv.hidden = true; }
    })(t0);
  }

  /* ---------------- views ---------------- */
  const ICON = {
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  };
  const tname = i => (i == null ? '' : S.teams[i]);
  const minutes = () => Math.round((S.roundsQ * 5.5 + S.roundsF * 4.5 + 5) / 5) * 5;

  function top(where) {
    return `<header class="top">
      <div class="brand"><span class="brand-mark">Finance Feud</span><span class="brand-org">${esc(S.org)}</span></div>
      ${where ? `<span class="where">${esc(where)}</span>` : ''}
      <div class="tools">
        ${X.chip ? X.chip() : ''}
        <button class="tool" data-act="sound" aria-label="${S.sound ? 'Turn sound off' : 'Turn sound on'}">${S.sound ? ICON.sound : ICON.mute}<span>${S.sound ? 'Sound on' : 'Sound off'}</span></button>
        <button class="tool" data-act="restart" aria-label="Reset the game">${ICON.reset}<span>Reset</span></button>
        <button class="tool" data-act="full" aria-label="Full screen">${ICON.full}<span>Full screen</span></button>
        <button class="tool" data-act="menu" aria-expanded="${ui.menu}" aria-label="Menu">${ICON.menu}<span>Menu</span></button>
        ${ui.menu ? `<div class="menu" role="menu">
          ${S.screen !== 'setup' ? '<button data-act="go-stages">Standings</button>' : ''}
          <button data-act="rules">How to play</button>
          ${S.screen === 'match' ? '<button data-act="scores">Adjust the scores</button>' : ''}
          ${X.menu ? X.menu() : ''}
          <button data-act="keywarn">Answer key (host only)</button>
        </div>` : ''}
      </div>
    </header>`;
  }

  function viewSetup() {
    const teamIn = i => `<label class="team-in" style="--tc:var(--t${i})"><i class="dot"></i>
      <input class="input" id="team-${i}" data-team="${i}" value="${esc(S.teams[i])}" maxlength="28" aria-label="Team name"></label>`;
    const stepper = (which, val, label) => `<div class="row row--between">
        <div class="field-label">${label}</div>
        <div class="stepper"><button data-act="rounds" data-which="${which}" data-d="-1" aria-label="Fewer rounds">−</button><output id="rounds-${which}">${val}</output><button data-act="rounds" data-which="${which}" data-d="1" aria-label="More rounds">+</button></div>
      </div>`;
    return `${top('')}
    <main class="setup">
      <section>
        <p class="hero-org">${esc(S.org)} presents</p>
        <h1 class="hero-title">Finance Feud</h1>
        <p class="hero-line">Four teams play. Two go through. One final. Zero spreadsheets.</p>
        <p class="hero-sub">Guess the most popular answers and bank the points. After the qualifier the bottom two teams are out, and the top two play head-to-head.</p>
        <div class="hero-actions">
          <button class="btn btn--go btn--big" data-act="open" data-primary>Start here</button>
          <button class="btn btn--line btn--big" data-act="rules">How to play</button>
        </div>
      </section>
      <section class="panel" aria-label="Game setup">
        <h2>Set up the game</h2>
        <label class="field"><span>Shown under the title</span>
          <input class="input" id="org" value="${esc(S.org)}" maxlength="40"></label>
        <div>
          <div class="row row--between" style="margin-bottom:.5rem"><span class="field-label">Teams, in playing order</span>
            <button class="btn btn--quiet" data-act="shuffle">Shuffle the order</button></div>
          <div class="draw">
            <div class="draw-col">${teamIn(S.order[0])}${teamIn(S.order[1])}</div>
            <div class="draw-col">${teamIn(S.order[2])}${teamIn(S.order[3])}</div>
          </div>
        </div>
        ${stepper('Q', S.roundsQ, 'Qualifier rounds, all four teams')}
        ${stepper('F', S.roundsF, 'Final rounds, top two teams')}
        <p class="note" id="mins">About ${minutes()} minutes in total. With ${S.roundsQ} qualifier rounds, ${S.roundsQ % 4 === 0 ? 'every team answers first the same number of times' : 'some teams answer first more often than others; 4 is the fair number'}.</p>
        ${X.setup ? X.setup() : ''}
      </section>
    </main>`;
  }

  function viewStages() {
    const sq = S.stages.q, sf = S.stages.f, champ = sf.winner;
    const live = k => S.match && S.match.key === k && !S.match.done;
    const qTeams = sq.done ? sq.rank : S.order;
    const qRows = qTeams.map((ti, pos) => `<div class="mrow ${sq.done && pos > 1 ? 'is-out' : ''}" style="--tc:var(--t${ti})"><i class="dot"></i><span>${esc(tname(ti))}</span>
      ${sq.done ? (pos < 2 ? '<em class="won">Through</em>' : '<em class="out">Out</em>') + `<b>${sq.score[ti]}</b>` : ''}</div>`).join('');
    const fRow = k => sf.t[k] == null
      ? `<div class="mrow is-tbd"><span>${k === 0 ? 'First' : 'Second'} place in the qualifier</span></div>`
      : `<div class="mrow ${champ != null && champ !== sf.t[k] ? 'is-out' : ''}" style="--tc:var(--t${sf.t[k]})"><i class="dot"></i><span>${esc(tname(sf.t[k]))}</span>${champ === sf.t[k] ? '<em class="won">Champions</em>' : ''}${champ != null ? `<b>${sf.score[k]}</b>` : ''}</div>`;
    return `${top('Standings')}
    <main class="bracket-wrap">
      <div class="bracket-head"><h1>${champ != null ? esc(tname(champ)) + ' are the champions' : sq.done ? 'Two teams left' : 'Road to the final'}</h1>
        ${!S.match ? '<button class="btn btn--quiet" data-act="go-setup">Edit teams</button>' : ''}</div>
      <div class="bracket">
        <div class="semis"><article class="mcard ${!sq.done ? 'is-next' : ''}">
          <div class="mcard-h"><span>Stage 1: Qualifier</span>${sq.done ? '<span>Finished</span>' : ''}</div>
          <p class="mcard-sub">All four teams play the same ${S.roundsQ} rounds. The top two go through. The bottom two are out.</p>
          ${qRows}
          ${!sq.done ? (live('q') ? '<button class="btn btn--go" data-act="resume" data-primary>Back to the qualifier</button>'
            : '<button class="btn btn--go" data-act="start" data-k="q" data-primary>Start the qualifier</button>') : ''}
        </article></div>
        <div class="join" aria-hidden="true"></div>
        <div><article class="mcard mcard--final ${sq.done && champ == null ? 'is-next' : ''}">
          <div class="mcard-h"><span>Stage 2: The Final</span>${champ != null ? '<span>Finished</span>' : ''}</div>
          <p class="mcard-sub">Head-to-head over ${S.roundsF} rounds, with face-offs, three strikes and steals.</p>
          ${fRow(0)}${fRow(1)}
          ${sq.done && champ == null ? (live('f') ? '<button class="btn btn--go" data-act="resume" data-primary>Back to the final</button>'
            : '<button class="btn btn--go" data-act="start" data-k="f" data-primary>Start the final</button>') : ''}
        </article></div>
      </div>
    </main>`;
  }

  function hostBar(cue, acts) {
    return `<footer class="host">
      <div class="host-cue"><small>Host</small><strong>${cue}</strong></div>
      <div class="host-act">${acts}<button class="btn btn--undo" data-act="undo" ${hist.length ? '' : 'disabled'}>Undo</button></div>
    </footer>`;
  }
  const answerForm = (ph, missLabel) => `<form data-form="answer" autocomplete="off">
      <input class="input" id="answer" name="answer" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Answer heard">
      <button class="btn btn--go" type="submit">Check</button></form>
      <button class="btn btn--line" data-act="miss">${missLabel}</button>`;
  const list = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  function viewMatch() {
    const m = S.match, r = m.r, q = QMAP[r.qid], all = m.mode === 'all';
    const names = m.t.map(tname);
    const act = actingTeam();
    const roundLabel = r.tiebreak ? 'Tie-breaker' : `Round ${m.round + 1} of ${m.total}`;
    const multLabel = r.mult === 3 ? 'Triple points' : r.mult === 2 ? 'Double points' : '';
    const boxes = (n, used) => Array.from({ length: n }, (_, i) => `<i class="${i < used ? 'on' : ''}">✕</i>`).join('');

    const teamPanel = seat => {
      let state = '', live = false, dim = false, strikes = '';
      if (all) {
        const playing = m.players.includes(seat);
        if (m.done) { const pos = m.rank.indexOf(seat); state = pos < 2 ? 'Through to the final' : 'Eliminated'; live = pos < 2; dim = pos > 1; }
        else if (!playing) { state = rankKey(m, seat) > rankKey(m, m.players[0]) ? 'Already through' : 'Eliminated'; dim = true; }
        else {
          if (r.phase === 'intro') state = r.turn === seat ? 'Answers first' : '';
          else if (r.phase === 'turns' && r.turn === seat) { state = 'Answering'; live = true; }
          else if (r.phase === 'reveal' && r.earned[seat]) state = `+${r.earned[seat]} this round`;
          else if (r.out[seat] >= 2) { state = 'Out this round'; dim = r.phase === 'turns'; }
          if (r.phase !== 'intro') strikes = boxes(2, r.out[seat]);
        }
      } else {
        if (m.done) state = m.won === seat ? 'Winner' : '';
        else if (r.phase === 'faceoff' && act === seat) state = 'Answering';
        else if (r.phase === 'choose' && r.fo.winner === seat) state = 'Won the face-off';
        else if (r.phase === 'play' && r.control === seat) state = 'Playing';
        else if (r.phase === 'steal' && act === seat) state = 'Chance to steal';
        else if (r.phase === 'reveal' && r.winner === seat) state = `+${r.award} this round`;
        live = !m.done && ((act === seat && r.phase !== 'intro') || (r.phase === 'reveal' && r.winner === seat) || (r.phase === 'choose' && r.fo.winner === seat));
        if ((r.phase === 'play' || r.phase === 'steal' || r.phase === 'reveal') && r.control === seat) strikes = boxes(3, r.strikes);
      }
      return `<section class="team ${live ? 'is-live' : ''} ${dim ? 'is-dim' : ''}" style="--tc:var(--t${m.t[seat]})" aria-label="${esc(names[seat])}">
        <span class="team-flag"></span>
        <div class="team-name">${esc(names[seat])}</div>
        <div class="team-score">${m.score[seat]}</div>
        <div class="team-state">${esc(state)}</div>
        <div class="strikes" aria-label="Strikes">${strikes}</div>
      </section>`;
    };

    let centre;
    if (r.phase === 'intro') {
      centre = `<div class="intro">
        <div class="chips"><span class="chip">${NAMES[m.key]}</span><span class="chip">${esc(CATS[q.cat])}</span>${multLabel ? `<span class="chip chip--hot">${multLabel}</span>` : ''}</div>
        ${r.tiebreak ? `<div class="intro-n">Tie!</div><div class="intro-of">One more round decides it</div>`
          : `<div class="intro-n">${m.round + 1}</div><div class="intro-of">Round ${m.round + 1} of ${m.total}</div>`}
        <p>${all ? `Teams take turns, one answer each. ${esc(names[r.turn])} go first.` : 'One player from each team, up to the front for the face-off.'}</p>
      </div>`;
    } else {
      const rows = q.a.length <= 4 ? q.a.length : Math.ceil(q.a.length / 2);
      const tiles = q.a.map((ans, i) => {
        const open = r.shown[i], late = r.by[i] === 'late';
        return `<li class="tile ${open ? 'is-open' : ''} ${late ? 'is-late' : ''} ${ui.just === i ? 'is-just' : ''}"><div class="tile-in">${open
          ? `<span class="tile-a">${esc(ans[0])}</span><span class="tile-p">${ans[1]}</span>`
          : `<button class="tile-hide" data-act="tile" data-i="${i}" aria-label="Reveal answer ${i + 1}"><span class="tile-num">${i + 1}</span></button>`}</div></li>`;
      }).join('');
      let under;
      if (m.done) under = `<div class="banner">${all ? `${esc(names[m.rank[0]])} and ${esc(names[m.rank[1]])} go through to the final` : `${esc(names[m.won])} win ${m.score[m.won]} to ${m.score[other(m.won)]}`}</div>`;
      else if (r.phase === 'reveal' && all) {
        const best = Math.max.apply(null, r.earned);
        under = `<div class="banner">${best > 0 ? `${list(m.players.filter(s => r.earned[s] === best).map(s => esc(names[s])))} bank the most this round: +${best}` : 'Nobody scored this round'}</div>`;
      } else if (r.phase === 'reveal') under = `<div class="banner">${esc(names[r.winner])} take the round: ${r.pot}${r.mult > 1 ? ` × ${r.mult} = ${r.award}` : ''} points</div>`;
      else under = `<div class="pot"><span>${all ? 'Found so far' : 'Round total'}</span><b>${r.pot}</b>${r.mult > 1 ? `<em>× ${r.mult}</em>` : ''}</div>`;
      centre = `<div class="chips"><span class="chip">${roundLabel}</span><span class="chip">${esc(CATS[q.cat])}</span>${multLabel ? `<span class="chip chip--hot">${multLabel}</span>` : ''}<span class="chip">Question ${q.no}</span></div>
        <h1 class="q-text">${esc(q.q)}</h1>
        <ol class="board ${q.a.length <= 4 ? 'is-single' : ''}" style="--rows:${rows}">${tiles}</ol>
        ${under}
        ${ui.line ? `<div class="line-x">${esc(ui.line)}</div>` : ''}`;
    }

    let cue, acts;
    const tbtn = side => `<button class="btn btn--team" style="--tc:var(--t${m.t[side]})" data-act="buzz" data-s="${side}">${esc(names[side])}</button>`;
    if (ui.pending) {
      cue = `Checking “${esc(ui.pending.text)}”`;
      acts = `<span class="wait"><i></i><i></i><i></i> Checking the board</span><button class="btn btn--line" data-act="miss">Call it wrong</button>`;
    } else if (m.done) {
      cue = all ? `${esc(names[m.rank[0]])} and ${esc(names[m.rank[1]])} are through. ${esc(names[m.rank[2]])} and ${esc(names[m.rank[3]])} are out.` : 'That is the game.';
      acts = `<button class="btn btn--go" data-act="go-stages" data-primary>See the standings</button>`;
    } else if (r.phase === 'intro') {
      cue = all
        ? (r.tiebreak ? `Tie at the cut. ${list(m.players.map(s => esc(names[s])))} play one more round.` : `All four teams play this round. ${esc(names[r.turn])} answer first.`)
        : 'Call one player from each team to the front.';
      acts = `<button class="btn btn--line" data-act="picker">Change the question</button><button class="btn btn--go" data-act="show" data-primary>Show the question</button>`;
    } else if (r.phase === 'turns') {
      cue = `${esc(names[act])}: one player, one answer.${r.out[act] === 1 ? ' One strike already.' : ''}`;
      acts = answerForm('Type the answer you heard', 'Strike') + '<button class="btn btn--undo" data-act="endround">End round</button>';
    } else if (r.phase === 'faceoff' && r.fo.turn == null) {
      cue = r.fo.fresh ? 'Neither answer is on the board. Call up the next two players and read the question again. Who buzzed first?' : 'Read the question aloud. Who buzzed first?';
      acts = `${tbtn(0)}<span class="kbd">←</span><span class="kbd">→</span>${tbtn(1)}`;
    } else if (r.phase === 'faceoff') {
      cue = r.fo.hit ? `${esc(names[act])}: beat “${esc(q.a[r.fo.hit.idx][0])}” to take control.`
        : `${esc(names[act])} to answer.`;
      acts = answerForm('Type the answer you heard', 'No answer');
    } else if (r.phase === 'choose') {
      cue = `${esc(names[r.fo.winner])} win the face-off. Play or pass?`;
      acts = `<button class="btn btn--line" data-act="pass">Pass</button><button class="btn btn--go" data-act="play" data-primary>Play</button>`;
    } else if (r.phase === 'play') {
      cue = `${esc(names[r.control])} are playing. One answer each, down the line.`;
      acts = answerForm('Type the answer you heard', 'Strike');
    } else if (r.phase === 'steal') {
      cue = `Three strikes. ${esc(names[act])} huddle for one answer to steal ${r.pot * r.mult} points.`;
      acts = answerForm('Type the steal answer', 'No steal');
    } else {
      const left = r.shown.filter(v => !v).length;
      const last = m.round >= m.total - 1;
      const tie = all ? cutTied(m) : m.score[0] === m.score[1];
      const nextLabel = !last ? 'Next round' : tie ? 'Play the tie-breaker' : all ? 'See who goes through' : 'Finish the final';
      cue = left ? `${left} answer${left > 1 ? 's' : ''} still hidden. Show the room what they missed.` : 'Board is clear. On you go.';
      acts = left
        ? `<button class="btn btn--line" data-act="next">${nextLabel}</button><button class="btn btn--go" data-act="reveal" data-primary>Reveal the next answer</button>`
        : `<button class="btn btn--go" data-act="next" data-primary>${nextLabel}</button>`;
    }
    const sides = all ? [[0, 1], [2, 3]] : [[0], [1]];
    return `${top(NAMES[m.key])}
      <main class="stage ${all ? 'stage--four' : ''}"><div class="side">${sides[0].map(teamPanel).join('')}</div><div class="centre">${centre}</div><div class="side">${sides[1].map(teamPanel).join('')}</div></main>
      ${hostBar(cue, acts)}`;
  }

  function viewChampion() {
    const f = S.stages.f, w = f.winner, k = f.t.indexOf(w);
    return `${top('The Final')}
      <main class="champ">
        <span class="champ-k">Finance Feud champions</span>
        <h1 class="champ-name">${esc(tname(w))}</h1>
        <p class="champ-score">${f.score[k]} to ${f.score[other(k)]} over ${esc(tname(f.t[other(k)]))}</p>
        <div class="row" style="justify-content:center">
          <button class="btn btn--go" data-act="party" data-primary>More confetti</button>
          <button class="btn btn--line" data-act="go-stages">See the standings</button>
        </div>
      </main>`;
  }

  function viewKey() {
    const card = q => `<article class="key-q"><h3><small>${q.no}</small>${esc(q.q)}</h3><ol>${q.a.map(a => `<li><span>${esc(a[0])}</span><b>${a[1]}</b></li>`).join('')}</ol></article>`;
    const group = (title, ids) => `<h2>${title}</h2><div class="key-grid">${ids.map(id => card(QMAP[id])).join('')}</div>`;
    return `<main class="key">
      <div class="row row--between"><h1>Host answer key</h1><a class="btn btn--line key-back" href="#play">Back to the game</a></div>
      <p class="key-warn">Every answer is on this page. Keep it off the big screen: open it on your phone or print it.</p>
      <p>The number beside each question matches the “Question” tag shown on the game screen. Click any hidden tile on the board to reveal it by hand.</p>
      ${group('Qualifier', SCHEDULE.q)}${group('The Final', SCHEDULE.f)}${group('Spare questions', SPARES)}
    </main>`;
  }

  function viewModal() {
    if (!ui.modal) return '';
    let body = '';
    if (ui.modal === 'rules') {
      body = `<h2>How to play</h2><ol class="rules">
        <li><div><b>The qualifier.</b> All four teams play the same board. Teams take turns, and each turn one player gives one answer.</div></li>
        <li><div><b>Bank it.</b> If the answer is on the board, your team banks its points straight away. If not, that is a strike. Two strikes and your team sits out the rest of that round.</div></li>
        <li><div><b>The cut.</b> After the last qualifying round, which is worth double, the top two teams go through to the final. The bottom two are out.</div></li>
        <li><div><b>The final: face-off.</b> One player from each team comes up. First to buzz answers. The higher answer wins control, and that team chooses to play or pass.</div></li>
        <li><div><b>The final: strikes and steals.</b> The playing team answers down the line. Three strikes and the other team huddles for one answer to steal the round total.</div></li>
        <li><div><b>Champions.</b> Final rounds are worth single, double, then triple points. Most points wins.</div></li>
      </ol><div class="modal-foot"><button class="btn btn--go" data-act="close" data-primary>Got it</button></div>`;
    } else if (ui.modal === 'picker') {
      const cur = S.match.r.qid;
      body = `<h2>Choose a question</h2>` + Object.keys(CATS).map(c => {
        const qs = QUESTIONS.filter(q => q.cat === c && (!S.used.includes(q.id) || q.id === cur));
        return qs.length ? `<div class="pick-cat">${esc(CATS[c])}</div><div class="pick-list">${qs.map(q =>
          `<button class="pick ${q.id === cur ? 'is-current' : ''}" data-act="pick" data-q="${q.id}"><small>Question ${QMAP[q.id].no}</small>${esc(q.q)}</button>`).join('')}</div>` : '';
      }).join('') + `<div class="modal-foot"><button class="btn btn--line" data-act="close">Keep the current one</button></div>`;
    } else if (ui.modal === 'scores') {
      const m = S.match;
      body = `<h2>Adjust the scores</h2><form data-form="scores" class="score-edit">
        ${m.t.map((ti, s) => `<label for="score-${s}"><b>${esc(tname(ti))}</b></label><input class="input" id="score-${s}" name="s${s}" type="number" inputmode="numeric" min="0" step="1" value="${m.score[s]}" style="width:8rem">`).join('')}
        <div class="modal-foot" style="grid-column:1/-1"><button type="button" class="btn btn--line" data-act="close">Cancel</button><button class="btn btn--go" type="submit">Save scores</button></div>
      </form>`;
    } else if (ui.modal === 'restart') {
      body = `<h2>Reset the game?</h2>
        <p><b>Clear the scores</b> starts the game again from the qualifier. Team names and round settings stay.</p>
        <p><b>Reset everything</b> also puts the team names, title and round settings back to the defaults.</p>
        <p class="note">You cannot undo either.</p>
        <div class="modal-foot"><button class="btn btn--line" data-act="close" data-primary>Cancel</button><button class="btn btn--line" data-act="reset-all">Reset everything</button><button class="btn btn--go" data-act="restart-yes">Clear the scores</button></div>`;
    } else if (ui.modal === 'keywarn') {
      body = `<h2>Open the answer key?</h2><p>It shows every answer. Make sure this screen is not the one the room can see.</p>
        <div class="modal-foot"><button class="btn btn--line" data-act="close">Cancel</button><a class="btn btn--go" href="#answer-key" data-act="close-soft">Show the answers</a></div>`;
    }
    return `<div class="modal-bg" data-act="close-bg"><div class="modal ${ui.modal === 'picker' ? 'modal--wide' : ''}" role="dialog" aria-modal="true">${body}</div></div>`;
  }

  function render() {
    const app = document.getElementById('app');
    if (!app) return;
    const isKey = location.hash === '#answer-key';
    let html;
    if (isKey) html = viewKey();
    else if (S.screen === 'setup') html = viewSetup();
    else if (S.screen === 'stages') html = viewStages();
    else if (S.screen === 'champion') html = viewChampion();
    else html = viewMatch();
    app.innerHTML = html + (isKey ? '' : viewModal());
    ui.just = null;
    if (isKey) return;
    const target = ui.modal ? app.querySelector('.modal [data-primary], .modal input') : (app.querySelector('#answer') || (S.screen !== 'setup' ? app.querySelector('[data-primary]') : null));
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ---------------- events ---------------- */
  function resetGame() {
    const keep = { teams: S.teams, org: S.org, order: S.order, roundsQ: S.roundsQ, roundsF: S.roundsF, sound: S.sound };
    S = Object.assign(fresh(), keep);
    hist.length = 0; ui.line = ''; cancelPending();
    save();
  }
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (ui.menu && (!el || el.dataset.act !== 'menu')) { ui.menu = false; if (!el) { render(); return; } }
    if (!el) return;
    const a = el.dataset.act;
    if (a === 'close-bg') { if (e.target === el) { ui.modal = null; render(); } return; }
    if (a === 'close-soft') { ui.modal = null; return; }
    audio();
    switch (a) {
      case 'menu': ui.menu = !ui.menu; render(); break;
      case 'sound': S.sound = !S.sound; save(); render(); if (S.sound) sfx.pop(); break;
      case 'full': try { (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => toast('Full screen is not available here. Try F11.')); } catch (err) { toast('Full screen is not available here. Try F11.'); } break;
      case 'rules': case 'scores': case 'restart': case 'keywarn': case 'picker': ui.modal = a; render(); break;
      case 'close': ui.modal = null; render(); break;
      case 'restart-yes': ui.modal = null; resetGame(); render(); toast('Scores cleared. Ready for a new game.'); break;
      case 'reset-all': ui.modal = null; S = Object.assign(fresh(), { sound: S.sound }); hist.length = 0; ui.line = ''; cancelPending(); save(); render(); toast('Everything is back to the defaults.'); break;
      case 'open': case 'go-stages': S.screen = 'stages'; save(); render(); break;
      case 'go-setup': S.screen = 'setup'; save(); render(); break;
      case 'resume': S.screen = 'match'; save(); render(); break;
      case 'shuffle': {
        const o = S.order.slice();
        for (let i = 3; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [o[i], o[j]] = [o[j], o[i]]; }
        S.order = o; save(); render(); break;
      }
      case 'rounds': {
        const k = el.dataset.which === 'Q' ? 'roundsQ' : 'roundsF';
        S[k] = Math.max(2, Math.min(6, S[k] + Number(el.dataset.d))); save(); render(); break;
      }
      case 'start': startMatch(el.dataset.k); break;
      case 'show': showQuestion(); break;
      case 'pick': ui.modal = null; setQuestion(el.dataset.q); break;
      case 'buzz': buzz(Number(el.dataset.s)); break;
      case 'tile': cancelPending(); hit(Number(el.dataset.i)); break;
      case 'miss': cancelPending(); miss(); break;
      case 'endround': cancelPending(); commit(() => { S.match.r.phase = 'reveal'; }); break;
      case 'play': choose(true); break;
      case 'pass': choose(false); break;
      case 'reveal': revealNext(); break;
      case 'next': nextRound(); break;
      case 'undo': undo(); break;
      case 'party': sfx.fanfare(); confetti(); break;
      default: if (X.click) X.click(a, el);
    }
  }
  function onSubmit(e) {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    audio();
    if (f.dataset.form === 'answer') {
      const inp = f.querySelector('input'), v = inp.value;
      inp.value = '';
      submit(v);
    } else if (f.dataset.form === 'scores') {
      const v = S.match.t.map((_, s) => Math.max(0, Math.round(Number(f.elements['s' + s].value) || 0)));
      ui.modal = null;
      commit(() => { S.match.score = v; });
    }
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset && t.dataset.team != null) { S.teams[Number(t.dataset.team)] = t.value.trim() || `Team ${Number(t.dataset.team) + 1}`; save(); }
    else if (t.id === 'org') { S.org = t.value.trim(); save(); const o = document.querySelector('.hero-org'); if (o) o.textContent = S.org + ' presents'; const b = document.querySelector('.brand-org'); if (b) b.textContent = S.org; }
  }
  function onKey(e) {
    if (e.key === 'Escape') { if (ui.modal || ui.menu) { ui.modal = null; ui.menu = false; render(); } return; }
    if (ui.modal || S.screen !== 'match' || location.hash === '#answer-key') return;
    const r = S.match.r;
    if (r.phase === 'faceoff' && r.fo.turn == null && !S.match.done) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); buzz(0); }
      if (e.key === 'ArrowRight') { e.preventDefault(); buzz(1); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target && e.target.value)) { e.preventDefault(); undo(); }
  }

  function boot() {
    const app = document.getElementById('app');
    ui.resumed = load();
    app.addEventListener('click', onClick);
    app.addEventListener('submit', onSubmit);
    app.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', render);
    render();
    if (ui.resumed && S.screen !== 'setup') toast('Welcome back. Your game was saved.');
    if (X.boot) X.boot();
  }

  return { boot, render, toast, setLine, esc, X, state: () => S, _test: { matchLocal, QMAP } };
})();
