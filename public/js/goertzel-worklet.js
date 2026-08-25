// AudioWorkletProcessor with two phases:
//   1. sync_scan  -- continuously scans short (fine) windows for the sync
//      tone's onset, to find the exact sample where data starts.
//   2. symbol_lock -- once locked, accumulates one full symbol-duration
//      block per bit, aligned to that discovered sample offset, and reports
//      Goertzel energy at the two data frequencies for each block.
// After a completed frame, the main thread sends {type: "reset"} to drop
// back into sync_scan for the next transmission.

class GoertzelProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.freq0 = opts.freq0;
    this.freq1 = opts.freq1;
    this.freqSync = opts.freqSync;

    this.symbolBlockSize = Math.max(1, Math.round((sampleRate * opts.symbolMs) / 1000));
    this.syncTotalSamples = Math.max(1, Math.round((sampleRate * opts.syncMs) / 1000));

    this.fineWindowSamples = Math.max(1, Math.round((sampleRate * 5) / 1000)); // 5ms
    this.confirmWindows = 4; // consecutive dominant fine windows to confirm sync lock

    this.fineBuffer = new Float32Array(this.fineWindowSamples);
    this.symbolBuffer = new Float32Array(this.symbolBlockSize);

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'reset') this.resetToScan();
    };

    this.resetToScan();
  }

  resetToScan() {
    this.state = 'sync_scan';
    this.fineIndex = 0;
    this.consecutiveDominant = 0;
    this.skipRemaining = 0;
    this.symbolIndex = 0;
  }

  goertzelEnergy(samples, freq) {
    const N = samples.length;
    const k = Math.round((N * freq) / sampleRate);
    const w = (2 * Math.PI * k) / N;
    const coeff = 2 * Math.cos(w);
    let q1 = 0;
    let q2 = 0;
    for (let i = 0; i < N; i++) {
      const q0 = coeff * q1 - q2 + samples[i];
      q2 = q1;
      q1 = q0;
    }
    return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];

      if (this.state === 'sync_scan') {
        this.fineBuffer[this.fineIndex++] = sample;
        if (this.fineIndex >= this.fineWindowSamples) {
          this.fineIndex = 0;
          const eSync = this.goertzelEnergy(this.fineBuffer, this.freqSync);
          const e0 = this.goertzelEnergy(this.fineBuffer, this.freq0);
          const e1 = this.goertzelEnergy(this.fineBuffer, this.freq1);

          this.consecutiveDominant = eSync > e0 && eSync > e1 ? this.consecutiveDominant + 1 : 0;

          if (this.consecutiveDominant >= this.confirmWindows) {
            // Sync confirmed partway through the tone -- skip the estimated
            // remainder so symbol accumulation starts right at the data
            // boundary, sample-accurately.
            const elapsedIntoSync = this.confirmWindows * this.fineWindowSamples;
            this.skipRemaining = Math.max(0, this.syncTotalSamples - elapsedIntoSync);
            this.consecutiveDominant = 0;
            this.symbolIndex = 0;
            this.state = this.skipRemaining > 0 ? 'skip' : 'symbol_lock';
          }
        }
        continue;
      }

      if (this.state === 'skip') {
        this.skipRemaining--;
        if (this.skipRemaining <= 0) {
          this.state = 'symbol_lock';
          this.symbolIndex = 0;
        }
        continue;
      }

      if (this.state === 'symbol_lock') {
        this.symbolBuffer[this.symbolIndex++] = sample;
        if (this.symbolIndex >= this.symbolBlockSize) {
          this.symbolIndex = 0;
          const e0 = this.goertzelEnergy(this.symbolBuffer, this.freq0);
          const e1 = this.goertzelEnergy(this.symbolBuffer, this.freq1);
          this.port.postMessage({ e0, e1 });
        }
        continue;
      }
    }

    return true;
  }
}

registerProcessor('goertzel-processor', GoertzelProcessor);
