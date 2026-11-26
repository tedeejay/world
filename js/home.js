/* Home: hero slideshow, live countdowns, milestones, birthdays. */
import { CONFIG } from './config.js';
import { $, h, pad, fmtDate, fmtShort, parseISODate, daysBetween, dateKey, store } from './utils.js';
import { state, bus } from './state.js';
import { confetti } from './fx.js';

const MILESTONES = [7, 14, 30, 50, 75, 100, 150, 200, 250, 300, 365, 500, 600, 730, 1000, 1095, 1500, 2000, 2500, 3000, 3650];
let clock = null, heroTimer = null, wired = false, lastMinute = -1;
let setAnniv, setBday;

function mountTimer(el) {
  el.replaceChildren();
  const cells = ['days', 'hrs', 'min', 'sec'].map(label => {
    const b = h('b', null, '0');
    el.append(h('div', null, b, h('span', null, label)));
    return b;
  });
  return ms => {
    ms = Math.max(0, ms);
    [Math.floor(ms / 864e5), Math.floor(ms / 36e5) % 24, Math.floor(ms / 6e4) % 60, Math.floor(ms / 1e3) % 60].forEach((n, i) => {
      const t = i === 0 ? String(n) : pad(n);
      if (cells[i].textContent !== t) cells[i].textContent = t;
    });
  };
}
const setText = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };

export function nextBirthday(b, now = new Date()) {
  const [y, m, d] = b.date.split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), m - 1, d);
  if (next < today) next = new Date(now.getFullYear() + 1, m - 1, d);
  return { ...b, y, m, d, next, today, turning: next.getFullYear() - y, isToday: next.getTime() === today.getTime() };
}

function celebrateOnce(tag) {
  const key = 'olw_celebrated_' + tag + '_' + dateKey(Date.now());
  if (store.get(key)) return;
  store.set(key, 1);
  setTimeout(() => confetti(), 500);
}

function tick() {
  const now = new Date();
  const start = parseISODate(CONFIG.togetherSince);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, daysBetween(start, now));
  setText('daysTogether', days.toLocaleString());

  /* anniversary */
  let a = new Date(now.getFullYear(), start.getMonth(), start.getDate());
  if (a < today) a.setFullYear(a.getFullYear() + 1);
  while (a <= start) a.setFullYear(a.getFullYear() + 1);
  const years = a.getFullYear() - start.getFullYear();
  const annivToday = a.getTime() === today.getTime();
  setText('annivSub', annivToday ? '🎉 Happy ' + years + '-year anniversary!' : fmtDate(a) + ' · ' + years + ' year' + (years === 1 ? '' : 's'));
  setAnniv(a - now);
  if (annivToday) celebrateOnce('anniv');

  /* soonest birthday */
  const nb = CONFIG.birthdays.map(b => nextBirthday(b, now)).sort((x, y) => x.next - y.next)[0];
  if (nb) {
    setText('bdaySub', nb.isToday ? nb.emoji + ' Happy birthday, ' + nb.name + '!' : nb.emoji + ' ' + nb.name + ' turns ' + nb.turning + ' · ' + fmtShort(nb.next));
    setBday(nb.next - now);
    if (nb.isToday) celebrateOnce('bday-' + nb.name);
  }

  /* milestone */
  let next = MILESTONES.find(m => m >= days);
  if (!next) next = Math.ceil((days + 1) / 1000) * 1000;
  const prev = [0, ...MILESTONES].filter(m => m < next && m <= days).pop() || 0;
  const left = next - days;
  const when = new Date(start.getFullYear(), start.getMonth(), start.getDate() + next);
  setText('msSub', 'Day ' + next.toLocaleString() + ' · ' + fmtDate(when));
  setText('msBig', left === 0 ? '🎉' : left.toLocaleString());
  setText('msLabel', left === 0 ? 'milestone today!' : left === 1 ? 'day to go' : 'days to go');
  setText('msFrom', 'Day ' + prev.toLocaleString());
  setText('msTo', 'Day ' + next.toLocaleString());
  const pct = next === prev ? 100 : Math.min(100, Math.max(0, ((days - prev) / (next - prev)) * 100));
  const bar = $('#msBar'); if (bar) bar.style.width = pct + '%';
  if (left === 0) celebrateOnce('milestone');

  /* birthdays tab refreshes once a minute while visible */
  const minute = now.getMinutes();
  if (state.tab === 'birthdays' && minute !== lastMinute) { lastMinute = minute; buildBirthdays(); }
}

