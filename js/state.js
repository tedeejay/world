/* Tiny shared state + event bus so modules stay decoupled. */
export const state = { room: null, tab: 'home', recording: false };

const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  },
  emit(evt, data) {
    (listeners.get(evt) || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[bus]', evt, e); } });
  }
};
