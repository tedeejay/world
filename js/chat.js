/* Chat + letters: realtime sync, keyed rendering (audio never restarts), reactions,
   edit/delete, read receipts, typing + presence, voice notes, unread dividers, alerts. */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { state, bus } from './state.js';
import {
  $, $$, h, store, fmtTime, fmtDateSep, fmtLetterTime, dateKey, linkify, relativeTime,
  fmtDuration, truncate, toast, showBanner, hideBanner, confirmDialog, autoGrow, throttle
} from './utils.js';
import { createRecorder } from './recorder.js';
import * as notify from './notify.js';
import { popHeart } from './fx.js';

const EMOJI = ['❤️', '😍', '🥰', '😘', '😂', '🥺', '😭', '😊', '🤗', '😴', '🔥', '✨', '🎉', '🌹', '💋', '💞', '🙈', '😏', '👀', '🫶'];
const HEART = '❤️';
const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

let messages = [];
let allMsgs = [];   // includes soft-deleted ones (streak counts them; admin can purge them)
let unsubs = [];
let timers = [];
let caches = {};
let editingId = null;
let firstSnap = true;
let dividers = { msg: null, letter: null };
let partner = { lastReadMsg: 0, lastReadLetter: 0, online: false, lastSeen: 0, typingAt: 0 };
let renderState = { count: 0, first: true };
let pendingNew = 0;
let lastWritten = { msg: 0, letter: 0 };
let recorder = null;
let wired = false;

const me = () => state.room;
const isMsg = m => m.type !== 'letter';
const isLetter = m => m.type === 'letter';
const isOwn = m => !!me() && (m.from === 'me' || (m.from !== 'them' && m.from === me().id));
const senderName = m => (!me() ? m.from : isOwn(m) ? me().name : me().partner);
const partnerId = () => me().partner.toLowerCase();

/* ───────── local read state (per room) ───────── */
const readKey = () => 'olw_lastRead_' + me().id;
function getRead() { const r = store.get(readKey(), {}) || {}; return { msg: r.msg || 0, letter: r.letter || 0 }; }
function setRead(kind, ts) { const r = getRead(); if (ts <= r[kind]) return; r[kind] = ts; store.set(readKey(), r); }

/* ───────── presence ───────── */
function writePresence(patch) {
  if (!fb.ready || !me()) return;
  fb.db.collection('presence').doc(me().id).set(patch, { merge: true }).catch(() => {});
}
const beat = () => writePresence({ online: !document.hidden, lastSeen: Date.now() });
const sendTyping = throttle(() => writePresence({ typingAt: Date.now() }), 3000);

function listenPresence() {
  if (!fb.ready) return;
  unsubs.push(fb.db.collection('presence').doc(partnerId()).onSnapshot(doc => {
    if (!doc.exists) return;
    const d = doc.data();
    partner = {
      lastReadMsg: d.lastReadMsg || d.lastRead || 0,
      lastReadLetter: d.lastReadLetter || d.lastRead || 0,
      online: !!d.online, lastSeen: d.lastSeen || 0, typingAt: d.typingAt || 0
    };
    paintSeen(); paintStatus();
  }, () => {}));
}
function paintStatus() {
  const el = $('#chatStatus');
  if (!el || !me()) return;
  const now = Date.now();
  let text = '', cls = 'chat-status';
  if (partner.typingAt && now - partner.typingAt < 5000) { text = 'typing…'; cls += ' is-typing'; }
  else if (partner.online && now - partner.lastSeen < 75000) { text = '● Active now'; cls += ' is-online'; }
  else if (partner.lastSeen) text = 'Last seen ' + relativeTime(partner.lastSeen);
  el.className = cls; el.textContent = text;
}
function paintSeen() {
  const byId = new Map(messages.map(m => [m.id, m]));
  $$('[data-seen-id]').forEach(n => {
    const m = byId.get(n.dataset.seenId);
    if (!m) return;
    const seen = m.ts <= (isLetter(m) ? partner.lastReadLetter : partner.lastReadMsg);
    n.textContent = seen ? '✓✓ Seen' : '✓ Sent';
    n.classList.toggle('is-seen', seen);
  });
}

