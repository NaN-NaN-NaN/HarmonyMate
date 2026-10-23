import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { encodeWav } from "../shared/music.ts";
import { assert } from "./security.ts";
import { DEFAULT_HARMONY, type HarmonyOptions } from "../shared/types.ts";

const exec = promisify(execFile);
const RATE = 48000;
const HOP = 960;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

// Read ffmpeg's normalized mono 48 kHz PCM, including non-audio RIFF chunks.
export function pcmSamples(bytes: Buffer): Float32Array {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const size = bytes.readUInt32LE(pos + 4);
    if (bytes.toString("ascii", pos, pos + 4) === "data") {
      const count = Math.floor(Math.min(size, bytes.length - pos - 8) / 2);
      return Float32Array.from(
        { length: count },
        (_, i) => bytes.readInt16LE(pos + 8 + i * 2) / 32768,
      );
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("The recording has no PCM audio.");
}

// YIN difference / cumulative mean normalization at 12 kHz. Only a single
// exposed voice is supported; accompaniment and multiple singers are excluded.
export function detectPitch(
  frame: Float32Array,
  rate = 12000,
): number | undefined {
  let energy = 0;
  for (const value of frame) energy += value * value;
  if (Math.sqrt(energy / frame.length) < 0.008) return;
  const max = Math.min(Math.floor(rate / 65), Math.floor(frame.length / 2));
  const min = Math.floor(rate / 1000);
  const difference = new Float64Array(max + 1);
  const normalized = new Float64Array(max + 1);
  let sum = 0;
  for (let lag = 1; lag <= max; lag++) {
    let value = 0;
    for (let i = 0; i < frame.length - max; i++) {
      const delta = frame[i] - frame[i + lag];
      value += delta * delta;
    }
    difference[lag] = value;
    sum += value;
    normalized[lag] = sum ? (value * lag) / sum : 1;
  }
  for (let lag = Math.max(2, min); lag < max - 1; lag++) {
    if (normalized[lag] > 0.16) continue;
    while (lag + 1 < max && normalized[lag + 1] < normalized[lag]) lag++;
    const left = difference[lag - 1],
      center = difference[lag],
      right = difference[lag + 1];
    const denominator = left - 2 * center + right;
    const adjustment = denominator
      ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator)))
      : 0;
    return rate / (lag + adjustment);
  }
}

export function analyzeHarmony(
  samples: Float32Array,
  options: HarmonyOptions = DEFAULT_HARMONY,
) {
  const pitches: (number | undefined)[] = [];
  const histogram = new Float64Array(12);
  for (let at = 0; at < samples.length; at += HOP) {
    const frame = Float32Array.from(
      { length: 768 },
      (_, i) => samples[at + (i - 384) * 4] ?? 0,
    );
    const frequency = detectPitch(frame);
    const midi = frequency ? 69 + 12 * Math.log2(frequency / 440) : undefined;
    pitches.push(midi);
    if (midi !== undefined) histogram[((Math.round(midi) % 12) + 12) % 12]++;
  }
  const voiced = pitches.filter((p) => p !== undefined).length;
  assert(
    voiced >= 10,
    "I couldn’t find a clear sung note. Your recording is safe. Try singing one short phrase without background music.",
  );
  const profiles = [
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
  ];
  let best = { tonic: 0, minor: false, score: -Infinity };
  for (let mode = 0; mode < 2; mode++) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const scale = mode ? MINOR : MAJOR;
      let score = 0;
      for (let note = 0; note < 12; note++) {
        const relative = (note - tonic + 12) % 12;
        score +=
          histogram[note] *
          (profiles[mode][relative] + (scale.includes(relative) ? 2 : -5));
      }
      if (score > best.score) best = { tonic, minor: !!mode, score };
    }
  }
  const scale = best.minor ? MINOR : MAJOR;
  const shifts = pitches.map((midi) => {
    if (midi === undefined) return 0;
    const note = Math.round(midi);
    const relative = (((note - best.tonic) % 12) + 12) % 12;
    let degree = 0;
    for (let i = 1; i < scale.length; i++) {
      if (Math.abs(scale[i] - relative) < Math.abs(scale[degree] - relative))
        degree = i;
    }
    const sign = options.direction === "higher" ? 1 : -1;
    // Fifths are perfect fifths; thirds/sixths follow the estimated scale.
    if (options.interval === 5) return sign * 7;
    const target = degree + sign * (options.interval - 1);
    return (
      scale[((target % 7) + 7) % 7] +
      Math.floor(target / 7) * 12 -
      scale[degree]
    );
  });
  // Short median filtering prevents vibrato/noisy boundaries from switching
  // between minor and major thirds on every analysis frame.
  const smooth = shifts.map((value, i) => {
    if (!value) return 0;
    const nearby = shifts
      .slice(Math.max(0, i - 2), i + 3)
      .filter(Boolean)
      .sort((a, b) => a - b);
    return nearby[Math.floor(nearby.length / 2)] ?? value;
  });
  return {
    shifts: smooth,
    estimatedKey: `${NAMES[best.tonic]} ${best.minor ? "minor" : "major"}`,
    voicedSeconds: (voiced * HOP) / RATE,
  };
}

export async function renderHarmony(
  inputFile: string,
  directory: string,
  id: string,
  options: HarmonyOptions = DEFAULT_HARMONY,
) {
  const samples = pcmSamples(readFileSync(path.join(directory, inputFile)));
  const analysis = analyzeHarmony(samples, options);
  const intervals = [...new Set(analysis.shifts.filter(Boolean))].sort(
    (a, b) => a - b,
  );
  const temporary = intervals.map((interval) =>
    path.join(directory, `${id}-shift-${interval}.wav`),
  );
  try {
    // Stock ffmpeg: resampling transposes the recorded voice, atempo restores
    // its duration. This is local DSP, not a generative voice model/formant model.
    for (let i = 0; i < intervals.length; i++) {
      const ratio = 2 ** (intervals[i] / 12);
      await exec(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          path.join(directory, inputFile),
          "-af",
          `asetrate=${Math.round(RATE * ratio)},aresample=${RATE},atempo=${1 / ratio},apad,atrim=end_sample=${samples.length}`,
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          temporary[i],
        ],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
    }
    const shifted = temporary.map((file) => pcmSamples(readFileSync(file)));
    const harmony = new Float32Array(samples.length);
    const weights = new Float64Array(intervals.length).fill(
      1 / intervals.length,
    );
    let envelope = 0;
    for (let i = 0; i < harmony.length; i++) {
      const shift =
        analysis.shifts[
          Math.min(Math.floor(i / HOP), analysis.shifts.length - 1)
        ];
      let sample = 0;
      for (let j = 0; j < intervals.length; j++) {
        weights[j] += ((shift === intervals[j] ? 1 : 0) - weights[j]) / 480;
        sample += (shifted[j][i] ?? 0) * weights[j];
      }
      envelope += ((shift ? 1 : 0) - envelope) / 240;
      harmony[i] = sample * envelope;
    }
    const file = `${id}-harmony.wav`;
    writeFileSync(path.join(directory, file), encodeWav(harmony, RATE), {
      mode: 0o600,
    });
    return { file, estimatedKey: analysis.estimatedKey };
  } finally {
    for (const file of temporary) rmSync(file, { force: true });
  }
}
