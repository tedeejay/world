/* Two Truths and a Lie. Realtime through Firestore doc games/twotruths;
   in-memory hot-seat in demo mode. Rules live in twotruths-logic.js. */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { $, h, toast, confirmDialog } from './utils.js';
import { state } from './state.js';
import { confetti } from './fx.js';
import * as L from './twotruths-logic.js';

let game = null, unsub = null, built = false, busy = false, loaded = false, loadError = false, celebrated = '', onChange = () => {};
const el = {};

const room = () => state.room;
const players = () => Object.values(CONFIG.rooms).map(r => r.id);
const ref = () => fb.db.collection('games').doc('twotruths');
const nameById = id => { const r = Object.values(CONFIG.rooms).find(x => x.id === id); return r ? r.name : id; };
const label = id => (fb.ready && room() && id === room().id ? 'You' : nameById(id));
/* who is acting right now (demo mode = hot-seat: the writer writes, then the other person guesses) */
const actor = g => (fb.ready ? room().id : g.phase === 'guess' ? L.guesserOf(g) : g.writer);

/* ── data ── */
async function mutate(fn) {
  if (!fb.ready) {
    const next = fn(game);
    if (!next) return false;
    game = next; return true;
  }
  let applied = false;
  await fb.db.runTransaction(async tx => {
    const snap = await tx.get(ref());
    const cur = L.normalize(snap.exists ? snap.data() : null, players());
    const next = fn(cur);
    if (!next) return;
    tx.set(ref(), { ...next, updatedAt: Date.now() });
    applied = true;
  });
  return applied;
}
const withTimeout = (p, ms = 10000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function run(fn, failMsg) {
  if (busy || !game) return false;
  busy = true; onChange();
  let ok = false;
  try {
    ok = await withTimeout(mutate(fn));
    if (!ok) toast('That isn’t available right now', 'error');
  } catch (e) {
    toast(e && e.code === 'permission-denied' ? 'Firestore rules are blocking games. Add a rule for the "games" collection.'
      : e && e.message === 'timeout' ? 'Taking too long. Check your connection and try again.'
      : failMsg || 'Could not save. Check your connection.', 'error');
  }
  busy = false; onChange();
  return ok;
}

/* ── actions ── */
async function send() {
  const vals = el.fields.map(f => f.value);
  const err = L.validate(vals.slice(0, 2), vals[2]);
  if (err) { toast(err); return; }
  if (await run(g => L.submitStatements(g, actor(g), vals.slice(0, 2), vals[2]), 'Could not send your lines.')) el.fields.forEach(f => { f.value = ''; });
}
function pick(i) {
  if (!game || game.phase !== 'guess') return;
  if (actor(game) !== L.guesserOf(game)) { toast('Waiting for ' + nameById(L.guesserOf(game)) + ' to guess…'); return; }
  run(g => L.guess(g, actor(g), i), 'Could not save your guess.');
}
const next = () => run(g => L.nextRound(g), 'Could not start the next round.');
async function wipe() {
  if (!(await confirmDialog({ title: 'Start fresh?', body: 'Scores and history are cleared for both of you.', ok: 'Start fresh', danger: true }))) return;
  run(g => L.resetAll(g));
}

/* ── view ── */
function roundNode(e) {
  const gname = nameById(L.other({ players: players() }, e.writer));
  return h('div', { class: 'tod__entry' },
    h('div', { class: 'tod__meta' }, nameById(e.writer) + '’s round · ' + gname + (e.correct ? ' caught the lie' : ' was fooled')),
    ...e.items.map((t, i) => h('p', { class: 'ttl__line' + (i === e.lie ? ' is-lie' : '') }, (i === e.lie ? 'LIE · ' : '') + t)));
}

export function build(onBack) {
  const host = $('#ttlView');
  if (built || !host) return;
  built = true;
  host.replaceChildren();

  el.status = h('p', { class: 'ttt__status', role: 'status', 'aria-live': 'polite' });
  el.sMe = h('b'); el.sMeL = h('span'); el.sThem = h('b'); el.sThemL = h('span');
  const score = h('div', { class: 'tod__score' }, h('div', null, el.sMe, el.sMeL), h('div', null, el.sThem, el.sThemL));

  /* writer form: two truths and the lie, in that fixed order. They get shuffled on send. */
  const spec = [['Truth 1', 'Something true about you…'], ['Truth 2', 'Another true thing…'], ['The lie', 'Something that sounds true but isn’t…']];
  el.fields = spec.map(([, ph]) => h('textarea', { class: 'tod__input ttl__field', rows: '2', maxlength: String(L.MAX_LEN), placeholder: ph }));
  el.send = h('button', { class: 'btn btn--primary', type: 'button', onclick: send }, 'Send 💌');
  el.write = h('section', { class: 'ttl__write' },
    h('p', { class: 'tod__label' }, 'Write two truths and one lie. We shuffle them so she can’t tell by the order.'),
    ...spec.map(([name], i) => h('div', { class: 'ttl__row' }, h('span', { class: 'ttl__tag' + (i === 2 ? ' is-lie' : '') }, name), el.fields[i])),
    h('div', { class: 'ttt__actions' }, el.send));

  /* the three lines the guesser taps */
  el.opts = [0, 1, 2].map(i => {
    const text = h('span', { class: 'ttl__text' });
    const badge = h('span', { class: 'ttl__badge' });
    const b = h('button', { type: 'button', class: 'ttl__opt', onclick: () => pick(i) }, text, badge);
    b._text = text; b._badge = badge;
    return b;
  });
  el.hint = h('p', { class: 'tod__label' }, 'Tap the line you think is the lie');
  el.list = h('section', { class: 'ttl__list' }, el.hint, h('div', { class: 'ttl__opts' }, ...el.opts));

  el.msg = h('p', { class: 'ttl__msg', role: 'status', 'aria-live': 'polite' });
  el.next = h('button', { class: 'btn btn--primary', type: 'button', onclick: next }, 'Next round');
  el.result = h('div', { class: 'ttl__result' }, el.msg, h('div', { class: 'ttt__actions' }, el.next));

  el.histList = h('div', { class: 'tod__histlist' });
  el.histSum = h('summary', null, 'Earlier rounds');
  el.hist = h('details', { class: 'tod__hist' }, el.histSum, el.histList);

  host.append(h('div', { class: 'ttl' },
    h('div', { class: 'ttt__top' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: onBack }, '← Games'),
      h('h3', null, 'Two Truths & a Lie')),
    el.status, score, el.write, el.list, el.result, el.hist,
    h('div', { class: 'ttt__actions' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: wipe }, 'Start fresh'))));
}