/* ───────── unread / badges ───────── */
function unreadCount(filter, since) { return messages.filter(m => filter(m) && !isOwn(m) && m.ts > since).length; }
function latestUnread(filter, since) {
  return messages.filter(m => filter(m) && !isOwn(m) && m.ts > since).sort((a, b) => b.ts - a.ts)[0] || null;
}
function setBadge(id, n) { const el = $('#' + id); if (!el) return; el.textContent = n; el.classList.toggle('show', n > 0); }

function markRead(kind) {
  if (!me() || document.hidden) return;
  const newest = messages.filter(kind === 'letter' ? isLetter : isMsg).reduce((a, m) => Math.max(a, m.ts), 0);
  if (newest) {
    setRead(kind, newest);
    if (newest > lastWritten[kind]) {
      lastWritten[kind] = newest;
      writePresence(kind === 'letter' ? { lastReadLetter: newest } : { lastReadMsg: newest });
    }
  }
  updateNotification();
}
function markActiveRead() {
  if (state.tab === 'messages') markRead('msg');
  else if (state.tab === 'letters') markRead('letter');
  else updateNotification();
}

function updateNotification() {
  if (!me()) return;
  const r = getRead();
  const here = !document.hidden;
  let um = unreadCount(isMsg, r.msg), ul = unreadCount(isLetter, r.letter);
  if (here && state.tab === 'messages') um = 0;
  if (here && state.tab === 'letters') ul = 0;
  setBadge('msgBadge', um); setBadge('tabBadge', ul);
  notify.setUnread(um + ul);

  const card = $('#letterNotif');
  if (!card) return;
  const total = um + ul;
  if (!total) { card.classList.remove('show'); return; }
  const lm = um ? latestUnread(isMsg, r.msg) : null;
  const ll = ul ? latestUnread(isLetter, r.letter) : null;
  const latest = !lm ? ll : !ll ? lm : (lm.ts > ll.ts ? lm : ll);
  const who = latest ? senderName(latest) : me().partner;
  $('#notifTitle').textContent = um && ul ? total + ' new from ' + who
    : ul ? (ul === 1 ? 'New letter' : ul + ' new letters') + ' from ' + who
    : (um === 1 ? 'New message' : um + ' new messages') + ' from ' + who;
  $('#notifSub').textContent = 'Tap to read';
  card.dataset.target = latest && isLetter(latest) ? 'letters' : 'messages';
  card.classList.add('show');
}

/* ───────── keyed rendering ───────── */
function reconcile(container, entries) {
  const prev = caches[container.id] || new Map();
  const next = new Map();
  const nodes = entries.map(e => {
    let c = prev.get(e.key);
    if (!c || c.sig !== e.sig) c = { sig: e.sig, node: e.build() };
    next.set(e.key, c);
    return c.node;
  });
  caches[container.id] = next;
  const wanted = new Set(nodes);
  Array.from(container.children).forEach(ch => { if (!wanted.has(ch)) ch.remove(); });
  nodes.forEach((node, i) => { if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null); });
}
const nearBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 120;
const scrollBottom = (el, smooth = false) => { if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };

function sigOf(m) {
  return [m.type, m.type === 'voice' ? m.id : m.text, m.edited ? 1 : 0, JSON.stringify(m.reactions), editingId === m.id ? 'E' : '', isOwn(m) ? 1 : 0, m.ts].join('|');
}

function renderAll() { renderChat(); renderLetters(); bus.emit('messages', allMsgs.length ? allMsgs : messages); }

