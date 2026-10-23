import {
  encodeWav,
  RECORDING_SECONDS as SONG_SECONDS,
} from "../../shared/music.ts";
import type { Take } from "../../shared/types.ts";

export type AudioState = {
  mode:
    "idle" | "requesting" | "loading" | "countdown" | "recording" | "playing";
  progress: number;
  seconds: number;
  countdown: number;
  level: number;
};
const idle: AudioState = {
  mode: "idle",
  progress: 0,
  seconds: 0,
  countdown: 0,
  level: 0,
};
type Playable = Pick<Take, "gain" | "offsetMs" | "muted" | "active"> & {
  url: string;
};
export class AudioEngine {
  context?: AudioContext;
  private sources: AudioScheduledSourceNode[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private workletLoaded = false;
  private timer?: ReturnType<typeof setInterval>;
  private recorder?: AudioWorkletNode;
  private generation = 0;
  private cancelRecording?: (error: Error) => void;
  state = { ...idle };
  onChange: (state: AudioState) => void = () => {};
  private emit(value: Partial<AudioState>) {
    this.state = { ...this.state, ...value };
    this.onChange(this.state);
  }
  async unlock() {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    await this.context.resume();
    return this.context;
  }
  private async buffer(url: string) {
    const context = await this.unlock();
    let buffer = this.buffers.get(url);
    if (!buffer) {
      const response = await fetch(url);
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(
          problem.error ||
            "Audio is unavailable. Refresh the studio and try again.",
        );
      }
      buffer = await context.decodeAudioData(await response.arrayBuffer());
      this.buffers.set(url, buffer);
      if (this.buffers.size > 24)
        this.buffers.delete(this.buffers.keys().next().value!);
    }
    return buffer;
  }
  stop() {
    this.generation++;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.cancelRecording?.(
      new Error("Recording cancelled. Your previous takes are safe."),
    );
    this.cancelRecording = undefined;
    this.recorder = undefined;
    this.emit({ ...idle });
  }
  finishRecording() {
    this.recorder?.port.postMessage("stop");
  }
  private schedule(
    buffer: AudioBuffer,
    at: number,
    gain: number,
    offsetMs = 0,
  ) {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const volume = context.createGain();
    volume.gain.value = gain;
    source.connect(volume).connect(context.destination);
    const trim = Math.max(0, -offsetMs / 1000);
    if (trim < buffer.duration)
      source.start(at + Math.max(0, offsetMs / 1000), trim);
    this.sources.push(source);
  }
  async playTracks(tracks: Playable[], onEnded?: () => void) {
    this.stop();
    const generation = this.generation;
    this.emit({ mode: "loading" });
    try {
      const selected = tracks.filter((t) => t.active && !t.muted && t.gain > 0);
      if (!selected.length)
        throw new Error("Choose an audible take to listen.");
      const buffers = await Promise.all(
        selected.map((t) => this.buffer(t.url)),
      );
      if (generation !== this.generation) return;
      const context = await this.unlock();
      const at = context.currentTime + 0.1;
      const duration = Math.max(
        ...buffers.map((b, i) => b.duration + selected[i].offsetMs / 1000),
      );
      const headroom = Math.max(
        1,
        selected.reduce((sum, take) => sum + take.gain, 0),
      );
      buffers.forEach((b, i) =>
        this.schedule(b, at, selected[i].gain / headroom, selected[i].offsetMs),
      );
      this.emit({ mode: "playing", seconds: 0 });
      this.timer = setInterval(() => {
        const seconds = Math.max(0, context.currentTime - at);
        this.emit({ seconds, progress: Math.min(seconds / duration, 1) });
        if (seconds >= duration) {
          this.stop();
          onEnded?.();
        }
      }, 40);
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }
  async playUrl(url: string, onEnded?: () => void) {
    return this.playTracks(
      [{ url, gain: 0.9, offsetMs: 0, muted: false, active: true }],
      onEnded,
    );
  }
  async selfCheck() {
    this.stop();
    const context = await this.unlock();
    if (!this.workletLoaded) {
      await context.audioWorklet.addModule("/recorder-worklet.js");
      this.workletLoaded = true;
    }
    const startFrame = Math.ceil(
      (context.currentTime + 0.15) * context.sampleRate,
    );
    const frameCount = Math.round(context.sampleRate * 0.2);
    const capture = new AudioWorkletNode(context, "harmony-recorder", {
      processorOptions: { startFrame, frameCount },
      outputChannelCount: [1],
    });
    const testTone = context.createOscillator();
    testTone.frequency.value = 440;
    testTone.connect(capture).connect(context.destination); // Capture outputs silence.
    const chunks: Float32Array[] = [];
    try {
      const first = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The browser audio engine did not respond. Check audio permissions or try Chrome.",
              ),
            ),
          4000,
        );
        capture.port.onmessage = (event) => {
          if (event.data.type === "chunk") chunks.push(event.data.samples);
          if (event.data.type === "done") {
            clearTimeout(timeout);
            resolve(event.data.firstFrame);
          }
        };
        capture.onprocessorerror = () => {
          clearTimeout(timeout);
          reject(new Error("The browser could not run the recording worklet."));
        };
        testTone.start();
      });
      const count = chunks.reduce((total, chunk) => total + chunk.length, 0);
      const peak = chunks.reduce(
        (peak, chunk) => Math.max(peak, ...chunk.map(Math.abs)),
        0,
      );
      if (first !== startFrame || count !== frameCount || peak < 0.2)
        throw new Error(
          "Audio self-check failed: capture timing or signal was unexpected.",
        );
      return {
        samples: count,
        sampleRate: context.sampleRate,
        scheduledFrame: startFrame,
        firstFrame: first,
      };
    } finally {
      testTone.stop();
      testTone.disconnect();
      capture.disconnect();
    }
  }
  private waitFor<T>(
    operation: Promise<T>,
    milliseconds: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    let cancel: (error: Error) => void;
    return new Promise<T>((resolve, reject) => {
      cancel = reject;
      this.cancelRecording = cancel;
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
      operation.then(resolve, reject);
    }).finally(() => {
      clearTimeout(timer);
      if (this.cancelRecording === cancel) this.cancelRecording = undefined;
    });
  }
  async record(
    references: Playable[],
    guideUrl?: string | Promise<string | undefined>,
  ): Promise<{
    wav: Uint8Array;
    capture: NonNullable<Take["capture"]>;
    settings: MediaTrackSettings;
  }> {
    this.stop();
    const generation = this.generation;
    this.emit({ mode: "requesting" });
    let stream: MediaStream | undefined;
    let input: MediaStreamAudioSourceNode | undefined;
    let node: AudioWorkletNode | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "This browser cannot access the microphone. Open this studio in Chrome or Edge on localhost or HTTPS.",
        );
      // Start both operations in the click handler, before any MCP/network await.
      const ready = this.unlock();
      const permission = navigator.mediaDevices
        .getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        })
        .then((value) => {
          if (generation !== this.generation) {
            value.getTracks().forEach((track) => track.stop());
            throw new Error("Recording cancelled.");
          }
          stream = value;
          return value;
        });
      const selected = references.filter(
        (t) => t.active && !t.muted && t.gain > 0,
      );
      const assets = Promise.all([
        Promise.all(selected.map((t) => this.buffer(t.url))),
        Promise.resolve(guideUrl).then((url) =>
          url ? this.buffer(url) : undefined,
        ),
      ]).then(
        ([buffers, guide]) => ({ buffers, guide }),
        (error) => ({ error }),
      );
      const [context] = await this.waitFor(
        Promise.all([ready, permission]),
        20000,
        "Microphone access is still waiting. Allow the browser microphone prompt, or open this studio in Chrome or Edge, then try again.",
      );
      this.emit({ mode: "loading" });
      if (!this.workletLoaded) {
        await this.waitFor(
          context.audioWorklet.addModule("/recorder-worklet.js"),
          10000,
          "The audio recorder could not load. Refresh the studio and try again.",
        );
        this.workletLoaded = true;
      }
      const loaded = await this.waitFor(
        assets,
        12000,
        "The reference audio is taking too long. Try recording without playback.",
      );
      if ("error" in loaded) throw loaded.error;
      const { buffers, guide } = loaded;
      if (generation !== this.generation)
        throw new Error("Recording cancelled.");
      const settings = stream!.getAudioTracks()[0].getSettings();
      const startFrame = Math.ceil(
        (context.currentTime + 3.15) * context.sampleRate,
      );
      const at = startFrame / context.sampleRate;
      const frameCount = Math.ceil(SONG_SECONDS * context.sampleRate);
      node = new AudioWorkletNode(context, "harmony-recorder", {
        processorOptions: { startFrame, frameCount },
        outputChannelCount: [1],
      });
      this.recorder = node;
      input = context.createMediaStreamSource(stream!);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      input.connect(analyser);
      input.connect(node);
      node.connect(context.destination); // Worklet outputs silence: no microphone monitoring.
      const headroom = Math.max(
        1,
        selected.reduce((sum, take) => sum + take.gain, 0),
      );
      buffers.forEach((b, i) =>
        this.schedule(b, at, selected[i].gain / headroom, selected[i].offsetMs),
      );
      if (guide) this.schedule(guide, at, selected.length ? 0.25 : 0.5);
      // Count-in clicks end before T0. Wired headphones avoid bleed.
      for (let i = 3; i > 0; i--) {
        const click = context.createOscillator();
        const volume = context.createGain();
        click.frequency.value = i === 1 ? 880 : 660;
        volume.gain.setValueAtTime(0.035, at - i);
        volume.gain.exponentialRampToValueAtTime(0.001, at - i + 0.06);
        click.connect(volume).connect(context.destination);
        click.start(at - i);
        click.stop(at - i + 0.07);
        this.sources.push(click);
      }
      const levels = new Float32Array(analyser.fftSize);
      this.timer = setInterval(() => {
        const remaining = at - context.currentTime;
        analyser.getFloatTimeDomainData(levels);
        const level = Math.min(
          1,
          Math.sqrt(levels.reduce((s, n) => s + n * n, 0) / levels.length) * 5,
        );
        const seconds = Math.max(0, context.currentTime - at);
        this.emit({
          mode: remaining > 0 ? "countdown" : "recording",
          countdown: Math.min(3, Math.ceil(Math.max(0, remaining))),
          seconds,
          progress: Math.min(seconds / SONG_SECONDS, 1),
          level,
        });
      }, 40);
      const chunks: Float32Array[] = [];
      const firstFrame = await this.waitFor(
        new Promise<number>((resolve, reject) => {
          node!.port.onmessage = (event) => {
            if (event.data.type === "chunk") chunks.push(event.data.samples);
            if (event.data.type === "done") resolve(event.data.firstFrame);
          };
          node!.onprocessorerror = () =>
            reject(
              new Error(
                "Audio capture stopped unexpectedly. Please try a new take.",
              ),
            );
          stream!.getAudioTracks()[0].onended = () =>
            reject(
              new Error(
                "Microphone disconnected. Your previous takes are safe.",
              ),
            );
        }),
        (SONG_SECONDS + 10) * 1000,
        "Recording stopped responding. Your previous takes are safe; try recording again.",
      );
      this.cancelRecording = undefined;
      const length = chunks.reduce((n, c) => n + c.length, 0);
      if (length < context.sampleRate * 0.25)
        throw new Error(
          "That take was very short. Record at least a moment after the count-in.",
        );
      const samples = new Float32Array(length);
      let position = 0;
      for (const chunk of chunks) {
        samples.set(chunk, position);
        position += chunk.length;
      }
      return {
        wav: encodeWav(samples, context.sampleRate),
        settings,
        capture: {
          firstFrame,
          scheduledFrame: startFrame,
          sampleRate: context.sampleRate,
          baseLatency: context.baseLatency,
          outputLatency: context.outputLatency || 0,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === "NotAllowedError")
        throw new Error(
          "Microphone access was blocked. Allow the microphone for this page and try again. If the in-app browser cannot record, open this studio in Chrome or Edge.",
        );
      if (error instanceof Error && error.name === "NotFoundError")
        throw new Error(
          "No microphone was found. Connect a microphone and try again.",
        );
      if (error instanceof Error && error.name === "NotReadableError")
        throw new Error(
          "The microphone is unavailable or in use by another app. Close other recording apps and try again.",
        );
      throw error;
    } finally {
      this.cancelRecording = undefined;
      stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      input?.disconnect();
      node?.disconnect();
      if (generation === this.generation) this.stop();
    }
  }
}
export const audio = new AudioEngine();
