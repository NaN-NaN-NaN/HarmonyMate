import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { encodeWav } from "../shared/music.ts";
import { renderMix } from "../server/audio.ts";
import type { Take } from "../shared/types.ts";

test("ffmpeg alignment shifts a known impulse correctly for both positive and negative offsets", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-audio-"));
  try {
    const samples = new Float32Array(24000);
    samples[9600] = 0.6;
    writeFileSync(
      path.join(directory, "impulse.wav"),
      encodeWav(samples, 48000),
    );
    for (const offsetMs of [-80, 80]) {
      const take: Take = {
        id: "impulse",
        songId: "test",
        actor: "alex",
        part: "lead",
        file: "impulse.wav",
        duration: 0.5,
        sampleRate: 48000,
        gain: 1,
        offsetMs,
        active: true,
        muted: false,
        source: "sample-tone",
        createdAt: new Date().toISOString(),
      };
      const file = await renderMix([take], directory, `mix-${offsetMs}`);
      const bytes = readFileSync(path.join(directory, file));
      let position = 12;
      while (
        position < bytes.length &&
        bytes.toString("ascii", position, position + 4) !== "data"
      )
        position +=
          8 +
          bytes.readUInt32LE(position + 4) +
          (bytes.readUInt32LE(position + 4) % 2);
      assert.ok(position < bytes.length);
      const size = bytes.readUInt32LE(position + 4);
      let peakIndex = 0,
        peak = 0;
      for (let i = 0; i < size / 2; i++) {
        const value = Math.abs(bytes.readInt16LE(position + 8 + i * 2));
        if (value > peak) {
          peak = value;
          peakIndex = i;
        }
      }
      assert.ok(peak > 1000);
      assert.ok(
        Math.abs(peakIndex - (9600 + offsetMs * 48)) <= 2,
        `${offsetMs}ms peak at sample ${peakIndex}`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("AudioWorklet captures exactly from T0 across render-block boundaries and flushes the final partial block", () => {
  const messages: {
    type: string;
    samples?: Float32Array;
    firstFrame?: number;
  }[] = [];
  let Recorder: new (options: unknown) => {
    process(inputs: Float32Array[][]): boolean;
  };
  const context = vm.createContext({
    Float32Array,
    currentFrame: 0,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (message: (typeof messages)[number]) =>
          messages.push(message),
        onmessage: null,
      };
    },
    registerProcessor: (_name: string, cls: typeof Recorder) => {
      Recorder = cls;
    },
  });
  vm.runInContext(
    readFileSync(
      new URL("../public/recorder-worklet.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const recorder = new Recorder!({
    processorOptions: { startFrame: 257, frameCount: 3000 },
  });
  for (let frame = 0; frame < 3500; frame += 128) {
    context.currentFrame = frame;
    const input = Float32Array.from({ length: 128 }, (_, i) => frame + i);
    if (!recorder.process([[input]])) break;
  }
  const captured = messages
    .filter((m) => m.type === "chunk")
    .flatMap((m) => [...m.samples!]);
  assert.equal(captured.length, 3000);
  assert.equal(captured[0], 257);
  assert.equal(captured.at(-1), 3256);
  assert.equal(messages.at(-1)?.type, "done");
  assert.equal(messages.at(-1)?.firstFrame, 257);
});