function renderChat() {
  const tl = $('#msgTimeline');
  if (!tl || !me()) return;
  const list = messages.filter(isMsg);
  $('#msgCount').textContent = list.length;
  const stick = renderState.first || nearBottom(tl);
  const entries = [];
  if (!list.length) entries.push({ key: 'empty', sig: 'e', build: () => h('div', { class: 'empty' }, 'No messages yet. Say hi 👋') });
  let lastDay = null, placed = false;
  list.forEach(m => {
    const dk = dateKey(m.ts);
    if (dk !== lastDay) {
      const label = fmtDateSep(m.ts);
      entries.push({ key: 'sep-' + dk, sig: label, build: () => h('div', { class: 'date-sep' }, label) });
      lastDay = dk;
    }
    if (dividers.msg != null && !placed && !isOwn(m) && m.ts > dividers.msg) {
      entries.push({ key: 'divider', sig: 'd', build: () => h('div', { class: 'unread-divider' }, 'New messages') });
      placed = true;
    }
    entries.push({ key: m.id, sig: sigOf(m), build: () => (editingId === m.id ? buildEditForm(m, false) : buildBubble(m)) });
  });
  reconcile(tl, entries);
  paintSeen();

  const added = list.length - renderState.count;
  const lastOwn = list.length && isOwn(list[list.length - 1]);
  renderState.count = list.length;
  if (stick || (added > 0 && lastOwn)) { scrollBottom(tl, !renderState.first); renderState.first = false; pendingNew = 0; $('#jumpBtn').hidden = true; }
  else if (added > 0) { pendingNew += added; $('#jumpCount').textContent = pendingNew + ' new'; $('#jumpBtn').hidden = false; }
}

function renderLetters() {
  const tl = $('#timeline');
  if (!tl || !me()) return;
  const list = messages.filter(isLetter).slice().reverse(); // newest first
  $('#lettersCount').textContent = list.length;
  const entries = list.length
    ? list.map(m => {
        const isNew = !isOwn(m) && dividers.letter != null && m.ts > dividers.letter;
        return { key: m.id, sig: sigOf(m) + '|' + (isNew ? 'N' : ''), build: () => (editingId === m.id ? buildEditForm(m, true) : buildLetter(m, isNew)) };
      })
    : [{ key: 'empty', sig: 'e', build: () => h('div', { class: 'empty' }, 'No letters yet. Write the first one ✍️') }];
  reconcile(tl, entries);
  paintSeen();
}

/* ───────── message builders ───────── */
function reactChips(m) {
  const entries = Object.entries(m.reactions || {}).filter(([, v]) => v);
  if (!entries.length) return null;
  return h('div', { class: 'reacts' }, entries.map(([who, emoji]) =>
    h('span', { class: 'react' + (who === me().id ? ' mine' : ''), title: who === me().id ? 'You' : me().partner }, emoji)));
}

function buildActions(m, own) {
  const wrap = h('div', { class: 'msg-actions bubble__actions' });
  if (own) {
    if (m.type !== 'voice') wrap.append(h('button', { type: 'button', class: 'msg-action', title: 'Edit', 'aria-label': 'Edit', onclick: e => { e.stopPropagation(); beginEdit(m); } }, '✎'));
    wrap.append(h('button', { type: 'button', class: 'msg-action danger', title: 'Delete', 'aria-label': 'Delete', onclick: e => { e.stopPropagation(); deleteMessage(m); } }, '🗑'));
  } else {
    const on = !!(m.reactions && m.reactions[me().id]);
    wrap.append(h('button', { type: 'button', class: 'msg-action' + (on ? ' is-on' : ''), title: 'React', 'aria-label': 'React with a heart', onclick: e => { e.stopPropagation(); toggleReact(m, e); } }, on ? '❤️' : '🤍'));
  }
  return wrap;
}

function buildBubble(m) {
  const own = isOwn(m);
  const reacts = reactChips(m);
  const body = m.type === 'voice'
    ? h('audio', { class: 'audio-player', controls: true, preload: 'metadata', src: m.text })
    : h('div', { class: 'bubble__text' }, linkify(m.text));
  const el = h('div', { class: 'bubble ' + (own ? 'me' : 'them') + (reacts ? ' has-reacts' : ''), dataset: { id: m.id } },
    buildActions(m, own),
    body,
    h('div', { class: 'bubble__foot' },
      h('span', null, fmtTime(m.ts)),
      m.edited ? h('span', null, 'edited') : null,
      own ? h('span', { class: 'seen', dataset: { seenId: m.id } }, '✓ Sent') : null),
    reacts);
  el.addEventListener('click', e => {
    if (e.target.closest('a,audio,button')) return;
    const on = el.classList.contains('show-actions');
    $$('.bubble.show-actions').forEach(b => b.classList.remove('show-actions'));
    if (!on) el.classList.add('show-actions');
  });
  if (!own) el.addEventListener('dblclick', e => toggleReact(m, e));
  return el;
}

