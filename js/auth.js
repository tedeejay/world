/* Lock screen: hashed passcodes, attempt lockout, remembered session, idle + background auto-lock. */
import { CONFIG, SESSION_KEY } from './config.js';
import { $, h, sha256Hex, store } from './utils.js';
import { state, bus } from './state.js';

const LOCKOUT_KEY = 'olw_lockout_v1';
const LEN = 6;
let entry = '', busy = false, idleTimer = null, hiddenAt = 0, lockoutTimer = null;
let lockEl, appEl, dotsEl, cardEl, msgEl, subEl;

const rooms = () => Object.values(CONFIG.rooms);

export function init() {
  lockEl = $('#lock'); appEl = $('#app'); dotsEl = $('#dots');
  cardEl = $('#lockCard'); msgEl = $('#lockMsg'); subEl = $('#lockSub');
  $('#lockBg').style.backgroundImage = "url('" + CONFIG.lockBg + "')";
  buildKeypad();
  document.addEventListener('keydown', e => {
    if (state.room || busy || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); back(); }
    else if (e.key === 'Escape') { entry = ''; paint(); }
  });
  wireIdle();
  syncLockout();
  restoreSession();
}

function buildKeypad() {
  const pad = $('#keypad');
  pad.replaceChildren();
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(k => {
    const btn = h('button', { type: 'button', class: 'key' + (k === '' ? ' blank' : '') + (k === '⌫' ? ' del' : ''), 'aria-label': k === '⌫' ? 'Delete' : k || null, tabindex: k === '' ? '-1' : null }, k);
    if (k) btn.addEventListener('click', () => (k === '⌫' ? back() : press(k)));
    pad.append(btn);
  });
}

const paint = () => Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('on', i < entry.length));
const say = t => { msgEl.textContent = t || ''; };

/* ── lockout ── */
function lockoutLeft() { return Math.max(0, (store.get(LOCKOUT_KEY, { until: 0 }).until || 0) - Date.now()); }
function registerFail() {
  const l = store.get(LOCKOUT_KEY, { fails: 0, until: 0 });
  l.fails = (l.fails || 0) + 1;
  if (l.fails % CONFIG.maxAttempts === 0) {
    const mult = Math.min(8, Math.pow(2, l.fails / CONFIG.maxAttempts - 1));
    l.until = Date.now() + CONFIG.lockoutMs * mult;
  }
  store.set(LOCKOUT_KEY, l);
}
function syncLockout() {
  clearInterval(lockoutTimer);
  const tick = () => {
    const left = lockoutLeft();
    if (left > 0) say('Too many tries. Wait ' + Math.ceil(left / 1000) + 's.');
    else { say(''); clearInterval(lockoutTimer); }
  };
  if (lockoutLeft() > 0) { tick(); lockoutTimer = setInterval(tick, 500); }
}

/* ── input ── */
function press(d) {
  if (busy || lockoutLeft() > 0 || entry.length >= LEN) return;
  if (navigator.vibrate) navigator.vibrate(8);
  entry += d; paint(); say('');
  if (entry.length === LEN) verify();
}
function back() { if (busy) return; entry = entry.slice(0, -1); paint(); }

async function verify() {
  busy = true;
  let room = null;
  try {
    room = CONFIG.rooms[await sha256Hex(CONFIG.passSalt + entry)] || null;
  } catch {
    say('Something went wrong. Please try again.');
    entry = ''; paint(); busy = false; return;
  }
  if (room) {
    store.del(LOCKOUT_KEY);
    dotsEl.classList.add('is-ok');
    setTimeout(() => { openApp(room, true); dotsEl.classList.remove('is-ok'); entry = ''; paint(); busy = false; }, 220);
  } else {
    cardEl.classList.add('shake');
    if (navigator.vibrate) navigator.vibrate(180);
    registerFail();
    setTimeout(() => { cardEl.classList.remove('shake'); entry = ''; paint(); busy = false; syncLockout(); if (!lockoutLeft()) say('That code isn’t right.'); }, 430);
  }
}

/* ── session ── */
function openApp(room, fresh) {
  state.room = room;
  if (fresh) store.set(SESSION_KEY, { id: room.id, at: Date.now() });
  lockEl.classList.add('gone'); lockEl.inert = true;
  appEl.hidden = false;
  bus.emit('unlock', room);
  armIdle();
}
function restoreSession() {
  const s = store.get(SESSION_KEY);
  if (!s || Date.now() - (s.at || 0) > CONFIG.sessionTtlMs) { store.del(SESSION_KEY); return; }
  const room = rooms().find(r => r.id === s.id);
  if (room) openApp(room, false);
}
export function lock() {
  clearTimeout(idleTimer);
  if (!state.room && lockEl.classList.contains('gone') === false) return;
  const prev = state.room;
  state.room = null;
  store.del(SESSION_KEY);
  bus.emit('lock', prev);
  appEl.hidden = true;
  lockEl.inert = false; lockEl.classList.remove('gone');
  entry = ''; paint(); say('');
}

/* ── idle / background auto-lock ── */
function armIdle() {
  clearTimeout(idleTimer);
  if (!state.room) return;
  idleTimer = setTimeout(() => (state.recording ? armIdle() : lock()), CONFIG.idleLockMs);
}
function wireIdle() {
  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, () => { if (state.room) armIdle(); }, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (state.room && hiddenAt && Date.now() - hiddenAt > CONFIG.backgroundLockMs && !state.recording) lock();
    else armIdle();
  });
}