export function buildBirthdays() {
  const grid = $('#bdayGrid');
  if (!grid) return;
  const now = new Date();
  const list = CONFIG.birthdays.map(b => nextBirthday(b, now)).sort((x, y) => x.next - y.next);
  grid.replaceChildren(...list.map(nb => {
    const last = new Date(nb.next.getFullYear() - 1, nb.m - 1, nb.d);
    const total = nb.next - last;
    const pct = total > 0 ? Math.min(100, Math.max(0, ((now - last) / total) * 100)) : 0;
    const daysLeft = Math.max(0, daysBetween(nb.today, nb.next));
    const glow = h('div', { class: 'bday__glow' }); glow.style.background = nb.glow;
    const fill = h('i'); fill.style.width = pct + '%';
    return h('article', { class: 'bday' },
      glow,
      h('div', { class: 'bday__top' },
        h('div', { class: 'bday__emoji' }, nb.emoji),
        h('div', null,
          h('div', { class: 'bday__name' }, nb.name),
          h('div', { class: 'bday__date' }, fmtShort(new Date(nb.y, nb.m - 1, nb.d)) + ' · born ' + nb.y))),
      h('div', { class: 'bday__count' }, h('b', null, String(daysLeft)), h('span', null, 'day' + (daysLeft === 1 ? '' : 's') + ' to go')),
      h('div', { class: 'bday__next' }, 'Turns ', h('b', null, String(nb.turning)), ' on ', h('b', null, fmtDate(nb.next))),
      h('div', { class: 'bar' }, fill),
      h('div', { class: 'bday__foot' }, h('span', null, Math.round(pct) + '% of the way there'), h('span', null, fmtShort(nb.next))),
      nb.isToday ? h('div', { class: 'today-badge' }, '🎉 Today! Happy birthday 🎉') : null);
  }));
}

/* ── hero slideshow (cross-fades two layers) ── */
function setHeroImages(imgs) {
  const A = $('#heroBgA'), B = $('#heroBgB');
  if (!A || !B) return;
  clearInterval(heroTimer); heroTimer = null;
  A.classList.remove('on'); B.classList.remove('on');
  if (!imgs.length) return;
  imgs.forEach(src => { const im = new Image(); im.src = src; });
  A.style.backgroundImage = "url('" + imgs[0] + "')";
  setTimeout(() => A.classList.add('on'), 60);
  if (imgs.length === 1) return;
  let i = 0, showA = true;
  heroTimer = setInterval(() => {
    if (document.hidden) return;
    i = (i + 1) % imgs.length;
    const [on, off] = showA ? [B, A] : [A, B];
    on.style.backgroundImage = "url('" + imgs[i] + "')";
    on.classList.add('on'); off.classList.remove('on');
    showA = !showA;
  }, 5500);
}

export function start() {
  if (!wired) {
    wired = true;
    bus.on('memories', ({ images }) => setHeroImages(images));
  }
  $('#sinceText').textContent = fmtDate(parseISODate(CONFIG.togetherSince));
  setAnniv = mountTimer($('#annivTimer'));
  setBday = mountTimer($('#bdayTimer'));
  buildBirthdays();
  tick();
  clearInterval(clock);
  clock = setInterval(tick, 1000);
}
export function stop() {
  clearInterval(clock); clock = null;
  clearInterval(heroTimer); heroTimer = null;
}
