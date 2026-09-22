export function createChebyshevTone({
  frequency = 220,
  coefficients = [0, 1, 0.35, 0.2, 0.1],
  sampleRate = 48_000,
  durationSeconds = 1,
} = {}) {
  const frameCount = Math.max(1, Math.round(sampleRate * durationSeconds));
  const lowGate = sampleRate * 0.4;
  const highGate = sampleRate * 0.48;
  const gains = coefficients.map((coefficient, n) => ({
    n,
    frequency: n * frequency,
    gain: n === 0 ? 0 : coefficient * harmonicFade(n * frequency, lowGate, highGate),
  }));
  const samples = new Float32Array(frameCount);
  let peak = 0;
  let suppressed = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const x = Math.cos((2 * Math.PI * frequency * i) / sampleRate);
    let t0 = 1;
    let t1 = x;
    let value = (coefficients[1] ?? 0) * t1;
    for (let n = 2; n < coefficients.length; n += 1) {
      const t2 = 2 * x * t1 - t0;
      value += gains[n].gain * t2;
      if (gains[n].gain === 0 && coefficients[n] !== 0) suppressed += 1;
      t0 = t1;
      t1 = t2;
    }
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  const normalization = peak > 1 ? 0.98 / peak : 1;
  const pcm = new ArrayBuffer(frameCount * 2);
  const view = new DataView(pcm);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] * normalization));
    view.setInt16(i * 2, Math.round(value * 32767), true);
  }

  return {
    blob: new Blob([wavHeader(pcm.byteLength, sampleRate), pcm], { type: "audio/wav" }),
    metadata: { frequency, sampleRate, durationSeconds, harmonicCount: coefficients.length - 1, peak, normalization, suppressed, gains },
  };
}

function harmonicFade(frequency, low, high) {
  if (frequency <= low) return 1;
  if (frequency >= high) return 0;
  return 1 - (frequency - low) / (high - low);
}

function wavHeader(dataLength, sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataLength, true);
  return buffer;
}
