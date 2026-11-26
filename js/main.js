/* Bootstrap: wires modules together, handles tabs, room UI, PWA, admin shortcut. */
import { CONFIG } from './config.js';
import { initFirebase } from './firebase.js';
import { state, bus } from './state.js';
import { $, $$, confirmDialog } from './utils.js';
import * as auth from './auth.js';
import * as home from './home.js';
import * as memories from './memories.js';
import * as chat from './chat.js';
import * as streak from './streak.js';
import * as games from './games.js';
import { startHearts } from './fx.js';

initFirebase(CONFIG.firebase);
const hearts = startHearts($('#fxHearts'));

/* ── tabs ── */
function setTab(tab) {
  const prev = state.tab;
  state.tab = tab;
  $$('#tabs .tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  $$('.panel').forEach(p => p.classList.toggle('is-active', p.id === 'panel-' + tab));
  $('#wrap').classList.toggle('is-chat', tab === 'messages');
  if (tab === 'home') hearts.play(); else hearts.pause();
  if (tab === 'birthdays') home.buildBirthdays();
  $('#wrap').scrollTo({ top: 0 });
  bus.emit('tab', { tab, prev });
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
bus.on('goto', ({ tab }) => setTab(tab));
$('#lockBtn').addEventListener('click', () => auth.lock());

/* ── per-room labels ── */
function applyRoomUI(room) {
  $('#brandText').textContent = room.name + '’s room ' + room.emoji;
  $('#heroEyebrow').textContent = room.welcome;
  $('#heroNames').textContent = room.name + ' & ' + room.partner;
  $('#messagesTitle').textContent = 'Chat with ' + room.partner;
  $('#msgInput').placeholder = 'Message ' + room.partner + '…';
  $('#lettersTitle').textContent = 'Letters to ' + room.partner;
  $('#lettersSub').textContent = 'Words just for ' + room.partner + '.';
  $('#composerTitle').textContent = 'Write to ' + room.partner;
  $('#letterInput').placeholder = 'Dear ' + room.partner + '…';
}

bus.on('unlock', room => {
  applyRoomUI(room);
  setTab('home');
  home.start();
  memories.start();
  chat.start();
  streak.start();
  games.start();
});
bus.on('lock', prevRoom => {
  hearts.pause();
  home.stop(); memories.stop(); chat.stop(prevRoom); streak.stop(); games.stop();
  state.tab = 'home';
});

/* ── secret admin shortcut: long-press the logo (Jay only) ── */
(function wireAdmin() {
  const brand = $('#brand');
  let t = null;
  const start = () => {
    if (!state.room || state.room.id !== 'jay') return;
    t = setTimeout(async () => {
      t = null;
      if (await confirmDialog({ title: 'Open admin panel?', body: 'You can add, reorder and delete memories there.', ok: 'Open' })) location.href = 'admin.html';
    }, 2000);
  };
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  brand.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => brand.addEventListener(ev, cancel));
})();

/* ── PWA: offline shell ── */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

auth.init();
