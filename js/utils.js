/* Small DOM + formatting helpers. No innerHTML anywhere: everything is built with textContent. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

/* ── dates ── */
export const pad = n => (n < 10 ? '0' : '') + n;
export const parseISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayNum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export const fmtDate = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtShort = d => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
export const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const dateKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
export const fmtDuration = s => Math.floor(s / 60) + ':' + pad(Math.floor(s % 60));
export const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function fmtDateSep(ts) {
  const d = new Date(ts), diff = daysBetween(d, new Date());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
export function fmtLetterTime(ts) {
  return fmtDateSep(ts) + ' · ' + fmtTime(ts);
}
export function relativeTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  const diff = daysBetween(new Date(ts), new Date());
  return diff === 1 ? 'yesterday' : fmtShort(new Date(ts));
}

/* ── storage (never throws) ── */
export const store = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};

/* ── crypto ── */
/* Pure-JS SHA-256 fallback: crypto.subtle only exists on https/localhost, so without this
   the passcode could never be verified over http, a LAN IP or file://. */
function sha256Js(str) {
  const bytes = new TextEncoder().encode(str);
  const K = [], H = [];
  const frac = x => Math.floor((x - Math.floor(x)) * 4294967296);
  for (let n = 2, c = 0; c < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (c < 8) H[c] = frac(Math.sqrt(n));
    K[c++] = frac(Math.cbrt(n));
  }
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const len = bytes.length, total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
export async function sha256Hex(str) {
  if (globalThis.crypto && crypto.subtle) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through */ }
  }
  return sha256Js(str);
}
export { sha256Js };

/* ── misc ── */
export function autoGrow(el, max = 140) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}
export function throttle(fn, ms) {
  let last = 0;
  return (...a) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...a); } };
}

/* Turn http(s) URLs into safe anchors. Returns a DocumentFragment. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/gi;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* ── toast / banner / confirm ── */
let toastTimer;
export function toast(msg, type = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}
export function showBanner(title, text) {
  const b = $('#connBanner');
  if (!b) return;
  $('#connTitle').textContent = title + ' ';
  $('#connText').textContent = text;
  b.hidden = false;
}
export function hideBanner() { const b = $('#connBanner'); if (b) b.hidden = true; }

export function confirmDialog({ title = 'Are you sure?', body = '', ok = 'Confirm', cancel = 'Cancel', danger = false } = {}) {
  const dlg = $('#dialog');
  if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(body || title));
  $('#dialogTitle').textContent = title;
  $('#dialogBody').textContent = body;
  const okBtn = $('#dialogOk'), cancelBtn = $('#dialogCancel');
  okBtn.textContent = ok; cancelBtn.textContent = cancel;
  okBtn.classList.toggle('danger', danger);
  okBtn.classList.toggle('btn--primary', !danger);
  return new Promise(resolve => {
    const done = v => {
      dlg.removeEventListener('close', onClose);
      okBtn.onclick = null; cancelBtn.onclick = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    const onClose = () => done(false);
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}
