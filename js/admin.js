/* Minimal memories admin. Only opens for a session unlocked as Jay. */
import { CONFIG, SESSION_KEY } from './config.js';
import * as fb from './firebase.js';
import { $, h, store, toast, confirmDialog } from './utils.js';

const session = store.get(SESSION_KEY);
const allowed = session && session.id === 'jay' && Date.now() - (session.at || 0) < CONFIG.sessionTtlMs;

if (!allowed) {
  $('#gate').hidden = false;
} else {
  $('#panel').hidden = false;
  fb.initFirebase(CONFIG.firebase);
  if (!fb.ready) {
    $('#adminBanner').hidden = false;
    $('#adminBannerText').textContent = 'Firebase could not load, so changes can’t be saved right now.';
  } else init();
}

function init() {
  const col = fb.db.collection('memories');
  let items = [];

  col.onSnapshot(snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    render();
    $('#fOrder').value = items.length ? Math.max(...items.map(i => (typeof i.order === 'number' ? i.order : 0))) + 1 : 1;
  }, err => {
    $('#adminBanner').hidden = false;
    $('#adminBannerText').textContent = 'Could not read memories (' + (err.code || 'error') + '). Check your Firestore rules.';
  });

  function render() {
    $('#memCount').textContent = '(' + items.length + ')';
    $('#seedBtn').hidden = items.length > 0;
    const list = $('#memList');
    if (!items.length) { list.replaceChildren(h('div', { class: 'empty' }, 'No memories yet. Add one above, or import the default set.')); return; }
    list.replaceChildren(...items.map(m => {
      const cap = h('input', { type: 'text', value: m.caption || '', maxlength: '120', 'aria-label': 'Caption' });
      const ord = h('input', { type: 'number', value: String(m.order ?? 0), 'aria-label': 'Order' });
      const thumb = m.type === 'video'
        ? h('video', { class: 'mem-row__thumb', src: m.url + '#t=0.1', muted: true, preload: 'metadata', playsinline: true })
        : h('img', { class: 'mem-row__thumb', src: m.url, alt: '', loading: 'lazy' });
      return h('div', { class: 'mem-row' },
        thumb,
        h('div', { class: 'mem-row__fields' }, cap, ord, h('div', { class: 'mem-row__meta' }, (m.type === 'video' ? '🎬 ' : '📷 ') + m.url)),
        h('div', { class: 'mem-row__btns' },
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () =>
            col.doc(m.id).update({ caption: cap.value.trim(), order: Number(ord.value) || 0 }).then(() => toast('Saved ✔', 'success')).catch(e => toast('Save failed: ' + e.code, 'error')) }, 'Save'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
            if (await confirmDialog({ title: 'Delete this memory?', body: m.caption || m.url, ok: 'Delete', danger: true })) col.doc(m.id).delete().then(() => toast('Deleted ✔', 'success')).catch(e => toast('Delete failed: ' + e.code, 'error'));
          } }, 'Delete')));
    }));
  }

  $('#addBtn').addEventListener('click', async () => {
    const url = $('#fUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('Enter a full image or video URL starting with https://', 'error'); return; }
    try {
      await col.add({ url, type: $('#fType').value, caption: $('#fCap').value.trim(), order: Number($('#fOrder').value) || 0, createdAt: fb.serverTs() });
      $('#fUrl').value = ''; $('#fCap').value = '';
      toast('Memory added ✔', 'success');
    } catch (e) { toast('Could not add: ' + (e.code || e.message), 'error'); }
  });

  $('#fUrl').addEventListener('input', e => { if (/\.(mp4|mov|webm)(\?|$)/i.test(e.target.value)) $('#fType').value = 'video'; });

  $('#seedBtn').addEventListener('click', async () => {
    const batch = fb.db.batch();
    CONFIG.fallbackMemories.forEach((m, i) => batch.set(col.doc(), { url: m.url, type: m.type, caption: m.caption, order: i + 1, createdAt: fb.serverTs() }));
    try { await batch.commit(); toast('Imported ✔', 'success'); } catch (e) { toast('Import failed: ' + (e.code || e.message), 'error'); }
  });
}
