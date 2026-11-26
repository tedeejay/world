/* Truth or Dare (couples edition). Realtime through Firestore doc games/truthordare;
   in-memory hot-seat in demo mode. Rules live in tod-logic.js, cards in tod-cards.js. */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { $, h, toast, confirmDialog } from './utils.js';
import { state } from './state.js';
import * as L from './tod-logic.js';

let game = null, unsub = null, built = false, busy = false, loadError = false, selCat = 'all', onChange = () => {};
const el = {};

const room = () => state.room;
const players = () => Object.values(CONFIG.rooms).map(r => r.id);
const ref = () => fb.db.collection('games').doc('truthordare');
const nameById = id => { const r = Object.values(CONFIG.rooms).find(x => x.id === id); return r ? r.name : id; };
const me = g => (fb.ready ? room().id : g.turn);              /* demo mode = hot-seat: whoever's turn it is */
const label = id => (fb.ready && room() && id === room().id ? 'You' : nameById(id));
const PICKS = [{ id: 'all', name: 'All', emoji: '🎲' }, ...L.CATS];

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
const draw = type => run(g => L.startTurn(g, me(g), type, selCat), 'Could not draw a card.');
const swap = () => run(g => L.swapCard(g, me(g)), 'Could not swap the card.');
async function submit(text) {
  if (await run(g => L.submitAnswer(g, me(g), text), 'Could not send your answer.')) el.input.value = '';
}
function send() {
  if (!game || !game.card) return;
  const t = el.input.value.trim();
  if (game.card.type === 'truth' && !t) { toast('Type your answer first'); return; }
  submit(t || '✅ Done');
}
async function wipe() {
  if (!(await confirmDialog({ title: 'Start fresh?', body: 'History, counts and seen cards are cleared for both of you.', ok: 'Start fresh', danger: true }))) return;
  run(g => L.resetAll(g));
}

/* ── view ── */
function entryNode(e) {
  return h('div', { class: 'tod__entry' },
    h('div', { class: 'tod__meta' }, label(e.who) + ' · ' + (e.type === 'truth' ? 'Truth' : 'Dare') + (L.catName(e.cat) ? ' · ' + L.catName(e.cat) : '')),
    h('p', { class: 'tod__q' }, e.q),
    h('p', { class: 'tod__a' }, e.a));
}

export function build(onBack) {
  const host = $('#todView');
  if (built || !host) return;
  built = true;
  host.replaceChildren();

  el.status = h('p', { class: 'ttt__status', role: 'status', 'aria-live': 'polite' });
  el.sMe = h('b'); el.sMeL = h('span'); el.sThem = h('b'); el.sThemL = h('span');
  const score = h('div', { class: 'tod__score' }, h('div', null, el.sMe, el.sMeL), h('div', null, el.sThem, el.sThemL));

  el.catBtns = PICKS.map(c => h('button', { type: 'button', class: 'chip', 'aria-label': c.name, onclick: () => { selCat = c.id; paint(); } }, c.emoji + ' ' + c.name));
  el.bTruth = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => draw('truth') }, 'Truth 💕');
  el.bDare = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => draw('dare') }, 'Dare 🔥');
  el.bRand = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => draw('random') }, '🎲 Random');
  el.choose = h('section', { class: 'tod__choose' },
    h('p', { class: 'tod__label' }, 'Pick a vibe, then truth, dare or random'),
    h('div', { class: 'chips' }, ...el.catBtns),
    h('div', { class: 'tod__types' }, el.bTruth, el.bDare, el.bRand));

  el.badge = h('span', { class: 'tod__badge' });
  el.text = h('p', { class: 'tod__text' });
  el.card = h('div', { class: 'tod__card' }, el.badge, el.text);

  el.input = h('textarea', { class: 'tod__input', rows: '3', maxlength: '600', 'aria-label': 'Your answer' });
  el.send = h('button', { class: 'btn btn--primary', type: 'button', onclick: send }, 'Send answer');
  el.person = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => submit('(answered in person)') }, 'Answered in person');
  el.swap = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: swap }, 'Swap card');
  el.answerBox = h('div', { class: 'tod__answer' }, el.input,
    h('div', { class: 'ttt__actions' }, el.send),
    h('div', { class: 'ttt__actions' }, el.person, el.swap));

  el.last = h('div', { class: 'tod__last' });
  el.histList = h('div', { class: 'tod__histlist' });
  el.histSum = h('summary', null, 'Earlier');
  el.hist = h('details', { class: 'tod__hist' }, el.histSum, el.histList);

  host.append(h('div', { class: 'tod' },
    h('div', { class: 'ttt__top' },
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: onBack }, '← Games'),
      h('h3', null, 'Truth or Dare')),
    el.status, score, el.choose, el.card, el.answerBox, el.last, el.hist,
    h('div', { class: 'ttt__actions' }, h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: wipe }, 'Start fresh'))));
}

