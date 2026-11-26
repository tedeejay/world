/* Visual effects: drifting hearts, confetti, tap-heart pop. All respect prefers-reduced-motion. */
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * .3);
  ctx.bezierCurveTo(x, y - s * .1, x - s * .6, y - s * .1, x - s * .6, y + s * .3);
  ctx.bezierCurveTo(x - s * .6, y + s * .65, x, y + s * .8, x, y + s * 1.05);
  ctx.bezierCurveTo(x, y + s * .8, x + s * .6, y + s * .65, x + s * .6, y + s * .3);
  ctx.bezierCurveTo(x + s * .6, y - s * .1, x, y - s * .1, x, y + s * .3);
  ctx.fill();
}

export function startHearts(canvas) {
  const ctx = canvas.getContext('2d');
  const hearts = [];
  let w = 0, hgt = 0, raf = 0, running = false;

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = window.innerWidth; hgt = window.innerHeight;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawn() {
    hearts.push({
      x: Math.random() * w, y: hgt + 24, s: 6 + Math.random() * 12,
      v: .25 + Math.random() * .55, d: (Math.random() - .5) * .4,
      a: .1 + Math.random() * .26, p: Math.random() * 6.28,
      c: Math.random() < .25 ? '232,201,168' : '255,158,194'
    });
  }
  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, w, hgt);
    if (hearts.length < 26 && Math.random() < .05) spawn();
    for (let i = hearts.length - 1; i >= 0; i--) {
      const p = hearts[i];
      p.y -= p.v; p.p += .02; p.x += p.d + Math.sin(p.p) * .35;
      if (p.y < -30) { hearts.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(' + p.c + ',' + p.a + ')';
      heartPath(ctx, p.x, p.y, p.s);
    }
    raf = requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => { if (running) size(); });

  return {
    play() { if (running || reduced()) return; running = true; size(); raf = requestAnimationFrame(frame); },
    pause() { running = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, hgt); }
  };
}

export function confetti(count = 150) {
  if (reduced()) return;
  const c = document.createElement('canvas');
  c.className = 'fx-canvas fx-confetti';
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#ff9ec2', '#ff7aa8', '#ffd6e4', '#e8c9a8', '#ffffff', '#a8b8f7'];
  const bits = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - .5) * W * .4, y: H * .35,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3,
    s: 5 + Math.random() * 6, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  const t0 = performance.now();
  (function loop(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    bits.forEach(b => {
      b.vy += .32; b.vx *= .992; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.globalAlpha = Math.max(0, 1 - t / 4500);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 3, b.s, b.s * .6);
      ctx.restore();
    });
    if (t < 4500) requestAnimationFrame(loop); else c.remove();
  })(t0);
}

export function popHeart(x, y, emoji = '❤️') {
  if (reduced()) return;
  const el = document.createElement('span');
  el.className = 'pop-heart';
  el.textContent = emoji;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
}
