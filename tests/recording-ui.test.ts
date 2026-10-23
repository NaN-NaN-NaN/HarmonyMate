import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Bootstrap } from "../shared/types.ts";

test("recording entry, denied permission, successful WAV upload, and cancellation all have usable UI paths", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:3000",
  });
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (fn: () => void) => setTimeout(fn, 0),
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {},
    beginPath() {},
    roundRect() {},
    fill() {},
  })) as never;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let permissionRequests = 0,
    stoppedTracks = 0;
  let permissionMode: "denied" | "granted" | "pending" = "denied";
  const track = {
    getSettings: () => ({}),
    stop: () => {
      stoppedTracks++;
    },
    onended: null,
  };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  let grantPending: ((value: typeof stream) => void) | undefined;
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => {
        permissionRequests++;
        if (permissionMode === "denied")
          throw new DOMException("Permission denied", "NotAllowedError");
        if (permissionMode === "pending")
          return new Promise<typeof stream>((resolve) => {
            grantPending = resolve;
          });
        return stream;
      },
    },
  });
  let referenceStarts = 0;
  class Graph {
    frequency = { value: 440 };
    gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    connect(target: unknown) {
      return target;
    }
    disconnect() {}
    start() {}
    stop() {}
  }
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      state = "running";
      sampleRate = 48000;
      currentTime = 1;
      baseLatency = 0.01;
      outputLatency = 0.02;
      destination = new Graph();
      resume() {
        return Promise.resolve();
      }
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return new Graph();
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.1),
        };
      }
      createOscillator() {
        return new Graph();
      }
      createGain() {
        return new Graph();
      }
      decodeAudioData(bytes: ArrayBuffer) {
        return Promise.resolve({ duration: (bytes.byteLength - 44) / 96000 });
      }
      createBufferSource() {
        const source = new Graph();
        source.start = () => {
          referenceStarts++;
        };
        return source;
      }
    },
  });
  // Simulated worklet messages exercise the real engine → PCM WAV → UI upload
  // path. The processor's actual sample scheduling has its own VM regression.
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    value: class extends Graph {
      port = {
        onmessage: null as null | ((event: { data: unknown }) => void),
        postMessage() {},
      };
      constructor(
        _context: unknown,
        _name: string,
        options: { processorOptions: { startFrame: number } },
      ) {
        super();
        setTimeout(() => {
          this.port.onmessage?.({
            data: {
              type: "chunk",
              samples: new Float32Array(16000).fill(0.25),
            },
          });
          this.port.onmessage?.({
            data: {
              type: "done",
              firstFrame: options.processorOptions.startFrame,
            },
          });
        }, 0);
      }
    },
  });
  const bootstrap: Bootstrap = {
    actor: "alex",
    people: [],
    songs: [
      {
        id: "test-song",
        title: "A little closer",
        owner: "alex",
        members: ["alex", "ben"],
        createdAt: new Date().toISOString(),
        takes: [],
        mixes: [],
      },
    ],
    surprises: [],
    traces: [],
    agentMode: "scripted",
    protocol: "2025-11-25",
    recordingSeconds: 17,
  };
  let uploaded: ArrayBuffer | undefined;
  let uploadCount = 0;
  let sessionInput: {
    part?: "lead" | "harmony";
    referenceTakeIds?: string[];
    addTrack?: boolean;
  } = {};
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/api/bootstrap")) return Response.json(bootstrap);
    if (String(url).includes("start_recording_session")) {
      sessionInput = JSON.parse(String(options!.body));
      return Response.json({ sessionId: "test-session" });
    }
    if (String(url).includes("/api/recordings/test-session/audio")) {
      uploaded = await (options!.body as Blob).arrayBuffer();
      assert.equal(Buffer.from(uploaded).toString("ascii", 0, 4), "RIFF");
      assert.equal(uploaded.byteLength, 32044);
      assert.ok(
        new DataView(uploaded).getInt16(44, true) > 0,
        "Captured audio must not be an empty or silent upload",
      );
      const takeId = ++uploadCount === 1 ? "actual-take" : "overdub-take";
      bootstrap.songs[0].takes.push({
        id: takeId,
        trackNumber: uploadCount,
        name: sessionInput.addTrack ? "Alex · Sung harmony" : "Alex · Voice",
        referenceTakeIds: sessionInput.referenceTakeIds,
        songId: "test-song",
        actor: "alex",
        part: sessionInput.part ?? "lead",
        file: "take.wav",
        url: "/test-recording.wav",
        sampleRate: 48000,
        duration: 16000 / 48000,
        gain: 0.8,
        offsetMs: 0,
        active: false,
        reviewStatus: "draft",
        muted: false,
        source: "microphone",
        createdAt: new Date().toISOString(),
      });
      return Response.json({ takeId });
    }
    if (String(url).includes("review_take")) {
      const input = JSON.parse(String(options!.body));
      const take = bootstrap.songs[0].takes.find((t) => t.id === input.takeId)!;
      take.reviewStatus =
        input.decision === "keep"
          ? "kept"
          : input.decision === "restore"
            ? "draft"
            : "discarded";
      take.active = input.decision === "keep";
      return Response.json({ takeId: take.id, status: take.reviewStatus });
    }
    if (String(url).includes("generate_harmony")) {
      assert.equal(
        bootstrap.songs[0].takes[0].reviewStatus,
        "kept",
        "Harmony requires explicit acceptance",
      );
      bootstrap.songs[0].mixes.push({
        id: "generated",
        songId: "test-song",
        actor: "alex",
        kind: "harmony",
        sourceTakeId: "actual-take",
        status: "queued",
        tracks: [],
        fingerprint: "test",
        createdAt: new Date().toISOString(),
      });
      return Response.json({ jobId: "generated" });
    }
    if (String(url) === "/test-recording.wav") return new Response(uploaded);
    throw new Error(`Unexpected request ${String(url).split("?")[0]}`);
  };
  const React = await import("react");
  const { render, screen, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  const { default: App } = await import("../web/App.tsx");
  try {
    render(React.createElement(App));
    await screen.findByRole("button", { name: "The studio" });
    assert.equal(screen.queryByLabelText("Demo password"), null);
    fireEvent.click(screen.getByRole("button", { name: "The studio" }));
    const record = screen.getByRole("button", {
      name: "Record my part",
    }) as HTMLButtonElement;
    assert.equal(
      record.disabled,
      false,
      "Recording must be available before checking a headphone box",
    );
    fireEvent.click(record);
    await waitFor(() => assert.equal(permissionRequests, 1));
    await waitFor(() =>
      assert.match(
        dom.window.document.querySelector(".recording-error")?.textContent ||
          "",
        /microphone/i,
      ),
    );
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Record my part",
        }) as HTMLButtonElement
      ).disabled,
      false,
      "After denial the user can retry",
    );
    permissionMode = "granted";
    fireEvent.click(screen.getByRole("button", { name: "Record my part" }));
    await screen.findByText(/HUMAN RECORDING/);
    assert.ok(uploaded);
    assert.ok(stoppedTracks > 0, "The microphone is released after saving");
    assert.equal(
      bootstrap.songs[0].takes[0].active,
      false,
      "Uploading must leave an unselected draft",
    );
    assert.equal(
      bootstrap.songs[0].mixes.length,
      0,
      "No harmony job before acceptance",
    );
    assert.equal(screen.queryByRole("button", { name: "Melody" }), null);
    fireEvent.click(screen.getByRole("button", { name: "Discard this take" }));
    await screen.findByRole("button", { name: "Undo" });
    assert.equal(bootstrap.songs[0].takes[0].reviewStatus, "discarded");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByRole("button", { name: "Keep this take" });
    fireEvent.click(screen.getByRole("button", { name: "Keep this take" }));
    await screen.findByText("Finding your other voice…");
    assert.equal(bootstrap.songs[0].takes[0].active, true);
    assert.equal(bootstrap.songs[0].mixes.length, 1);
    fireEvent.click(screen.getByRole("button", { name: "Sing another take" }));
    permissionMode = "pending";
    fireEvent.click(screen.getByRole("button", { name: "Record my part" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel microphone setup" }),
    );
    await waitFor(() =>
      assert.equal(
        (
          screen.getByRole("button", {
            name: "Record my part",
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    const before = stoppedTracks;
    grantPending!(stream);
    await waitFor(() =>
      assert.ok(
        stoppedTracks > before,
        "A late microphone permission grant must not leave capture running after cancel",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to my kept recording" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sing with selected tracks" }),
    );
    const overdubRecord = screen.getByRole("button", {
      name: "Record my part",
    }) as HTMLButtonElement;
    assert.equal(
      overdubRecord.disabled,
      true,
      "Reference playback needs an explicit headphone choice",
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "I’m wearing headphones" }),
    );
    assert.equal(overdubRecord.disabled, false);
    permissionMode = "granted";
    fireEvent.click(overdubRecord);
    await screen.findByRole("button", { name: "Keep this take" });
    assert.ok(
      referenceStarts > 0,
      "Reference tracks must actually be scheduled during overdubbing",
    );
    assert.equal(sessionInput.addTrack, true);
    assert.deepEqual(sessionInput.referenceTakeIds, ["actual-take"]);
    assert.equal(bootstrap.songs[0].takes[1].part, "harmony");
    assert.deepEqual(bootstrap.songs[0].takes[1].referenceTakeIds, [
      "actual-take",
    ]);
    assert.equal(
      new DataView(uploaded!).getInt16(44, true),
      8192,
      "Reference playback must not be mixed into microphone PCM",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep this take" }));
    await waitFor(() =>
      assert.equal(bootstrap.songs[0].takes[1].reviewStatus, "kept"),
    );
    assert.equal(
      bootstrap.songs[0].mixes.length,
      1,
      "Human overdubs should not automatically generate another voice",
    );
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
