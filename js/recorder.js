/* Voice-note recorder wrapper around MediaRecorder. Produces a data: URL. */
export function createRecorder({ maxSeconds = 45, onStart, onTick, onDone, onCancel, onError }) {
  let rec = null, stream = null, chunks = [], timer = null, t0 = 0, cancelled = false, active = false;

  const pickMime = () => {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  };
  const cleanup = () => {
    clearInterval(timer); timer = null; active = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  };

  async function start() {
    if (active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      onError && onError('Voice notes are not supported in this browser.'); return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError && onError('Could not access the microphone. Please allow permission.'); return;
    }
    cancelled = false; chunks = [];
    const mime = pickMime();
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    rec.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
    rec.addEventListener('stop', () => {
      const secs = (Date.now() - t0) / 1000;
      const type = rec.mimeType || mime || 'audio/webm';
      cleanup();
      if (cancelled) { onCancel && onCancel(); return; }
      if (secs < 1) { onError && onError('Too short — hold on a little longer.'); onCancel && onCancel(); return; }
      const reader = new FileReader();
      reader.onloadend = () => onDone && onDone(reader.result, secs);
      reader.readAsDataURL(new Blob(chunks, { type }));
    });
    rec.start();
    active = true; t0 = Date.now();
    onStart && onStart();
    onTick && onTick(0);
    timer = setInterval(() => {
      const s = (Date.now() - t0) / 1000;
      onTick && onTick(s);
      if (s >= maxSeconds) stop();
    }, 250);
  }
  function stop() { if (rec && rec.state !== 'inactive') rec.stop(); }
  function cancel() { cancelled = true; if (rec && rec.state !== 'inactive') rec.stop(); else { cleanup(); onCancel && onCancel(); } }

  return { start, stop, cancel, get active() { return active; } };
}
