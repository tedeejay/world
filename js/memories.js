/* Memories gallery + lightbox (keyboard, swipe, captions). */
import { CONFIG } from './config.js';
import * as fb from './firebase.js';
import { state, bus } from './state.js';
import { $, $$, h } from './utils.js';

let all = [], visible = [], kind = 'all', unsub = null, idx = 0, wired = false, lastFocus = null;

const fallback = () => CONFIG.fallbackMemories.map(m => ({ ...m }));

export function start() {
  wire();
  if (!fb.ready) { set(fallback()); return; }
  unsub = fb.db.collection('memories').onSnapshot(snap => {
    const list = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.url) return;
      list.push({ id: doc.id, type: d.type === 'video' ? 'video' : 'image', url: d.url, caption: d.caption || '', order: typeof d.order === 'number' ? d.order : 999 });
    });
    set(list.length ? list.sort((a, b) => a.order - b.order) : fallback());
  }, err => { console.error('[OLW] memories listen failed', err); set(fallback()); });
}
export function stop() {
  if (unsub) unsub(); unsub = null;
  all = []; visible = [];
  $('#gallery').replaceChildren();
  closeLightbox(true);
}

function set(list) {
  all = list;
  const videos = all.filter(m => m.type === 'video').length;
  $('#allCount').textContent = all.length;
  $('#photoCount').textContent = all.length - videos;
  $('#videoCount').textContent = videos;
  render();
  const images = all.filter(m => m.type !== 'video').map(m => m.url);
  bus.emit('memories', { images: images.length ? images : [CONFIG.lockBg] });
}

function render() {
  const g = $('#gallery');
  visible = all.filter(m => kind === 'all' || (kind === 'videos') === (m.type === 'video'));
  if (!visible.length) {
    g.replaceChildren(h('div', { class: 'empty' }, kind === 'videos' ? 'No videos yet. Add some from the admin page 🎬' : kind === 'photos' ? 'No photos yet. Add some from the admin page 📷' : 'No memories yet. Add some from the admin page 💞'));
    return;
  }
  const canHover = !!(window.matchMedia && matchMedia('(hover: hover)').matches);
  g.replaceChildren(...visible.map((m, i) => {
    const isVideo = m.type === 'video';
    const media = isVideo
      ? h('video', { src: m.url + '#t=0.1', muted: true, loop: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true' })
      : h('img', { src: m.url, alt: m.caption || 'Memory', loading: 'lazy', decoding: 'async' });
    if (isVideo) media.muted = true;
    const tile = h('button', {
      type: 'button',
      class: 'tile' + (isVideo ? ' is-video' : '') + (m.caption ? ' has-cap' : ''),
      'aria-label': (isVideo ? 'Play video: ' : 'Open photo: ') + (m.caption || 'memory'),
      onclick: () => open(i)
    },
      media,
      isVideo ? h('div', { class: 'play-overlay' }) : null,
      isVideo ? h('div', { class: 'video-badge' }, 'VIDEO') : null,
      m.caption ? h('div', { class: 'tile__cap' }, m.caption) : null);
    tile.style.setProperty('--i', i);
    if (isVideo && canHover) {   // silent preview on hover (desktop)
      tile.addEventListener('pointerenter', () => { media.play().catch(() => {}); });
      tile.addEventListener('pointerleave', () => { media.pause(); try { media.currentTime = 0.1; } catch { /* ignore */ } });
    }
    return tile;
  }));
}

/* ── lightbox ── */
function show(i) {
  const host = $('#lbMedia');
  $$('video', host).forEach(v => { try { v.pause(); } catch { /* ignore */ } });
  const m = visible[i];
  if (!m) return;
  idx = i;
  let el;
  if (m.type === 'video') {
    el = h('video', { src: m.url, controls: true, playsinline: true });
    el.addEventListener('loadeddata', () => { el.play().catch(() => { el.muted = true; el.play().catch(() => {}); }); }, { once: true });
  } else {
    el = h('img', { src: m.url, alt: m.caption || 'Memory' });
  }
  host.replaceChildren(el);
  $('#lbCaption').textContent = m.caption || '';
  $('#lbCount').textContent = (i + 1) + ' / ' + visible.length;
  const n = visible[(i + 1) % visible.length];
  if (n && n.type !== 'video') new Image().src = n.url;
}
function open(i) {
  lastFocus = document.activeElement;
  const lb = $('#lightbox');
  lb.hidden = false;
  show(i);
  $('#lbClose').focus();
}
function closeLightbox(silent) {
  const lb = $('#lightbox');
  if (lb.hidden) return;
  $$('video', lb).forEach(v => { try { v.pause(); } catch { /* ignore */ } });
  $('#lbMedia').replaceChildren();
  lb.hidden = true;
  if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
}
const step = d => { if (visible.length) show((idx + d + visible.length) % visible.length); };

function wire() {
  if (wired) return;
  wired = true;
  $$('.mem-tab').forEach(tab => tab.addEventListener('click', () => {
    if (tab.dataset.mem === kind) return;
    kind = tab.dataset.mem;
    $$('.mem-tab').forEach(t => t.classList.toggle('active', t === tab));
    render();
  }));
  $('#memShuffle').addEventListener('click', () => { if (visible.length) open(Math.floor(Math.random() * visible.length)); });
  const lb = $('#lightbox');
  $('#lbClose').addEventListener('click', () => closeLightbox());
  $('#lbPrev').addEventListener('click', e => { e.stopPropagation(); step(-1); });
  $('#lbNext').addEventListener('click', e => { e.stopPropagation(); step(1); });
  lb.addEventListener('click', e => { if (e.target === lb || e.target.classList.contains('lb-figure')) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  let x0 = null;
  lb.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  bus.on('lock', () => closeLightbox(true));
}
