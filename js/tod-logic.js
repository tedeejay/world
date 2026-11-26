/* Truth or Dare rules. Pure functions only (no DOM, no Firebase) so they are easy to test.
   A game is a plain object stored as-is in Firestore doc games/truthordare.

   Flow:  phase 'choose' (turn player picks category + truth/dare/random, a card is drawn at random)
          -> phase 'answer' (turn player answers or marks the dare done; may swap the card once)
          -> answer is saved to history, the turn passes to the partner, phase goes back to 'choose'. */
import { CARDS } from './tod-cards.js';

export const CATS = [
  { id: 'romantic', name: 'Romantic', emoji: '💕' },
  { id: 'spicy', name: 'Spicy', emoji: '😈' },
  { id: 'deep', name: 'Deep Talk', emoji: '💭' },
  { id: 'funny', name: 'Funny', emoji: '😂' }
];
export const TYPES = ['truth', 'dare'];
export const HISTORY_MAX = 30;
export const ANSWER_MAX = 600;

export const catName = id => (CATS.find(c => c.id === id) || {}).name || '';
export const other = (g, who) => (g.players[0] === who ? g.players[1] : g.players[0]);
export const total = c => ((c && c.truth) || 0) + ((c && c.dare) || 0);

/* All cards of a type in a category ('all' = every category). Ids are stable per position. */
export function poolOf(type, cat = 'all') {
  const src = CARDS[type] || {};
  const cats = cat === 'all' ? Object.keys(src) : [cat];
  const out = [];
  cats.forEach(c => (src[c] || []).forEach((text, i) => out.push({ id: type[0] + '-' + c + '-' + i, type, cat: c, text })));
  return out;
}

export function newGame(players = ['jay', 'dee']) {
  const counts = {};
  players.forEach(p => { counts[p] = { truth: 0, dare: 0 }; });
  return { players, turn: players[0], phase: 'choose', card: null, swapped: false, used: [], history: [], counts, round: 1 };
}

/* Fill in anything missing from stored data so old/partial docs never crash the UI. */
export function normalize(data, players = ['jay', 'dee']) {
  const base = newGame(players);
  const g = { ...base, ...(data || {}), players: base.players };
  g.counts = {};
  players.forEach(p => { g.counts[p] = { ...base.counts[p], ...((((data && data.counts) || {})[p]) || {}) }; });
  if (!Array.isArray(g.used)) g.used = [];
  if (!Array.isArray(g.history)) g.history = [];
  if (!players.includes(g.turn)) g.turn = base.turn;
  if (g.phase !== 'answer' || !(g.card && g.card.text)) { g.phase = 'choose'; g.card = null; }
  return g;
}

/* Random card that has not been seen yet. When a pool runs out, only that pool's cards are shuffled back in.
   type 'random' first picks truth or dare at random among the types that have cards in this category. */
export function pick(g, type, cat = 'all', rnd = Math.random) {
  let t = type;
  if (t === 'random') {
    const avail = TYPES.filter(x => poolOf(x, cat).length);
    if (!avail.length) return null;
    t = avail[Math.floor(rnd() * avail.length)];
  }
  const all = poolOf(t, cat);
  if (!all.length) return null;
  let used = g.used;
  let fresh = all.filter(c => !used.includes(c.id));
  if (!fresh.length) {
    const ids = new Set(all.map(c => c.id));
    used = used.filter(id => !ids.has(id));
    fresh = all;
  }
  const card = fresh[Math.floor(rnd() * fresh.length)];
  return { card, used: [...used, card.id] };
}

export function startTurn(g, who, type, cat = 'all', rnd = Math.random) {
  if (g.turn !== who || g.phase !== 'choose') return null;
  const r = pick(g, type, cat, rnd);
  if (!r) return null;
  return { ...g, phase: 'answer', card: r.card, used: r.used, cat, swapped: false };
}

/* One swap per turn: draws another card of the same kind. */
export function swapCard(g, who, rnd = Math.random) {
  if (g.turn !== who || g.phase !== 'answer' || !g.card || g.swapped) return null;
  const r = pick(g, g.card.type, g.cat || 'all', rnd);
  if (!r) return null;
  return { ...g, card: r.card, used: r.used, swapped: true };
}

/* Save the answer, then pass the turn to the partner. */
export function submitAnswer(g, who, text, now = Date.now()) {
  if (g.turn !== who || g.phase !== 'answer' || !g.card) return null;
  const a = String(text || '').trim().slice(0, ANSWER_MAX);
  if (!a) return null;
  const entry = { who, type: g.card.type, cat: g.card.cat, q: g.card.text, a, at: now };
  const counts = { ...g.counts, [who]: { ...g.counts[who], [g.card.type]: ((g.counts[who] || {})[g.card.type] || 0) + 1 } };
  return {
    ...g, counts,
    history: [entry, ...g.history].slice(0, HISTORY_MAX),
    turn: other(g, who), phase: 'choose', card: null, swapped: false, round: g.round + 1
  };
}

/* Clears history, counts and seen cards. The turn stays with whoever had it. */
export function resetAll(g) {
  return { ...newGame(g.players), turn: g.turn };
}
