---
name: chebyshev-audio-dsp
description: Generate and inspect anti-aliased harmonic tones with Chebyshev polynomial waveshaping.
---

# Chebyshev Audio DSP

Use this skill for procedural audio experiments, timbre sketches, and DSP clues that contain the recurrence
`T_n(x) = 2*x*T_(n-1)(x) - T_(n-2)(x)`.

## Model

- Let `x = cos(2*pi*f0*t)` be the oscillator sample.
- Start with `T0 = 1` and `T1 = x`.
- Generate each higher polynomial with the two-value recurrence rather than repeated powers.
- Multiply `Tn` by coefficient `a[n]`; the coefficient controls the nth harmonic's contribution.
- Fade a harmonic as `n*f0` approaches the Nyquist limit. Use a soft band such as `0.40*sampleRate` to `0.48*sampleRate`, then reject frequencies at or above `sampleRate/2`.
- Normalize the final buffer before converting to PCM so coefficient changes cannot silently clip.

## Interpretation

This is a low-level oscillator/waveshaper, not a complete music-generation model. It can produce a playable WAV, waveform, and spectrum metadata. A text-to-music API is a separate higher-level capability.

## Output Contract

When implementing a tool around this skill, accept `frequency`, `coefficients`, `sampleRate`, and `durationSeconds`. Return the audio artifact plus the resolved harmonic gains, peak before normalization, and a warning when harmonics were suppressed by the Nyquist gate.