function buildLetter(m, isNew) {
  const own = isOwn(m);
  const actions = h('div', { class: 'msg-actions' },
    h('button', { type: 'button', class: 'msg-action', title: 'Edit', 'aria-label': 'Edit letter', onclick: () => beginEdit(m) }, '✎'),
    h('button', { type: 'button', class: 'msg-action danger', title: 'Delete', 'aria-label': 'Delete letter', onclick: () => deleteMessage(m) }, '🗑'));
  return h('article', { class: 'letter-card' + (isNew ? ' is-new' : '') },
    isNew ? h('span', { class: 'new-ribbon' }, 'NEW') : null,
    h('div', { class: 'letter-card-head' },
      h('div', { class: 'letter-card-icon' }, '💌'),
      h('div', { class: 'letter-card-meta' },
        h('div', { class: 'letter-card-sender' }, senderName(m)),
        h('div', { class: 'letter-card-time' }, fmtLetterTime(m.ts) + (m.edited ? ' · edited' : ''))),
      own ? actions : h('div', { class: 'letter-card-seal' }, '❤')),
    h('div', { class: 'letter-card-body' }, linkify(m.text)),
    h('div', { class: 'letter-card-foot' },
      own ? h('span', { class: 'seen', dataset: { seenId: m.id } }, '✓ Sent') : null,
      h('span', { class: 'letter-card-sig' }, '— ' + senderName(m))));
}

function buildEditForm(m, light) {
  const ta = h('textarea', { class: 'edit-textarea', maxlength: '8000', 'aria-label': 'Edit text' });
  ta.value = m.text;
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(m, ta.value); }
  });
  const wrap = h('div', { class: 'edit-wrap' + (light ? ' on-light' : '') },
    ta,
    h('div', { class: 'edit-actions' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: cancelEdit }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn--primary btn--sm', onclick: () => saveEdit(m, ta.value) }, '✓ Save')),
    h('div', { class: 'edit-hint' }, 'Ctrl/⌘ + Enter to save · Esc to cancel'));
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
  return wrap;
}

/* ───────── actions: edit / delete / react / send ───────── */
function handleError(err, action) {
  console.error('[OLW]', action, 'failed', err);
  if (err && err.code === 'permission-denied') {
    toast('Not allowed — check your Firestore rules', 'error');
    showBanner('Firestore rules are blocking “' + action + '”.', 'Publish the rules from firestore.rules in the Firebase console, then try again.');
  } else toast('Could not ' + action + '. Check your connection.', 'error');
}
function beginEdit(m) { if (!isOwn(m)) return; editingId = m.id; renderAll(); }
function cancelEdit() { editingId = null; renderAll(); }

function saveEdit(m, raw) {
  const text = raw.trim();
  if (!text || text === m.text) return cancelEdit();
  if (!fb.ready) {
    Object.assign(messages.find(x => x.id === m.id) || {}, { text, edited: true });
    editingId = null; renderAll(); toast('Updated ✔', 'success'); return;
  }
  fb.db.collection('messages').doc(m.id).update({ text, edited: true })
    .then(() => { editingId = null; renderAll(); toast('Changes saved ✔', 'success'); })
    .catch(err => handleError(err, 'save changes'));
}