function resultText(g, m) {
  const correct = g.pick === g.lie, guesser = L.guesserOf(g);
  if (!fb.ready) return correct ? nameById(guesser) + ' caught the lie! 🎉' : nameById(guesser) + ' was fooled by ' + nameById(g.writer) + '! 🎉';
  if (m === guesser) return correct ? 'You caught the lie! 🎉' : 'Fooled! That one was true. The lie is lit up green.';
  return correct ? nameById(guesser) + ' caught your lie.' : 'You fooled ' + nameById(guesser) + '! 🎉';
}

export function paint() {
  if (!built || !game || !room()) return;
  const g = game, m = fb.ready ? room().id : actor(g), pid = L.other(g, m);
  const guesser = L.guesserOf(g);
  const iWrite = g.writer === m, iGuess = guesser === m;
  const res = g.phase === 'result';
  const demo = fb.ready ? '' : 'Demo · ';

  el.status.textContent = loadError ? 'Could not load the game. Check your Firestore rules.'
    : g.phase === 'write' ? (iWrite ? demo + nameById(g.writer) + ': write 2 truths and 1 lie 💞' : 'Waiting for ' + nameById(g.writer) + ' to write… 💞')
    : g.phase === 'guess' ? (iGuess ? demo + nameById(guesser) + ': which one is the lie?' : 'Waiting for ' + nameById(guesser) + ' to guess…')
    : (m === guesser || !fb.ready ? (g.pick === g.lie ? 'Correct!' : 'Not quite') : 'Round finished');
  el.status.classList.toggle('is-turn', (g.phase === 'write' && iWrite) || (g.phase === 'guess' && iGuess));
  el.sMe.textContent = g.scores[m] || 0; el.sMeL.textContent = label(m);
  el.sThem.textContent = g.scores[pid] || 0; el.sThemL.textContent = label(pid);

  el.write.hidden = !(g.phase === 'write' && iWrite);
  el.list.hidden = g.phase === 'write';
  el.hint.hidden = !(g.phase === 'guess' && iGuess);
  el.result.hidden = !res;
  el.send.disabled = busy;

  /* the three lines: green = the lie (right answer), red = a wrong pick */
  const canPick = g.phase === 'guess' && iGuess && !busy;
  el.opts.forEach((b, i) => {
    b._text.textContent = g.items[i] || '';
    b.className = 'ttl__opt' + (canPick ? ' can' : '')
      + (res && i === g.lie ? ' is-correct' : '')
      + (res && i === g.pick && i !== g.lie ? ' is-wrong' : '')
      + (res && i === g.pick ? ' is-picked' : '');
    b._badge.textContent = res ? (i === g.lie ? 'LIE' : 'TRUTH') + (i === g.pick ? ' · PICKED' : '')
      : (g.phase === 'guess' && iWrite && i === g.lie ? 'YOUR LIE' : '');
    b._badge.hidden = !b._badge.textContent;
    b.setAttribute('aria-disabled', String(!canPick));
  });

  if (res) {
    el.msg.textContent = resultText(g, m);
    el.msg.classList.toggle('is-good', g.pick === g.lie ? (iGuess || !fb.ready) : iWrite);
    const key = g.round + ':result';
    if (key !== celebrated) {
      celebrated = key;
      if (loaded) { const winner = g.pick === g.lie ? guesser : g.writer; if (!fb.ready || winner === m) confetti(); }
    }
  }
  el.next.disabled = busy;

  const rest = res ? g.history.slice(1) : g.history;
  el.hist.hidden = !rest.length;
  el.histSum.textContent = 'Earlier rounds (' + rest.length + ')';
  el.histList.replaceChildren(...rest.map(roundNode));
}

