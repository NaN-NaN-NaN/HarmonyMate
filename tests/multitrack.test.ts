import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app.ts";
import { Harmony } from "../server/domain.ts";
import { trackIntent } from "../server/track-commands.ts";
import { encodeWav } from "../shared/music.ts";
import { pcmSamples, detectPitch } from "../server/harmonize.ts";
import {
  harmonyLabel,
  type HarmonyOptions,
  type Take,
  type ToolResult,
} from "../shared/types.ts";

test("six independent harmonies, exact track playback/mixes, additive overdub provenance and legacy stem migration", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "harmony-tracks-"));
  let url = "";
  const runtime = createApp({
    directory,
    secret: "tracks-test",
    mcpUrl: () => `${url}/mcp`,
  });
  runtime.app.use(runtime.errors);
  const server = createServer(runtime.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const songId = "a-little-closer";
  const call = (
    name: Parameters<typeof runtime.harmony.call>[1],
    args: Record<string, unknown>,
  ) => runtime.harmony.call("alex", name, { songId, ...args });
  const samples = new Float32Array(48000 * 4);
  const notes = [261.6256, 329.6276, 391.9954, 523.2511];
  for (let i = 0; i < samples.length; i++) {
    const n = Math.floor(i / 48000),
      t = (i % 48000) / 48000;
    samples[i] =
      t < 0.85
        ? 0.3 *
          Math.sin(2 * Math.PI * notes[n] * t) *
          Math.min(t / 0.02, (0.85 - t) / 0.03, 1)
        : 0;
  }
  const wav = Buffer.from(encodeWav(samples, 48000));
  async function wait(id: string) {
    for (let i = 0; i < 300; i++) {
      const job = runtime.store.read().mixes.find((m) => m.id === id)!;
      if (job.status === "failed") assert.fail(job.error);
      if (job.status === "ready") return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail("Audio job timed out");
  }
  async function agent(text: string, selectedTakeIds?: string[]) {
    const response = await fetch(`${url}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, songId, selectedTakeIds }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  try {
    const initial = await call("start_recording_session", { part: "lead" });
    const original = await runtime.harmony.upload(
      "alex",
      String(initial.sessionId),
      wav,
    );
    await call("review_take", { takeId: original.takeId, decision: "keep" });
    const variants: HarmonyOptions[] = [];
    for (const direction of ["lower", "higher"] as const)
      for (const interval of [3, 5, 6] as const)
        variants.push({ direction, interval });
    const generated: Take[] = [];
    for (const options of variants) {
      const job = await call("generate_harmony", {
        takeId: original.takeId,
        ...options,
      });
      const duplicate = await call("generate_harmony", {
        takeId: original.takeId,
        ...options,
      });
      assert.equal(job.jobId, duplicate.jobId);
      const mix = await wait(String(job.jobId));
      const stem = runtime.store
        .read()
        .takes.find((t) => t.id === mix.tracks[1].id)!;
      assert.equal(stem.name, harmonyLabel(options));
      assert.deepEqual(stem.harmonyOptions, options);
      generated.push(stem);
      runtime.harmony.authorizeAudio("ben", stem.file);
      assert.throws(() => runtime.harmony.authorizeAudio("mom", stem.file));
      const output = pcmSamples(
        readFileSync(path.join(directory, "audio", stem.file)),
      );
      assert.equal(output.length, samples.length);
      const frame = Float32Array.from(
        { length: 768 },
        (_, i) => output[16800 + i * 4],
      );
      const difference = 12 * Math.log2(detectPitch(frame)! / notes[0]);
      const magnitude =
        options.interval === 3
          ? options.direction === "lower"
            ? 3
            : 4
          : options.interval === 5
            ? 7
            : options.direction === "lower"
              ? 8
              : 9;
      assert.ok(
        Math.abs(
          difference -
            (options.direction === "higher" ? magnitude : -magnitude),
        ) < 0.4,
        `${harmonyLabel(options)} got ${difference} semitones`,
      );
    }
    let tracks = (await call("list_tracks", {})).tracks as Take[];
    assert.equal(tracks.length, 7);
    assert.equal(new Set(tracks.map((t) => t.trackNumber)).size, 7);
    const originalTrack = tracks.find((t) => t.id === original.takeId)!;
    const ids = [original.takeId, generated[1].id];
    const playback = await call("play_tracks", { takeIds: ids });
    assert.deepEqual(playback.takeIds, ids);
    assert.ok(
      (playback.tracks as { url: string }[]).every((t) =>
        t.url.includes("token="),
      ),
    );
    await assert.rejects(() => call("play_tracks", { takeIds: ["missing"] }));
    await assert.rejects(() =>
      call("play_tracks", { takeIds: [ids[0], ids[0]] }),
    );
    const response = await agent(
      `跟第 ${originalTrack.trackNumber}、${generated[1].trackNumber} 軌一起唱`,
    );
    assert.equal(response.action.type, "record");
    assert.deepEqual(response.action.referenceTakeIds, ids);
    const session = runtime.store
      .read()
      .recordings.find((r) => r.id === response.action.sessionId)!;
    assert.deepEqual(session.referenceTakeIds, ids);
    assert.equal(session.replacesTakeId, undefined, "Overdub must be additive");
    const overdub = await runtime.harmony.upload("alex", session.id, wav);
    assert.equal(
      runtime.store.read().takes.find((t) => t.id === original.takeId)?.active,
      true,
    );
    await assert.rejects(() =>
      call("play_tracks", { takeIds: [overdub.takeId] }),
    );
    await call("review_take", { takeId: overdub.takeId, decision: "keep" });
    const newTrack = runtime.store
      .read()
      .takes.find((t) => t.id === overdub.takeId)!;
    assert.equal(newTrack.part, "harmony");
    assert.deepEqual(newTrack.referenceTakeIds, ids);
    assert.equal(
      runtime.store.read().takes.find((t) => t.id === original.takeId)?.active,
      true,
    );
    const exact = [generated[0].id, overdub.takeId];
    const saved = await call("create_mix", { takeIds: exact });
    const mix = await wait(String(saved.jobId));
    assert.deepEqual(
      mix.tracks.map((t) => t.id),
      exact,
    );
    const inventory = await agent("目前有哪些音軌？");
    assert.match(inventory.text, /#1/);
    const played = await agent(
      `播放第 ${newTrack.trackNumber}、${generated[0].trackNumber} 軌`,
    );
    assert.equal(played.action.type, "play_tracks");
    assert.deepEqual(played.action.takeIds, [newTrack.id, generated[0].id]);
    const selectedPlay = await agent("播放選取的音軌", exact);
    assert.deepEqual(selectedPlay.action.takeIds, exact);
    const invalid = await agent("播放第 999 軌");
    assert.equal(invalid.action, undefined);
    const high = await agent(
      `幫第 ${originalTrack.trackNumber} 軌加高六度和聲`,
    );
    const highMix = await wait(high.action.jobId);
    assert.deepEqual(highMix.harmonyOptions, {
      direction: "higher",
      interval: 6,
    });
    const oldStem = generated[0];
    runtime.harmony.stop();
    runtime.store.update((state) => {
      state.takes = state.takes.filter((t) => t.id !== oldStem.id);
    });
    const restored = new Harmony(runtime.store, runtime.harmony.tokens);
    restored.stop();
    tracks = runtime.store.read().takes;
    assert.equal(tracks.filter((t) => t.id === oldStem.id).length, 1);
    assert.equal(
      tracks.find((t) => t.id === oldStem.id)?.trackNumber,
      oldStem.trackNumber,
    );
    assert.deepEqual(
      readFileSync(path.join(directory, "audio", originalTrack.file))
        .subarray(0, 4)
        .toString(),
      "RIFF",
    );
  } finally {
    runtime.harmony.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("track commands distinguish interval numbers from track references and reject ambiguous names", () => {
  const base = {
    actor: "alex",
    active: true,
    reviewStatus: "kept",
    part: "lead",
    source: "microphone",
  };
  const tracks = [
    { ...base, id: "voice", trackNumber: 1, name: "Alex · Voice" },
    {
      ...base,
      id: "low",
      trackNumber: 2,
      part: "harmony",
      source: "generated-harmony",
      name: "Low 3rd harmony",
      harmonyOptions: { direction: "lower", interval: 3 },
    },
    {
      ...base,
      id: "high",
      trackNumber: 3,
      part: "harmony",
      source: "generated-harmony",
      name: "High 6th harmony",
      harmonyOptions: { direction: "higher", interval: 6 },
    },
  ] as Take[];
  assert.deepEqual(trackIntent("播放第一、三軌", tracks, "alex"), {
    type: "play",
    takeIds: ["voice", "high"],
  });
  assert.deepEqual(trackIntent("play tracks 1 and 2", tracks, "alex"), {
    type: "play",
    takeIds: ["voice", "low"],
  });
  assert.deepEqual(trackIntent("sing with track 2", tracks, "alex"), {
    type: "overdub",
    takeIds: ["low"],
  });
  assert.deepEqual(trackIntent("幫第1軌加高六度和聲", tracks, "alex"), {
    type: "generate",
    takeId: "voice",
    options: { direction: "higher", interval: 6 },
  });
  assert.deepEqual(trackIntent("播放低三度和聲", tracks, "alex"), {
    type: "play",
    takeIds: ["low"],
  });
  assert.deepEqual(trackIntent("播放原唱跟低三度", tracks, "alex"), {
    type: "play",
    takeIds: ["voice", "low"],
  });
  assert.deepEqual(
    trackIntent("play low 3rd and high 6th harmony together", tracks, "alex"),
    { type: "play", takeIds: ["low", "high"] },
  );
  assert.equal(trackIntent("播放第12軌", tracks, "alex")?.type, "error");
  assert.equal(
    trackIntent(
      "play low 3rd harmony",
      [...tracks, { ...tracks[1], id: "another", trackNumber: 4 }],
      "alex",
    )?.type,
    "error",
  );
});
