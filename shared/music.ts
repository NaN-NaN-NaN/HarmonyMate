// Original eight-bar exercise: "A little closer". No third-party melody or samples.
// Each item is one beat, 112 BPM. Null is a rest.
export const BPM = 112;
export const LEAD = [
  60,
  64,
  67,
  67,
  69,
  67,
  64,
  null,
  65,
  69,
  72,
  69,
  67,
  64,
  60,
  null,
  64,
  67,
  71,
  67,
  65,
  64,
  62,
  null,
  65,
  64,
  62,
  59,
  60,
  60,
  60,
  null,
];
export const HARMONY = [
  48,
  55,
  60,
  60,
  60,
  60,
  55,
  null,
  53,
  60,
  65,
  60,
  55,
  55,
  52,
  null,
  52,
  59,
  64,
  59,
  53,
  52,
  55,
  null,
  53,
  55,
  55,
  55,
  48,
  52,
  48,
  null,
];
export const SONG_SECONDS = (LEAD.length * 60) / BPM;

export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const n = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(n * (n < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export function renderGuide(
  part: "lead" | "harmony",
  sampleRate = 24000,
): Uint8Array {
  const notes = part === "lead" ? LEAD : HARMONY;
  const samples = new Float32Array(Math.ceil(SONG_SECONDS * sampleRate));
  const beat = 60 / BPM;
  notes.forEach((note, index) => {
    if (note === null) return;
    const freq = 440 * 2 ** ((note - 69) / 12);
    const length = beat * 0.89;
    for (let i = 0; i < Math.floor(length * sampleRate); i++) {
      const t = i / sampleRate;
      const envelope =
        Math.min(t / 0.025, 1) * Math.min((length - t) / 0.12, 1);
      samples[Math.floor(index * beat * sampleRate) + i] =
        envelope *
        0.23 *
        (Math.sin(2 * Math.PI * freq * t) +
          0.18 * Math.sin(4 * Math.PI * freq * t));
    }
  });
  return encodeWav(samples, sampleRate);
}
