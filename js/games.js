/* Games tab: a hub plus realtime tic-tac-toe (Firestore doc games/tictactoe; in-memory hot-seat in demo mode).
   Truth or Dare (tod.js) and Two Truths & a Lie (twotruths.js) are loaded from the EXTRA list below. */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { $, h, toast, confirmDialog } from './utils.js';
import { state, bus } from './state.js';
import { confetti } from './fx.js';
import * as T from './tictactoe-logic.js';

let game = null, unsub = null, wired = false, view = 'hub', loaded = false, loadError = false, celebrated = -1, busy = false;
const el = { cells: [] };

/* Extra games, each in its own module (build/start/stop/paint/myTurn/hubText). They are loaded with import() on purpose:
   if one file is missing or stale on the server, only that game is skipped and its card explains why. Nothing else breaks.
   To add one: a card button (open), a hub subtitle span (sub) and a hidden container (view) in index.html. */
const EXTRA = [
  { id: 'tod', name: 'Truth or Dare', file: './tod.js', open: '#openTod', sub: '#todHubSub', view: '#todView', mod: null, status: 'loading' },
  { id: 'ttl', name: 'Two Truths & a Lie', file: './twotruths.js', open: '#openTtl', sub: '#ttlHubSub', view: '#ttlView', mod: null, status: 'loading' }
];
const live = () => EXTRA.filter(x => x.status === 'ready');
let extrasLoading = null, startGen = 0;
function loadExtras() {
  if (extrasLoading) return extrasLoading;
  return (extrasLoading = Promise.all(EXTRA.map(async x => {
    try {
      x.mod = await import(x.file);
      if (!$(x.open) || !$(x.view)) throw new Error('markup missing from index.html');
      x.mod.build(() => { view = 'hub'; paint(); });
      x.status = 'ready';
    } catch (e) {
      x.status = 'failed';
      console.warn('[OLW] "' + x.name + '" could not load (' + x.file + '):', e && e.message);
      const s = $(x.sub); if (s) s.textContent = 'Not loaded. Check the files, then hard refresh.';
    }
  })));
}

const room = () => state.room;
const players = () => Object.values(CONFIG.rooms).map(r => r.id);
const C = () => T.cfgOf(CONFIG.ticTacToe);
const ref = () => fb.db.collection('games').doc('tictactoe');
const partnerId = () => room().partner.toLowerCase();
const nameOf = id => (id === room().id ? 'You' : room().partner);
const isEmoji = s => !/^[A-Za-z]$/.test(s);
const markOf = id => (game && game.marks[id]) || '?';

