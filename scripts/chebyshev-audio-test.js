import assert from "node:assert/strict";
import { synthesizeChebyshev } from "./chebyshev-audio-demo.js";

const result = synthesizeChebyshev({
  frequency: 440,
  coefficients: [0, 1, 0.25, 0.1, 0.05],
  sampleRate: 48_000,
  durationSeconds: 0.05,
});

assert.equal(result.wav.toString("ascii", 0, 4), "RIFF");
assert.equal(result.wav.toString("ascii", 8, 12), "WAVE");
assert.equal(result.wav.readUInt32LE(24), 48_000);
assert.equal(result.wav.readUInt16LE(34), 16);
assert.ok(result.metadata.harmonicCount === 4);
assert.ok(result.metadata.peakBeforeNormalization > 0);
assert.ok(result.metadata.harmonicGains[1].gain > 0);
console.log("chebyshev audio test passed");
