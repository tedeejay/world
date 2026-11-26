/* Two Truths and a Lie rules. Pure functions only (no DOM, no Firebase) so they are easy to test.
   A game is a plain object stored as-is in Firestore doc games/twotruths.

   Flow:  phase 'write'  - the writer enters two truths and one lie; on send the three lines are shuffled
          phase 'guess'  - the other player taps the line they think is the lie
          phase 'result' - the pick is scored (green = the lie, red = a wrong pick); "next round" swaps roles */
export const MAX_LEN = 140;
export const HISTORY_MAX = 20;

export const other = (g, who) => (g.players[0] === who ? g.players[1] : g.players[0]);
export const guesserOf = g => other(g, g.writer);
export const clean = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, MAX_LEN);

export function newGame(players = ['jay', 'dee']) {
  const scores = {};
  players.forEach(p => { scores[p] = 0; });
  return { players, writer: players[0], phase: 'write', items: [], lie: -1, pick: -1, scores, round: 1, history: [] };
}

/* Fill in anything missing from stored data so old/partial docs never crash the UI. */
export function normalize(data, players = ['jay', 'dee']) {
  const base = newGame(players);
  const g = { ...base, ...(data || {}), players: base.players };
  g.scores = { ...base.scores, ...((data && data.scores) || {}) };
  if (!players.includes(g.writer)) g.writer = base.writer;
  if (!Array.isArray(g.history)) g.history = [];
  const okItems = Array.isArray(g.items) && g.items.length === 3 && g.items.every(Boolean);
  if (g.phase !== 'write' && (!okItems || !(g.lie >= 0 && g.lie < 3))) { g.phase = 'write'; g.items = []; g.lie = -1; g.pick = -1; }
  if (g.phase === 'result' && !(g.pick >= 0 && g.pick < 3)) { g.phase = 'guess'; g.pick = -1; }
  return g;
}

/* Returns an error message, or '' when the three lines are fine. */
export function validate(truths, lie) {
  const all = [truths[0], truths[1], lie].map(clean);
  if (all.some(s => !s)) return 'Fill in all three lines';
  if (new Set(all.map(s => s.toLowerCase())).size !== 3) return 'Each line has to be different';
  return '';
}

/* Fisher-Yates over positions, so we know where the lie ended up. */
export function submitStatements(g, who, truths, lie, rnd = Math.random) {
  if (g.writer !== who || g.phase !== 'write' || validate(truths, lie)) return null;
  const src = [clean(truths[0]), clean(truths[1]), clean(lie)];     /* index 2 is the lie */
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { ...g, phase: 'guess', items: order.map(i => src[i]), lie: order.indexOf(2), pick: -1 };
}

/* Guesser taps a line. Right pick: guesser scores. Wrong pick: the writer scores. */
export function guess(g, who, i, now = Date.now()) {
  if (g.phase !== 'guess' || who !== guesserOf(g) || !(i >= 0 && i < 3)) return null;
  const correct = i === g.lie;
  const winner = correct ? who : g.writer;
  const entry = { writer: g.writer, items: g.items, lie: g.lie, pick: i, correct, at: now };
  return {
    ...g, phase: 'result', pick: i,
    scores: { ...g.scores, [winner]: (g.scores[winner] || 0) + 1 },
    history: [entry, ...g.history].slice(0, HISTORY_MAX)
  };
}

/* Roles swap: whoever just guessed writes next. */
export function nextRound(g) {
  if (g.phase !== 'result') return null;
  return { ...g, writer: guesserOf(g), phase: 'write', items: [], lie: -1, pick: -1, round: g.round + 1 };
}

/* Clears scores and history; the writer stays whoever it was. */
export function resetAll(g) {
  return { ...newGame(g.players), writer: g.writer };
}
