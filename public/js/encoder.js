// Sender-side: image -> compressed bytes -> FSK tone playback.

const Encoder = (() => {
  const MAX_DIMENSION = 128; // long edge, px — keeps payload small for the first perf test
  const JPEG_QUALITY = 0.6;

  /** Downscale + JPEG-compress an <img> element via canvas, return raw bytes. */
  async function compressImage(imgEl) {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(1, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(1, Math.round(imgEl.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    const buf = await blob.arrayBuffer();
    return { bytes: new Uint8Array(buf), width: w, height: h };
  }

  /**
   * Schedules FSK tone playback for the given symbol array (0/1 per symbol).
   * Calls onProgress(sentCount, total) as symbols are scheduled to start,
   * and onDone() once playback has fully finished.
   */
  function playSymbols(symbols, { onProgress, onDone } = {}) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const symbolSec = PROTOCOL.SYMBOL_MS / 1000;
    const syncSec = PROTOCOL.SYNC_MS / 1000;
    const leadTime = audioCtx.currentTime + 0.1; // small lead-in
    const dataStartTime = leadTime + syncSec;

    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    const gain = audioCtx.createGain();
    gain.gain.value = 1.0; // max before clipping -- GainNode values above 1.0 just distort
    osc.connect(gain).connect(audioCtx.destination);

    // Sync tone: lets the receiver find the exact sample where data starts,
    // instead of guessing symbol-block boundaries.
    osc.frequency.setValueAtTime(PROTOCOL.FREQ_SYNC, leadTime);

    symbols.forEach((bit, i) => {
      const freq = bit === 1 ? PROTOCOL.FREQ_1 : PROTOCOL.FREQ_0;
      osc.frequency.setValueAtTime(freq, dataStartTime + i * symbolSec);
    });

    osc.start(leadTime);
    const endTime = dataStartTime + symbols.length * symbolSec;
    osc.stop(endTime);

    if (onProgress) {
      const totalMs = symbols.length * PROTOCOL.SYMBOL_MS;
      const tick = () => {
        const elapsedSec = audioCtx.currentTime - dataStartTime;
        const sent = Math.min(symbols.length, Math.max(0, Math.floor(elapsedSec / symbolSec)));
        onProgress(sent, symbols.length);
        if (elapsedSec * 1000 < totalMs) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    osc.onended = () => {
      audioCtx.close();
      if (onDone) onDone();
    };
  }

  /** Full pipeline: compress image, build frame, play it. Returns transmit stats. */
  async function sendImage(imgEl, { onProgress, onDone } = {}) {
    const { bytes, width, height } = await compressImage(imgEl);
    const symbols = protocolUtils.buildFrame(bytes);
    const transmitMs = PROTOCOL.SYNC_MS + symbols.length * PROTOCOL.SYMBOL_MS;

    playSymbols(symbols, { onProgress, onDone });

    return { payloadBytes: bytes.length, width, height, symbolCount: symbols.length, transmitMs };
  }

  return { compressImage, playSymbols, sendImage };
})();

window.Encoder = Encoder;
