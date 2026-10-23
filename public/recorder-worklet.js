// Capture sample positions on the AudioContext clock, not message arrival time.
class HarmonyRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.start = options.processorOptions.startFrame;
    this.end = this.start + options.processorOptions.frameCount;
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.first = null;
    this.done = false;
    this.port.onmessage = event => { if (event.data === 'stop') this.finish(); };
  }
  flush() {
    if (!this.used) return;
    const chunk = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'chunk', samples: chunk }, [chunk.buffer]);
    this.used = 0;
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.flush();
    this.port.postMessage({ type: 'done', firstFrame: this.first ?? this.start });
  }
  process(inputs) {
    if (this.done) return false;
    const input = inputs[0]?.[0];
    const blockSize = input?.length ?? 128;
    for (let i = 0; i < blockSize; i++) {
      const frame = currentFrame + i;
      if (frame >= this.end) { this.finish(); return false; }
      if (frame < this.start) continue;
      this.first ??= frame;
      this.buffer[this.used++] = input?.[i] ?? 0;
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('harmony-recorder', HarmonyRecorder);
