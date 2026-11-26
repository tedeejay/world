/* Chat streak: derived from the messages already loaded, so there is nothing extra to store or sync.
   A day counts when a message, voice note or letter was sent that day (by either of you,
   or by both if CONFIG.streakNeedsBoth is true). Deleting messages can lower the streak. */
import { CONFIG } from './config.js';
import { $, h, dateKey, parseISODate, daysBetween, store, toast } from './utils.js';
import { bus } from './state.js';
import { confetti } from './fx.js';

const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000];
let msgs = [], clock = null, wired = false;

export function compute(list, now = new Date(), needBoth = false) {
  const days = new Map();
  list.forEach(m => {
    if (!m.ts) return;
    const k = dateKey(m.ts);
    if (!days.has(k)) days.set(k, new Set());
    days.get(k).add(m.from);
  });
  const active = k => { const s = days.get(k); return !!s && (needBoth ? s.size >= 2 : s.size >= 1); };
  const keyOf = (d, back) => dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime());

  const todayDone = active(keyOf(now, 0));
  let count = 0, back = todayDone ? 0 : 1;
  while (active(keyOf(now, back))) { count++; back++; }

  const keys = [...days.keys()].filter(active).sort();
  let best = 0, run = 0, prev = null;
  keys.forEach(k => {
    const d = parseISODate(k);
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    prev = d; best = Math.max(best, run);
  });

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    week.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), on: active(dateKey(d.getTime())), today: i === 0 });
  }
  return { count, best: Math.max(best, count), todayDone, week };
}

function left(now) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  return Math.floor(end / 36e5) + 'h ' + Math.floor(end / 6e4) % 60 + 'm left today';
}

function paint() {
  const now = new Date();
  const s = compute(msgs, now, !!CONFIG.streakNeedsBoth);
  const set = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
  set('streakCount', String(s.count));
  set('streakLabel', s.count === 1 ? 'day in a row' : 'days in a row');
  set('streakBest', 'Best: ' + s.best + (s.best === 1 ? ' day' : ' days'));
  set('streakSub', s.count === 0
    ? 'Send a message or letter to start your streak'
    : s.todayDone ? 'Kept for today. See you tomorrow 💞' : 'Send something today to keep it going');
  set('streakLeft', s.todayDone || s.count === 0 ? '' : left(now));
  const card = $('#streakCard');
  if (card) { card.classList.toggle('is-lit', s.count > 0 && s.todayDone); card.classList.toggle('is-risk', s.count > 0 && !s.todayDone); }
  const wk = $('#streakWeek');
  if (wk) wk.replaceChildren(...s.week.map(d =>
    h('div', { class: 'sd' + (d.on ? ' on' : '') + (d.today ? ' today' : '') }, h('i', null, d.on ? '🔥' : ''), h('span', null, d.label))));

  if (s.todayDone && STREAK_MILESTONES.includes(s.count) && !document.hidden) {
    const key = 'olw_streak_celebrated_' + s.count;
    if (!store.get(key)) { store.set(key, 1); confetti(); toast('🔥 ' + s.count + '-day streak!', 'success'); }
  }
}

export function start() {
  if (!wired) { wired = true; bus.on('messages', list => { msgs = list || []; paint(); }); }
  paint();
  clearInterval(clock);
  clock = setInterval(paint, 30000);   // keeps the countdown and midnight rollover fresh
}
export function stop() {
  clearInterval(clock); clock = null; msgs = [];
}
