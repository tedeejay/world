/* Firebase bootstrap. If the SDK can't load, the app falls back to a local demo mode. */
export let db = null;
export let ready = false;

export function initFirebase(cfg) {
  try {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    ready = true;
    // Offline cache so messages open instantly and sends queue when offline.
    try { db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch { /* unsupported */ }
  } catch (e) {
    console.warn('[OLW] Firebase unavailable — running in local demo mode.', e);
    db = null; ready = false;
  }
  return ready;
}
export const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
export const deleteField = () => firebase.firestore.FieldValue.delete();
