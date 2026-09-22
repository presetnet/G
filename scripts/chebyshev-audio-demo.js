import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function fadeout(frequency, low, high) {
  if (frequency <= low) return 1;
  if (frequency >= high) return 0;
  return 1 - (frequency - low) / (high - low);
}

export function synthesizeChebyshev({
  frequency = 220,
  coefficients = [0, 1, 0.35, 0.2, 0.1],
  sampleRate = 48_000,
  durationSeconds = 1,
} = {}) {
  if (!Number.isFinite(frequency) || frequency <= 0) throw new Error("frequency must be positive");
  if (!Number.isInteger(sampleRate) || sampleRate < 2) throw new Error("sampleRate must be an integer >= 2");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("durationSeconds must be positive");
  if (!Array.isArray(coefficients) || coefficients.length < 2) throw new Error("coefficients must include a[1]");

  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const nyquist = sampleRate / 2;
  const lowGate = sampleRate * 0.40;
  const highGate = sampleRate * 0.48;
  const harmonicGains = coefficients.map((coefficient, n) => ({
    n,
    frequency: n * frequency,
    gain: n === 0 ? 0 : coefficient * fadeout(n * frequency, lowGate, highGate),
  }));
  const samples = new Float32Array(frameCount);
  let peak = 0;
  let suppressedHarmonics = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const x = Math.cos((2 * Math.PI * frequency * i) / sampleRate);
    let t0 = 1;
    let t1 = x;
    let value = (coefficients[1] ?? 0) * t1;

    for (let n = 2; n < coefficients.length; n += 1) {
      const t2 = 2 * x * t1 - t0;
      const harmonicFrequency = n * frequency;
      const gain = harmonicGains[n].gain;
      if (gain === 0 && coefficients[n] !== 0 && harmonicFrequency >= lowGate) suppressedHarmonics += 1;
      value += gain * t2;
      t0 = t1;
      t1 = t2;
    }

    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  const normalization = peak > 1 ? 0.98 / peak : 1;
  const pcm = Buffer.alloc(frameCount * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] * normalization));
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }

  return {
    wav: createWav(pcm, sampleRate, 1, 16),
    metadata: {
      frequency,
      sampleRate,
      durationSeconds: frameCount / sampleRate,
      harmonicCount: coefficients.length - 1,
      peakBeforeNormalization: peak,
      normalization,
      suppressedHarmonics,
      harmonicGains,
      nyquist,
    },
  };
}

function createWav(pcm, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || "artifacts/chebyshev-tone.wav";
  const result = synthesizeChebyshev();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.wav);
  console.log(JSON.stringify({ output, ...result.metadata }, null, 2));
}