async function deleteMessage(m) {
  const preview = m.type === 'voice' ? '🎤 Voice note' : truncate(m.text || 'Message', 80);
  const ok = await confirmDialog({ title: 'Delete this ' + (isLetter(m) ? 'letter' : 'message') + '?', body: '“' + preview + '”\n\nIt will be removed from the chat.', ok: 'Delete', danger: true });
  if (!ok) return;
  if (!fb.ready) { messages = messages.filter(x => x.id !== m.id); renderAll(); updateNotification(); toast('Deleted ✔', 'success'); return; }
  fb.db.collection('messages').doc(m.id).update({ deleted: true, deletedAt: fb.serverTs(), deletedBy: me().id }).then(() => toast('Deleted ✔', 'success')).catch(err => handleError(err, 'delete'));
}

function toggleReact(m, evt) {
  const mine = !!(m.reactions && m.reactions[me().id]);
  if (!mine && evt && evt.clientX != null) popHeart(evt.clientX, evt.clientY);
  if (!fb.ready) {
    const t = messages.find(x => x.id === m.id);
    if (t) { t.reactions = { ...t.reactions }; if (mine) delete t.reactions[me().id]; else t.reactions[me().id] = HEART; renderAll(); }
    return;
  }
  fb.db.collection('messages').doc(m.id).update({ ['reactions.' + me().id]: mine ? fb.deleteField() : HEART }).catch(err => handleError(err, 'react'));
}

function send(type, text) {
  if (!me() || !text) return false;
  if (!fb.ready) {
    messages.push({ id: 'local-' + Date.now(), from: me().id, type, ts: Date.now(), text, edited: false, reactions: {} });
    renderAll(); updateNotification(); return true;
  }
  fb.db.collection('messages').add({ from: me().id, type, text, ts: fb.serverTs() })
    .then(() => markActiveRead())
    .catch(err => { handleError(err, 'send'); const i = $(type === 'letter' ? '#letterInput' : '#msgInput'); if (i && !i.value && type !== 'voice') { i.value = text; autoGrow(i); } });
  return true;
}

/* ───────── realtime ───────── */
const fromDoc = doc => {
  const d = doc.data({ serverTimestamps: 'estimate' });
  return { id: doc.id, from: d.from || 'them', type: d.type || 'chat', ts: d.ts ? d.ts.toMillis() : Date.now(), text: d.text || '', edited: !!d.edited, reactions: d.reactions || {}, deleted: !!d.deleted };
};

function incoming(m) {
  const who = senderName(m);
  const letter = isLetter(m);
  const preview = m.type === 'voice' ? '🎤 Voice note' : truncate(m.text, 80);
  const viewing = !document.hidden && state.tab === (letter ? 'letters' : 'messages');
  if (!viewing) toast(letter ? '💌 New letter from ' + who : '💬 ' + who + ': ' + preview);
  notify.show(letter ? '💌 Letter from ' + who : who, preview, letter ? 'letter' : 'chat');
}

function loadMessages() {
  if (!fb.ready) {
    messages = [{ id: 'local-1', from: 'dee', type: 'letter', ts: Date.now() - 864e5 * 2, text: 'Hey Jay,\n\nI made us this little corner of the internet so we always have somewhere to come back to.\n\nI love you more than the days we’ve counted.\n\n— always yours, Dee', edited: false, reactions: {} }];
    renderAll(); updateNotification(); return;
  }
  unsubs.push(fb.db.collection('messages').orderBy('ts', 'asc').onSnapshot(snap => {
    allMsgs = snap.docs.map(fromDoc);
    messages = allMsgs.filter(m => !m.deleted);
    if (!firstSnap) {
      snap.docChanges().forEach(ch => {
        if (ch.type !== 'added' || ch.doc.metadata.hasPendingWrites) return;
        const m = fromDoc(ch.doc);
        if (!isOwn(m)) incoming(m);
      });
    }
    firstSnap = false;
    renderAll(); markActiveRead(); hideBanner();
  }, err => {
    console.error('[OLW] messages listen failed', err);
    ['#msgTimeline', '#timeline'].forEach(s => { const el = $(s); if (el) el.replaceChildren(h('div', { class: 'empty' }, 'Could not load (' + (err.code || 'error') + ')')); });
    if (err.code === 'permission-denied') showBanner('Firestore permission denied.', 'Your security rules are blocking reads. Publish firestore.rules in the Firebase console.');
  }));
}

