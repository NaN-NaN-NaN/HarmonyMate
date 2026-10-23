import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeWav } from "../shared/music.ts";
import {
  analyzeHarmony,
  detectPitch,
  pcmSamples,
  renderHarmony,
} from "../server/harmonize.ts";

const RATE = 48000;
const notes = [261.6256, 329.6276, 391.9954, 523.2511];
function phrase() {
  const samples = new Float32Array(RATE * 4);
  for (let n = 0; n < notes.length; n++) {
    for (let i = 0; i < RATE * 0.85; i++) {
      const t = i / RATE;
      const envelope = Math.min(t / 0.02, (0.85 - t) / 0.03, 1);
      samples[n * RATE + i] =
        envelope *
        0.3 *
        (Math.sin(2 * Math.PI * notes[n] * t) +
          0.15 * Math.sin(4 * Math.PI * notes[n] * t));
    }
  }
  return samples;
}

test("local harmony follows a sung contour at diatonic thirds, keeps timing and source bytes, and rejects silence", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-generation-"));
  try {
    const samples = phrase();
    const original = Buffer.from(encodeWav(samples, RATE));
    writeFileSync(path.join(directory, "source.wav"), original);
    const analysis = analyzeHarmony(samples);
    assert.equal(analysis.estimatedKey, "C major");
    assert.ok(
      analysis.shifts.includes(-3) && analysis.shifts.includes(-4),
      "Harmony must adapt the third to notes in the scale",
    );
    const generated = await renderHarmony("source.wav", directory, "test");
    assert.deepEqual(
      readFileSync(path.join(directory, "source.wav")),
      original,
    );
    const output = pcmSamples(
      readFileSync(path.join(directory, generated.file)),
    );
    assert.equal(
      output.length,
      samples.length,
      "Generated voice must retain sample duration",
    );
    assert.notDeepEqual(
      output,
      samples,
      "Generated audio must be a different voice part",
    );
    const expectedIntervals = [3, 4, 3, 3]; // C→A, E→C, G→E, C→A in C major.
    for (let n = 0; n < notes.length; n++) {
      const start = (n + 0.35) * RATE;
      const frame = Float32Array.from(
        { length: 768 },
        (_, i) => output[Math.round(start) + i * 4],
      );
      const hz = detectPitch(frame)!;
      const interval = 12 * Math.log2(notes[n] / hz);
      assert.ok(
        Math.abs(interval - expectedIntervals[n]) < 0.35,
        `Note ${n} expected ${expectedIntervals[n]} semitones below, got ${interval}`,
      );
    }
    const quiet = output.slice(RATE * 0.94, RATE * 0.98);
    assert.ok(
      Math.max(...quiet.map(Math.abs)) < 0.015,
      "Rests should remain quiet",
    );
    assert.throws(
      () => analyzeHarmony(new Float32Array(RATE)),
      /clear sung note/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