function statusText(mine, card) {
  if (loadError) return 'Could not load the game. Check your Firestore rules.';
  const demo = fb.ready ? '' : 'Demo · ' + nameById(game.turn) + ': ';
  const them = nameById(L.other(game, me(game)));
  if (!card) return mine ? demo + 'Your turn. Pick truth or dare 💞' : 'Waiting for ' + them + ' to pick… 💞';
  if (!mine) return 'Waiting for ' + them + ' to answer…';
  return demo + (card.type === 'truth' ? 'Be honest, no judging 💞' : 'Your dare. Go for it! 🔥');
}

export function paint() {
  if (!built || !game || !room()) return;
  const m = me(game), pid = L.other(game, m);
  const mine = game.turn === m;
  const card = game.phase === 'answer' && game.card ? game.card : null;

  el.status.textContent = statusText(mine, card);
  el.status.classList.toggle('is-turn', mine);
  el.sMe.textContent = L.total(game.counts[m]); el.sMeL.textContent = label(m) + ' answered';
  el.sThem.textContent = L.total(game.counts[pid]); el.sThemL.textContent = label(pid) + ' answered';

  el.choose.hidden = !(mine && !card);
  el.card.hidden = !card;
  el.answerBox.hidden = !(mine && card);

  /* choose phase */
  PICKS.forEach((c, i) => el.catBtns[i].classList.toggle('on', c.id === selCat));
  el.bTruth.disabled = busy || !L.poolOf('truth', selCat).length;
  el.bDare.disabled = busy || !L.poolOf('dare', selCat).length;
  el.bRand.disabled = busy;

  /* answer phase */
  if (card) {
    const truth = card.type === 'truth';
    el.card.classList.toggle('is-truth', truth);
    el.card.classList.toggle('is-dare', !truth);
    if (el.card.dataset.id !== card.id) {         /* new card: replay the pop animation */
      el.card.dataset.id = card.id;
      el.card.classList.remove('flip'); void el.card.offsetWidth; el.card.classList.add('flip');
    }
    el.badge.textContent = (truth ? 'TRUTH' : 'DARE') + ' · ' + L.catName(card.cat).toUpperCase();
    el.text.textContent = card.text;
    el.input.placeholder = truth ? 'Type your answer…' : 'Add a note (optional)…';
    el.send.textContent = truth ? 'Send answer' : 'Done ✅';
    el.person.hidden = !truth;
    el.swap.hidden = !!game.swapped;
    el.send.disabled = el.person.disabled = el.swap.disabled = busy;
  } else {
    delete el.card.dataset.id;
  }

  /* last answer + earlier history */
  const last = game.history[0];
  el.last.hidden = !last;
  if (last) el.last.replaceChildren(h('p', { class: 'tod__label' }, 'Last round'), entryNode(last));
  const rest = game.history.slice(1);
  el.hist.hidden = !rest.length;
  el.histSum.textContent = 'Earlier (' + rest.length + ')';
  el.histList.replaceChildren(...rest.map(entryNode));
}

/* ── for the Games hub ── */
export const myTurn = () => !!(game && room() && fb.ready && !loadError && game.turn === room().id);
export function hubText() {
  if (loadError) return 'Unavailable right now';
  if (!game || !fb.ready) return 'Tap to play';
  return (game.turn === room().id ? 'Your turn!' : 'Waiting for ' + room().partner)
    + ' · ' + L.total(game.counts[room().id]) + '–' + L.total(game.counts[L.other(game, room().id)]);
}

/* ── lifecycle ── */
export function start(cb) {
  onChange = cb || (() => {});
  busy = false; loadError = false; selCat = 'all';
  game = L.newGame(players());
  if (!fb.ready) return;
  unsub = ref().onSnapshot(doc => {
    game = L.normalize(doc.exists ? doc.data() : null, players());
    loadError = false; onChange();
  }, err => {
    console.warn('[OLW] truth or dare unavailable', err && err.code);
    loadError = true; onChange();
  });
}

export function stop() {
  if (unsub) unsub(); unsub = null;
  game = null;
  if (el.input) el.input.value = '';
}