/* ───────── voice notes ───────── */
function setRecording(on) {
  state.recording = on;
  $('#recBar').hidden = !on;
  $('#msgRow').hidden = on;
  $('#emojiPop').hidden = true;
}

/* ───────── wiring (once) ───────── */
function wire() {
  if (wired) return;
  wired = true;

  /* chat composer */
  const input = $('#msgInput');
  const submit = () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    input.value = ''; autoGrow(input); store.del('olw_draft_msg_' + me().id);
    writePresence({ typingAt: 0 });
    send('chat', text);
    scrollBottom($('#msgTimeline'), true);
    input.focus();
  };
  $('#sendMsgBtn').addEventListener('click', submit);
  input.addEventListener('input', () => { autoGrow(input); sendTyping(); store.set('olw_draft_msg_' + me().id, input.value); });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if ((!coarse && !e.shiftKey) || e.ctrlKey || e.metaKey) { e.preventDefault(); submit(); }
  });

  /* emoji picker */
  const pop = $('#emojiPop');
  pop.replaceChildren(...EMOJI.map(em => h('button', { type: 'button', 'aria-label': em, onclick: () => {
    const s = input.selectionStart ?? input.value.length;
    input.setRangeText(em, s, input.selectionEnd ?? s, 'end');
    autoGrow(input); input.focus();
  } }, em)));
  $('#emojiBtn').addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; $('#emojiBtn').setAttribute('aria-expanded', String(!pop.hidden)); });
  document.addEventListener('click', e => {
    if (!pop.hidden && !e.target.closest('#emojiPop,#emojiBtn')) pop.hidden = true;
    if (!e.target.closest('.bubble')) $$('.bubble.show-actions').forEach(b => b.classList.remove('show-actions'));
  });

  /* voice */
  recorder = createRecorder({
    maxSeconds: CONFIG.voiceMaxSeconds,
    onStart: () => { setRecording(true); $('#micBtn').classList.add('recording'); },
    onTick: s => { $('#recTime').textContent = fmtDuration(s); },
    onDone: dataUrl => {
      setRecording(false); $('#micBtn').classList.remove('recording');
      if (dataUrl.length > CONFIG.voiceMaxBytes) { toast('That voice note is too large to send. Try a shorter one.', 'error'); return; }
      send('voice', dataUrl); toast('Voice note sent 🎤', 'success');
    },
    onCancel: () => { setRecording(false); $('#micBtn').classList.remove('recording'); },
    onError: msg => toast(msg, 'error')
  });
  $('#micBtn').addEventListener('click', () => recorder.start());
  $('#recSend').addEventListener('click', () => recorder.stop());
  $('#recCancel').addEventListener('click', () => recorder.cancel());

  /* jump to latest */
  const tl = $('#msgTimeline');
  $('#jumpBtn').addEventListener('click', () => { scrollBottom(tl, true); pendingNew = 0; $('#jumpBtn').hidden = true; });
  tl.addEventListener('scroll', () => { if (nearBottom(tl)) { pendingNew = 0; $('#jumpBtn').hidden = true; } }, { passive: true });

  /* letters */
  const lInput = $('#letterInput'), lBox = $('#letterComposer');
  const draftKey = () => 'olw_draft_letter_' + me().id;
  const lCount = () => { $('#letterChars').textContent = lInput.value.length.toLocaleString() + ' / 8,000'; };
  $('#toggleLetter').addEventListener('click', () => { lBox.hidden = !lBox.hidden; if (!lBox.hidden) { lInput.focus(); lBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
  $('#cancelLetter').addEventListener('click', () => { lBox.hidden = true; });
  lInput.addEventListener('input', () => { lCount(); store.set(draftKey(), lInput.value); });
  lInput.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#sendLetterBtn').click(); } });
  $('#sendLetterBtn').addEventListener('click', () => {
    const text = lInput.value.trim();
    if (!text) { lInput.focus(); return; }
    lInput.value = ''; lCount(); store.del(draftKey()); lBox.hidden = true;
    send('letter', text); toast('Letter sent 💌', 'success');
  });

  /* WhatsApp nudge */
  $$('[data-nudge]').forEach(btn => btn.addEventListener('click', () => {
    const phone = CONFIG.phones[partnerId()];
    if (!phone) { toast('Phone number not configured.', 'error'); return; }
    const msg = 'Hey ' + me().partner + '! 💞 I left you a ' + btn.dataset.nudge + ' in our app. Go check it!\n\n' + CONFIG.appUrl;
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  }));

  /* home notification card + alerts button */
  $('#letterNotif').addEventListener('click', () => bus.emit('goto', { tab: $('#letterNotif').dataset.target || 'messages' }));
  const alertsBtn = $('#enableAlerts');
  alertsBtn.addEventListener('click', async () => {
    const res = await notify.ask();
    alertsBtn.hidden = !notify.canAsk();
    toast(res === 'granted' ? 'Alerts are on 🔔' : 'Alerts stay off. You can change this in your browser settings.');
  });

  /* tab + visibility hooks */
  bus.on('tab', ({ tab, prev }) => {
    if (!me()) return;
    if (prev === 'messages' && tab !== 'messages') { dividers.msg = null; renderChat(); }
    if (prev === 'letters' && tab !== 'letters') { dividers.letter = null; renderLetters(); }
    if (tab === 'messages') {
      const r = getRead();
      dividers.msg = messages.some(m => isMsg(m) && !isOwn(m) && m.ts > r.msg) ? r.msg : null;
      renderChat(); markRead('msg');
      requestAnimationFrame(() => scrollBottom($('#msgTimeline')));
    } else if (tab === 'letters') {
      const r = getRead();
      dividers.letter = messages.some(m => isLetter(m) && !isOwn(m) && m.ts > r.letter) ? r.letter : null;
      renderLetters(); markRead('letter');
    } else updateNotification();
  });
  document.addEventListener('visibilitychange', () => {
    if (!me()) return;
    writePresence({ online: !document.hidden, lastSeen: Date.now() });
    if (!document.hidden) markActiveRead();
  });
  window.addEventListener('pagehide', () => { if (me()) writePresence({ online: false, lastSeen: Date.now() }); });
  bus.on('lock', () => { if (recorder && recorder.active) recorder.cancel(); });
}

/* ───────── lifecycle ───────── */
export function start() {
  wire();
  firstSnap = true; renderState = { count: 0, first: true }; pendingNew = 0;
  lastWritten = { msg: 0, letter: 0 };
  $('#enableAlerts').hidden = !notify.canAsk();
  const draft = store.get('olw_draft_msg_' + me().id, '');
  $('#msgInput').value = draft || ''; autoGrow($('#msgInput'));
  $('#letterInput').value = store.get('olw_draft_letter_' + me().id, '') || '';
  $('#letterChars').textContent = $('#letterInput').value.length.toLocaleString() + ' / 8,000';
  loadMessages();
  listenPresence();
  beat();
  timers.push(setInterval(beat, 25000), setInterval(paintStatus, 3000));
}

export function stop(prevRoom) {
  unsubs.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  unsubs = [];
  timers.forEach(clearInterval); timers = [];
  if (fb.ready && prevRoom) fb.db.collection('presence').doc(prevRoom.id).set({ online: false, typingAt: 0, lastSeen: Date.now() }, { merge: true }).catch(() => {});
  messages = []; allMsgs = []; caches = {}; editingId = null; dividers = { msg: null, letter: null };
  partner = { lastReadMsg: 0, lastReadLetter: 0, online: false, lastSeen: 0, typingAt: 0 };
  ['#msgTimeline', '#timeline'].forEach(s => { const el = $(s); if (el) el.replaceChildren(); });
  setBadge('msgBadge', 0); setBadge('tabBadge', 0);
  $('#letterNotif').classList.remove('show');
  $('#msgInput').value = ''; $('#letterInput').value = '';
  $('#letterComposer').hidden = true;
  notify.setUnread(0);
  hideBanner();
}
