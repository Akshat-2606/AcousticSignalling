// AudioWorkletProcessor: accumulates samples into one block per symbol period
// and reports Goertzel energy at the two target frequencies for that block.

class GoertzelProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.freq0 = opts.freq0;
    this.freq1 = opts.freq1;
    this.blockSize = Math.max(1, Math.round((sampleRate * opts.symbolMs) / 1000));
    this.buffer = new Float32Array(this.blockSize);
    this.bufIndex = 0;
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
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.bufIndex++] = channel[i];
        if (this.bufIndex >= this.blockSize) {
          const e0 = this.goertzelEnergy(this.buffer, this.freq0);
          const e1 = this.goertzelEnergy(this.buffer, this.freq1);
          this.port.postMessage({ e0, e1 });
          this.bufIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('goertzel-processor', GoertzelProcessor);
