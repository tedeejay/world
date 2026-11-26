/* Chat streak with TikTok-style restores.
   - A day counts when a message, voice note or letter was sent (by either of you, or both if
     CONFIG.streakNeedsBoth). Deleted messages still count: sent is sent.
   - Miss a day (or a few) and you can restore: the missed days become "bridge" days that keep the
     chain connected WITHOUT adding to the count, so the old number comes back. Each of you has
     CONFIG.streakRestores restores in total; whoever taps spends their own.
   - Restore state lives in Firestore doc streak/restores (localStorage in demo mode). */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { $, h, dateKey, parseISODate, daysBetween, store, toast, confirmDialog } from './utils.js';
import { bus, state } from './state.js';
import { confetti } from './fx.js';

const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000];
const LOCAL_KEY = 'olw_streak_restores_v1';
const maxRestores = () => CONFIG.streakRestores ?? 5;
const opts = () => ({
  needBoth: !!CONFIG.streakNeedsBoth,
  maxGap: CONFIG.restoreMaxGapDays ?? 2,      // longest break (in days) that can be restored
  minStreak: CONFIG.restoreMinStreak ?? 3,    // streak must have been at least this long
  window: CONFIG.restoreWindowDays ?? 2       // how recently the break must have happened
});

let msgs = [], rs = { used: {}, bridged: [] }, cur = null, clock = null, wired = false, unsub = null, busy = false;

export function compute(list, now = new Date(), o = {}, bridgedArr = []) {
  const { needBoth = false, maxGap = 2, minStreak = 3, window: win = 2 } = o;
  const days = new Map();
  list.forEach(m => {
    if (!m.ts) return;
    const k = dateKey(m.ts);
    if (!days.has(k)) days.set(k, new Set());
    days.get(k).add(m.from);
  });
  const bridged = new Set(bridgedArr);
  const real = k => { const s = days.get(k); return !!s && (needBoth ? s.size >= 2 : s.size >= 1); };
  const conn = k => real(k) || bridged.has(k);
  const keyOf = (d, back) => dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime());

  const todayDone = real(keyOf(now, 0));
  const todayFrom = [...(days.get(keyOf(now, 0)) || [])];

  /* current streak: walk back; bridge days keep the chain but add nothing */
  let back = conn(keyOf(now, 0)) ? 0 : 1, count = 0;
  while (conn(keyOf(now, back))) { if (real(keyOf(now, back))) count++; back++; }

  /* is there a recent, restorable break right before the current run? */
  let restorable = null;
  const known = [...days.keys()].filter(real).concat([...bridged]).sort();
  const minKey = known[0];
  if (minKey && back <= win) {
    const gap = [];
    let b = back;
    while (gap.length <= maxGap && keyOf(now, b) >= minKey && !conn(keyOf(now, b))) { gap.push(keyOf(now, b)); b++; }
    if (gap.length >= 1 && gap.length <= maxGap && conn(keyOf(now, b))) {
      let prev = 0;
      while (conn(keyOf(now, b))) { if (real(keyOf(now, b))) prev++; b++; }
      if (prev >= minStreak) restorable = { keys: gap.reverse(), prev, total: count + prev };
    }
  }

  /* best ever (real days only; bridge days keep runs connected) */
  let best = 0, run = 0, prevD = null;
  known.filter((k, i) => known.indexOf(k) === i).forEach(k => {
    const d = parseISODate(k);
    run = (prevD && daysBetween(prevD, d) === 1 ? run : 0) + (real(k) ? 1 : 0);
    prevD = d; best = Math.max(best, run);
  });

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dateKey(d.getTime());
    week.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), on: real(k), fixed: !real(k) && bridged.has(k), today: i === 0 });
  }
  return { count, best: Math.max(best, count), todayDone, todayFrom, week, restorable };
}

function timeLeft(now) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  return Math.floor(end / 36e5) + 'h ' + Math.floor(end / 6e4) % 60 + 'm left today';
}

function pendingText(s, room) {
  if (!opts().needBoth || !room) return 'Send something today to keep it going';
  const meSent = s.todayFrom.includes(room.id), theySent = s.todayFrom.includes(room.partner.toLowerCase());
  if (meSent && !theySent) return 'You’ve texted today. Waiting for ' + room.partner + ' 💞';
  if (!meSent && theySent) return room.partner + ' texted today. Your turn! 💞';
  return 'You both need to text today to keep it going';
}

