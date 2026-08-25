// Receiver-side: mic capture -> Goertzel bit stream -> frame sync -> image reconstruction.

const Decoder = (() => {
  const STATE = {
    LISTENING: 'listening',
    READING_LENGTH: 'reading_length',
    READING_PAYLOAD: 'receiving_payload',
    READING_CRC: 'reading_crc',
    DONE: 'done',
  };

  function createReceiver({ onStatus, onDone } = {}) {
    let audioCtx = null;
    let workletNode = null;
    let stream = null;

    let state = STATE.LISTENING;
    let rollingBits = [];
    let lengthBits = [];
    let payloadBits = [];
    let crcBits = [];
    let expectedPayloadBits = 0;

    function resetFrameState() {
      state = STATE.LISTENING;
      rollingBits = [];
      lengthBits = [];
      payloadBits = [];
      crcBits = [];
      expectedPayloadBits = 0;
    }

    function report(status, extra) {
      if (onStatus) onStatus(status, extra);
    }

    function handleBit(bit) {
      if (state === STATE.LISTENING) {
        rollingBits.push(bit);
        if (rollingBits.length > PROTOCOL.PREAMBLE_SYMBOLS.length) {
          rollingBits.shift();
        }
        if (
          rollingBits.length === PROTOCOL.PREAMBLE_SYMBOLS.length &&
          rollingBits.every((b, i) => b === PROTOCOL.PREAMBLE_SYMBOLS[i])
        ) {
          state = STATE.READING_LENGTH;
          lengthBits = [];
          report('synced');
        }
        return;
      }

      if (state === STATE.READING_LENGTH) {
        lengthBits.push(bit);
        if (lengthBits.length === PROTOCOL.LENGTH_BITS) {
          expectedPayloadBits = protocolUtils.bitsToNumber(lengthBits) * 8;
          payloadBits = [];
          state = STATE.READING_PAYLOAD;
          report('receiving', { received: 0, total: expectedPayloadBits / 8 });
        }
        return;
      }

      if (state === STATE.READING_PAYLOAD) {
        payloadBits.push(bit);
        if (payloadBits.length % 8 === 0) {
          report('receiving', { received: payloadBits.length / 8, total: expectedPayloadBits / 8 });
        }
        if (payloadBits.length === expectedPayloadBits) {
          crcBits = [];
          state = STATE.READING_CRC;
        }
        return;
      }

      if (state === STATE.READING_CRC) {
        crcBits.push(bit);
        if (crcBits.length === 8) {
          finishFrame();
        }
        return;
      }
    }

    function finishFrame() {
      const payloadBytes = protocolUtils.bitsToBytes(payloadBits);
      const receivedCrc = protocolUtils.bitsToNumber(crcBits);
      const computedCrc = protocolUtils.crc8(payloadBytes);
      const crcOk = receivedCrc === computedCrc;

      const blob = new Blob([payloadBytes], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      state = STATE.DONE;
      report('done', { crcOk, byteLength: payloadBytes.length });
      if (onDone) onDone({ crcOk, imageUrl: url, byteLength: payloadBytes.length });

      resetFrameState();
    }

    async function start() {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.audioWorklet.addModule('js/goertzel-worklet.js');

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const source = audioCtx.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNode(audioCtx, 'goertzel-processor', {
        processorOptions: {
          freq0: PROTOCOL.FREQ_0,
          freq1: PROTOCOL.FREQ_1,
          symbolMs: PROTOCOL.SYMBOL_MS,
        },
      });

      // Worklet needs to be connected into the graph to run process(); route
      // through a muted gain node so nothing is actually audible.
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      source.connect(workletNode).connect(muteGain).connect(audioCtx.destination);

      workletNode.port.onmessage = (event) => {
        const { e0, e1 } = event.data;
        const bit = e1 > e0 ? 1 : 0;
        handleBit(bit);
      };

      resetFrameState();
      report('listening');
    }

    function stop() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (workletNode) workletNode.port.onmessage = null;
      if (audioCtx) audioCtx.close();
    }

    return { start, stop };
  }

  return { createReceiver };
})();

window.Decoder = Decoder;
