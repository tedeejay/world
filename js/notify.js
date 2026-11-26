/* Local alerts: document title badge + browser notifications while the app is open in the background.
   (True push when the app is fully closed needs Firebase Cloud Messaging — see README.) */
import { CONFIG } from './config.js';

const baseTitle = document.title;
export const setUnread = n => { document.title = (n > 0 ? '(' + n + ') ' : '') + baseTitle; };
export const supported = () => 'Notification' in window;
export const canAsk = () => supported() && Notification.permission === 'default';
export async function ask() { return supported() ? Notification.requestPermission() : 'unsupported'; }

export async function show(title, body, tag) {
  if (!supported() || Notification.permission !== 'granted' || !document.hidden) return;
  const opts = { body, icon: CONFIG.logo, badge: CONFIG.logo, tag, renotify: true };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* ignore */ }
}