/* ── data ── */
async function mutate(fn) {
  if (!fb.ready) {
    const next = fn(game);
    if (!next) return false;
    game = next; paint(); return true;
  }
  let applied = false;
  await fb.db.runTransaction(async tx => {
    const snap = await tx.get(ref());
    const cur = T.normalize(snap.exists ? snap.data() : null, C(), players());
    const next = fn(cur);
    if (!next) return;
    tx.set(ref(), { ...next, updatedAt: Date.now() });
    applied = true;
  });
  return applied;
}
const withTimeout = (p, ms = 10000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function run(fn, failMsg) {
  if (busy || !game) return;
  busy = true; paint();
  try {
    if (!(await withTimeout(mutate(fn)))) toast('That isn’t available right now', 'error');
  } catch (e) {
    toast(e && e.code === 'permission-denied' ? 'Firestore rules are blocking games. Add a rule for the "games" collection.'
      : e && e.message === 'timeout' ? 'Taking too long. Check your connection and try again.'
      : failMsg || 'Could not save. Check your connection.', 'error');
  }
  busy = false; paint();
}

/* ── actions ── */
const myTurnNow = () => game && !game.winner && (fb.ready ? game.turn === room().id : true);
function nudge() {
  if (!el.board) return;
  el.board.classList.remove('shake'); void el.board.offsetWidth; el.board.classList.add('shake');
  setTimeout(() => el.board && el.board.classList.remove('shake'), 450);
}
function play(i) {
  if (busy || !game) return;
  if (game.winner) { toast('Round finished. Tap “Play again” 🎉'); return; }
  if (!myTurnNow()) { nudge(); toast('Not your turn yet. Waiting for ' + room().partner + '…'); return; }
  if (game.board[i]) { nudge(); toast('That spot is taken'); return; }
  const who = fb.ready ? room().id : game.turn;
  run(g => T.applyMove(g, who, i));
}
const again = () => run(g => T.nextRound(g, C()));
async function restart() {
  if (!(await confirmDialog({ title: 'Start over?', body: 'The current board is cleared. Scores stay.', ok: 'Start over' }))) return;
  run(g => T.nextRound(g, C(), true));
}
async function wipeScores() {
  if (!(await confirmDialog({ title: 'Reset scores?', body: 'Wins and draws go back to 0.', ok: 'Reset', danger: true }))) return;
  run(g => T.resetScores(g));
}
function pickMark(sym) { run(g => T.setMark(g, room().id, sym, C().symbols), 'Could not change your mark.'); }

/* ── view ── */
function buildView() {
  const host = $('#tttView');
  host.replaceChildren();
  el.status = h('p', { class: 'ttt__status', role: 'status', 'aria-live': 'polite' });
  el.sMe = h('b'); el.sMeL = h('span'); el.sDraw = h('b'); el.sThem = h('b'); el.sThemL = h('span');
  const score = h('div', { class: 'ttt__score' },
    h('div', null, el.sMe, el.sMeL), h('div', null, el.sDraw, h('span', null, 'Draws')), h('div', null, el.sThem, el.sThemL));
  el.cells = Array.from({ length: 9 }, (_, i) => h('button', { type: 'button', class: 'cell', 'aria-label': 'Cell ' + (i + 1), onclick: () => play(i) }));
  el.again = h('button', { class: 'btn btn--primary', type: 'button', onclick: again }, 'Play again');
  el.restart = h('button', { class: 'btn btn--ghost', type: 'button', onclick: restart }, 'Start over');
  el.chips = C().symbols.map(sym => h('button', { type: 'button', class: 'chip', onclick: () => pickMark(sym), 'aria-label': 'Use ' + sym }, sym));
  el.marksHint = h('p');
  host.append(h('div', { class: 'ttt' },
    h('div', { class: 'ttt__top' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => { view = 'hub'; paint(); } }, '← Games'),
      h('h3', null, 'Tic-Tac-Toe')),
    el.status, score,
    (el.board = h('div', { class: 'ttt__board' }, el.cells)),
    h('div', { class: 'ttt__actions' }, el.again, el.restart),
    h('div', { class: 'ttt__marks' }, el.marksHint, h('div', { class: 'chips' }, el.chips)),
    h('div', { class: 'ttt__actions' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: wipeScores }, 'Reset scores'))));
}

function statusText() {
  if (loadError) return 'Could not load the game. Check your Firestore rules.';
  const me = room().id;
  if (game.winner === 'draw') return 'It’s a draw 🤝';
  if (game.winner) return fb.ready ? (game.winner === me ? 'You won! 🎉' : room().partner + ' won this round') : nameOf(game.winner).replace('You', room().name) + ' won! 🎉';
  if (!fb.ready) return 'Demo mode: ' + (game.turn === me ? room().name : room().partner) + '’s turn';
  return game.turn === me ? 'Your turn' : 'Waiting for ' + room().partner + '… 💞';
}

