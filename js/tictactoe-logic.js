/* Tic-tac-toe rules. Pure functions only (no DOM, no Firebase) so they are easy to test.
   A game is a plain object that is stored as-is in Firestore doc games/tictactoe. */
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export const DEFAULT_CFG = {
  symbols: ['X', 'O', '❤️', '🌹', '⭐', '🔥', '🦋', '🐱'],
  defaults: { jay: 'X', dee: 'O' },
  firstMove: 'alternate'          // 'alternate' or a player id ('jay' / 'dee') who always starts
};
export const cfgOf = c => ({ ...DEFAULT_CFG, ...(c || {}), defaults: { ...DEFAULT_CFG.defaults, ...((c && c.defaults) || {}) } });

const otherOf = (g, who) => (g.players[0] === who ? g.players[1] : g.players[0]);
export const other = otherOf;

export function newGame(c, players = ['jay', 'dee']) {
  const cfg = cfgOf(c);
  const first = players.includes(cfg.firstMove) ? cfg.firstMove : players[0];
  const marks = {}, scores = { draws: 0 };
  players.forEach((p, i) => { marks[p] = cfg.defaults[p] || (i === 0 ? 'X' : 'O'); scores[p] = 0; });
  return { players, board: Array(9).fill(''), turn: first, starter: first, winner: null, line: null, marks, scores, round: 1 };
}

/* Fill in anything missing from stored data so old/partial docs never crash the UI. */
export function normalize(data, c, players) {
  const base = newGame(c, players);
  const g = { ...base, ...(data || {}), players: base.players };
  g.scores = { ...base.scores, ...((data && data.scores) || {}) };
  g.marks = { ...base.marks, ...((data && data.marks) || {}) };
  if (!Array.isArray(g.board) || g.board.length !== 9) g.board = Array(9).fill('');
  return g;
}

export function winnerOf(board) {
  for (const l of LINES) {
    const [a, b, c] = l;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { who: board[a], line: l };
  }
  return null;
}

export function applyMove(g, who, i) {
  if (g.winner || g.turn !== who || !(i >= 0 && i < 9) || g.board[i] !== '') return null;
  const board = g.board.slice(); board[i] = who;
  const w = winnerOf(board);
  const next = { ...g, board, scores: { ...g.scores } };
  if (w) { next.winner = w.who; next.line = w.line; next.scores[w.who] = (next.scores[w.who] || 0) + 1; }
  else if (board.every(Boolean)) { next.winner = 'draw'; next.line = null; next.scores.draws = (next.scores.draws || 0) + 1; }
  else next.turn = otherOf(g, who);
  return next;
}

/* New round. After a finished game the starter alternates (unless a fixed starter is configured).
   force=true lets you abandon an unfinished game; the starter stays the same and scores are untouched. */
export function nextRound(g, c, force = false) {
  if (!g.winner && !force) return null;
  const cfg = cfgOf(c);
  const starter = g.players.includes(cfg.firstMove) ? cfg.firstMove : (g.winner ? otherOf(g, g.starter) : g.starter);
  return { ...g, board: Array(9).fill(''), turn: starter, starter, winner: null, line: null, round: g.round + 1 };
}

export function setMark(g, who, sym, allowed) {
  if (!allowed.includes(sym) || g.marks[otherOf(g, who)] === sym || g.marks[who] === sym) return null;
  return { ...g, marks: { ...g.marks, [who]: sym } };
}

export function resetScores(g) {
  const scores = { draws: 0 };
  g.players.forEach(p => { scores[p] = 0; });
  return { ...g, scores };
}