/* ── for the Games hub ── */
export const myTurn = () => !!(game && room() && fb.ready && !loadError
  && ((game.phase === 'write' && game.writer === room().id) || (game.phase === 'guess' && L.guesserOf(game) === room().id)));
export function hubText() {
  if (loadError) return 'Unavailable right now';
  if (!game || !fb.ready) return 'Tap to play';
  const me = room().id, g = game, them = room().partner;
  const s = g.phase === 'write' ? (g.writer === me ? 'Your turn to write' : 'Waiting for ' + them)
    : g.phase === 'guess' ? (L.guesserOf(g) === me ? 'Your turn to guess!' : 'Waiting for ' + them)
    : 'Round finished';
  return s + ' · ' + (g.scores[me] || 0) + '–' + (g.scores[L.other(g, me)] || 0);
}

/* ── lifecycle ── */
export function start(cb) {
  onChange = cb || (() => {});
  busy = false; loaded = false; loadError = false; celebrated = '';
  game = L.newGame(players());
  if (!fb.ready) { loaded = true; return; }
  unsub = ref().onSnapshot(doc => {
    game = L.normalize(doc.exists ? doc.data() : null, players());
    if (!loaded) { loaded = true; if (game.phase === 'result') celebrated = game.round + ':result'; }   /* don't celebrate old rounds */
    loadError = false; onChange();
  }, err => {
    console.warn('[OLW] two truths unavailable', err && err.code);
    loaded = true; loadError = true; onChange();
  });
}

export function stop() {
  if (unsub) unsub(); unsub = null;
  game = null; loaded = false;
  if (el.fields) el.fields.forEach(f => { f.value = ''; });
}