function paint() {
  if (!game || !room()) return;
  const me = room().id, pid = partnerId();
  const turnMine = !game.winner && (fb.ready ? game.turn === me : false);

  /* celebrate once per finished round (not for games that were already finished when we loaded) */
  if (loaded && game.winner && game.round !== celebrated) {
    celebrated = game.round;
    if (game.winner === me || !fb.ready) confetti();
  }

  /* hub card + tab badge */
  const sub = $('#tttHubSub');
  if (sub) sub.textContent = loadError ? 'Unavailable right now'
    : (game.winner ? 'Round finished · tap to play again' : turnMine ? 'Your turn!' : fb.ready ? 'Waiting for ' + room().partner : 'Tap to play')
      + ' · ' + (game.scores[me] || 0) + '–' + (game.scores[pid] || 0);
  const card = $('#openTtt'); if (card) card.classList.toggle('is-turn', turnMine);
  live().forEach(x => {
    const s = $(x.sub); if (s) s.textContent = x.mod.hubText();
    const c = $(x.open); if (c) c.classList.toggle('is-turn', x.mod.myTurn());
  });
  const badge = $('#gameBadge');
  if (badge) { const n = state.tab !== 'games' ? (turnMine ? 1 : 0) + live().filter(x => x.mod.myTurn()).length : 0; badge.textContent = n; badge.classList.toggle('show', n > 0); }

  $('#gamesHub').hidden = view !== 'hub';
  $('#tttView').hidden = view !== 'ttt';
  EXTRA.forEach(x => { const v = $(x.view); if (v) v.hidden = view !== x.id; });
  const active = live().find(x => x.id === view); if (active) active.mod.paint();
  if (view !== 'ttt') return;

  el.status.textContent = statusText();
  el.status.classList.toggle('is-turn', turnMine);
  el.sMe.textContent = game.scores[me] || 0; el.sMeL.textContent = 'You · ' + markOf(me);
  el.sThem.textContent = game.scores[pid] || 0; el.sThemL.textContent = room().partner + ' · ' + markOf(pid);
  el.sDraw.textContent = game.scores.draws || 0;

  const canPlay = myTurnNow() && !busy;
  game.board.forEach((who, i) => {
    const c = el.cells[i];
    const sym = who ? markOf(who) : '';
    if (c.textContent !== sym) c.textContent = sym;
    c.className = 'cell' + (who ? (who === me ? ' me' : ' them') : '') + (who && isEmoji(sym) ? ' emoji' : '')
      + (!who && canPlay ? ' can' : '') + (game.line && game.line.includes(i) ? ' win' : '');
    c.setAttribute('aria-disabled', String(!!who || !canPlay));
    c.dataset.ghost = markOf(fb.ready ? me : game.turn);
  });
  el.board.classList.toggle('is-wait', !game.winner && !canPlay && !busy);
  el.again.hidden = !game.winner;
  el.restart.hidden = !!game.winner || !game.board.some(Boolean);

  el.marksHint.textContent = 'Your mark (pick any symbol ' + room().partner + ' isn’t using)';
  C().symbols.forEach((sym, i) => {
    const chip = el.chips[i];
    chip.classList.toggle('on', game.marks[me] === sym);
    chip.disabled = busy || game.marks[pid] === sym;
  });
}

/* ── lifecycle ── */
function wire() {
  if (wired) return;
  wired = true;
  buildView();
  $('#openTtt').addEventListener('click', () => { view = 'ttt'; paint(); });
  /* A card always reacts: it opens the game, or says why it can't (still loading / files missing or out of date) */
  EXTRA.forEach(x => {
    const open = $(x.open);
    if (!open) return;
    open.addEventListener('click', () => {
      if (x.status === 'ready') { view = x.id; paint(); }
      else if (x.status === 'loading') toast('Loading ' + x.name + '…');
      else toast(x.name + ' didn’t load. Upload all the new files, then hard refresh (Ctrl+Shift+R).', 'error');
    });
  });
  bus.on('tab', () => paint());
}

export function start() {
  wire();
  view = 'hub'; loaded = false; loadError = false; celebrated = -1; busy = false;
  game = T.newGame(C(), players());
  const gen = ++startGen;
  loadExtras().then(() => {
    if (gen !== startGen || !game) return;           /* locked again before the modules arrived */
    live().forEach(x => x.mod.start(paint));
    paint();
  });
  if (!fb.ready) { loaded = true; paint(); return; }
  unsub = ref().onSnapshot(doc => {
    game = T.normalize(doc.exists ? doc.data() : null, C(), players());
    if (!loaded) { loaded = true; if (game.winner) celebrated = game.round; }
    loadError = false; paint();
  }, err => {
    console.warn('[OLW] games unavailable', err && err.code);
    loaded = true; loadError = true; paint();
  });
  paint();
}

export function stop() {
  if (unsub) unsub(); unsub = null;
  startGen++;
  live().forEach(x => x.mod.stop());
  game = null; view = 'hub'; loaded = false;
  const badge = $('#gameBadge'); if (badge) { badge.textContent = '0'; badge.classList.remove('show'); }
}