function paint() {
  const room = state.room;
  const now = new Date();
  const s = cur = compute(msgs, now, opts(), rs.bridged);
  const set = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };
  const max = maxRestores();
  const myLeft = room ? max - (rs.used[room.id] || 0) : max;

  set('streakCount', String(s.count));
  set('streakLabel', s.count === 1 ? 'day in a row' : 'days in a row');
  set('streakBest', 'Best: ' + s.best + (s.best === 1 ? ' day' : ' days'));
  set('streakSub', s.restorable && s.count === 0
    ? 'Your ' + s.restorable.prev + '-day streak ended. You can bring it back'
    : s.count === 0 ? 'Send a message or letter to start your streak'
    : s.todayDone ? 'Kept for today. See you tomorrow 💞' : pendingText(s, room));
  set('streakLeft', s.todayDone || s.count === 0 ? '' : timeLeft(now));

  if (room) {
    const pid = room.partner.toLowerCase();
    set('streakRestoreInfo', 'Restores left · You: ' + myLeft + '/' + max + ' · ' + room.partner + ': ' + (max - (rs.used[pid] || 0)) + '/' + max);
  }
  const btn = $('#streakRestore');
  if (btn) {
    btn.hidden = !s.restorable;
    btn.disabled = busy || myLeft <= 0;
    btn.textContent = myLeft <= 0 ? 'No restores left' : '♻️ Restore streak' + (s.restorable ? ' (back to ' + s.restorable.total + ')' : '');
  }

  const card = $('#streakCard');
  if (card) {
    card.classList.toggle('is-lit', s.count > 0 && s.todayDone);
    card.classList.toggle('is-risk', (s.count > 0 && !s.todayDone) || !!s.restorable);
  }
  const wk = $('#streakWeek');
  if (wk) wk.replaceChildren(...s.week.map(d =>
    h('div', { class: 'sd' + (d.on ? ' on' : '') + (d.fixed ? ' fixed' : '') + (d.today ? ' today' : '') }, h('i', null, d.on ? '🔥' : d.fixed ? '♻️' : ''), h('span', null, d.label))));

  if (s.todayDone && STREAK_MILESTONES.includes(s.count) && !document.hidden) {
    const key = 'olw_streak_celebrated_' + s.count;
    if (!store.get(key)) { store.set(key, 1); confetti(); toast('🔥 ' + s.count + '-day streak!', 'success'); }
  }
}

/* ── restore storage ── */
async function applyRestore(id, keys) {
  const max = maxRestores();
  if (!fb.ready) {
    const d = store.get(LOCAL_KEY, { used: {}, bridged: [] });
    const mine = (d.used || {})[id] || 0;
    if (mine >= max) throw new Error('none-left');
    d.used = { ...(d.used || {}), [id]: mine + 1 };
    d.bridged = [...new Set([...(d.bridged || []), ...keys])];
    store.set(LOCAL_KEY, d); rs = d; return;
  }
  const ref = fb.db.collection('streak').doc('restores');
  await fb.db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const used = d.used || {};
    const mine = used[id] || 0;
    if (mine >= max) throw new Error('none-left');
    const bridged = new Set(d.bridged || []);
    keys.forEach(k => bridged.add(k));
    tx.set(ref, { used: { ...used, [id]: mine + 1 }, bridged: [...bridged], log: [...(d.log || []), { by: id, at: Date.now(), days: keys }] });
  });
}

async function restoreNow() {
  const room = state.room, r = cur && cur.restorable;
  if (!room || !r || busy) return;
  const left = maxRestores() - (rs.used[room.id] || 0);
  if (left <= 0) { toast('You’ve used all ' + maxRestores() + ' of your restores', 'error'); return; }
  const n = r.keys.length;
  const ok = await confirmDialog({
    title: 'Restore your streak?',
    body: 'This uses 1 of your ' + left + ' remaining restore' + (left === 1 ? '' : 's') + '. The ' + n + ' missed day' + (n === 1 ? '' : 's') + ' will be covered and your streak goes back to ' + r.total + ' days.',
    ok: 'Restore'
  });
  if (!ok) return;
  busy = true; paint();
  try {
    await applyRestore(room.id, r.keys);
    confetti(); toast('Streak restored 🔥', 'success');
  } catch (e) {
    toast(e.message === 'none-left' ? 'No restores left' : 'Could not restore. Check your connection.', 'error');
  }
  busy = false; paint();
}

function listenRestores() {
  if (!fb.ready) { rs = store.get(LOCAL_KEY, { used: {}, bridged: [] }); return; }
  unsub = fb.db.collection('streak').doc('restores').onSnapshot(doc => {
    const d = doc.exists ? doc.data() : {};
    rs = { used: d.used || {}, bridged: d.bridged || [] };
    paint();
  }, err => console.warn('[OLW] streak restores unavailable', err && err.code));
}

export function start() {
  if (!wired) {
    wired = true;
    bus.on('messages', list => { msgs = list || []; paint(); });
    const btn = $('#streakRestore');
    if (btn) btn.addEventListener('click', restoreNow);
  }
  listenRestores();
  paint();
  clearInterval(clock);
  clock = setInterval(paint, 30000);
}
export function stop() {
  clearInterval(clock); clock = null;
  if (unsub) unsub(); unsub = null;
  msgs = []; rs = { used: {}, bridged: [] }; cur = null;
}
