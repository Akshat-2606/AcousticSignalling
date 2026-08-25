// Shared constants and framing helpers used by both encoder.js and decoder.js.
// Loaded as a plain script (no bundler) so it just defines globals on `window`.

const PROTOCOL = {
  // DEBUG: audible carrier (800/1000 Hz) so the transmission can be heard
  // and sanity-checked by ear. Swap back to ~19000/19030 Hz once the
  // pipeline is confirmed working end-to-end, for the actual near-inaudible
  // design goal.
  FREQ_0: 800, // Hz, bit 0
  FREQ_1: 1000, // Hz, bit 1 -- 200Hz spacing, clearly audible
  // Goertzel frequency resolution = sampleRate / blockSize, and blockSize is
  // derived from SYMBOL_MS -- needs to be well under the tone spacing above
  // or the two tones become indistinguishable. 50ms -> ~20Hz resolution,
  // comfortably under the 200Hz spacing here.
  SYMBOL_MS: 50, // ms per symbol (bit) -> 20 baud

  // Preamble: alternating 0/1/0/1... used by the receiver to find the start
  // of a transmission and lock onto the symbol clock.
  PREAMBLE_SYMBOLS: [0, 1, 0, 1, 0, 1, 0, 1],

  LENGTH_BITS: 16, // payload length header, up to 65535 bytes
};

function crc8(bytes) {
  let crc = 0x00;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

function bitsToBytes(bits) {
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    bytes[i] = byte;
  }
  return bytes;
}

function numberToBits(num, numBits) {
  const bits = [];
  for (let i = numBits - 1; i >= 0; i--) {
    bits.push((num >> i) & 1);
  }
  return bits;
}

function bitsToNumber(bits) {
  let num = 0;
  for (const bit of bits) {
    num = (num << 1) | bit;
  }
  return num;
}

// Builds the full symbol stream (array of 0/1) for a payload: preamble + length + payload + crc8.
function buildFrame(payloadBytes) {
  const lengthBits = numberToBits(payloadBytes.length, PROTOCOL.LENGTH_BITS);
  const payloadBits = bytesToBits(payloadBytes);
  const crc = crc8(payloadBytes);
  const crcBits = numberToBits(crc, 8);
  return [...PROTOCOL.PREAMBLE_SYMBOLS, ...lengthBits, ...payloadBits, ...crcBits];
}

window.PROTOCOL = PROTOCOL;
window.protocolUtils = { crc8, bytesToBits, bitsToBytes, numberToBits, bitsToNumber, buildFrame };
